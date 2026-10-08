import { withSupabase } from "npm:@supabase/server@1";
import sodium from "npm:libsodium-wrappers@0.7.15";

type Body = {
  actor_user_id?: string;
  device_id?: string;
  operation?: "provision" | "rotate" | "reassign";
  device_uid?: string;
  target_warehouse_id?: string;
  reason?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEVICE_UID = /^[A-Za-z0-9._:-]{1,128}$/;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function configuration() {
  const key = Deno.env.get("DEVICE_SECRET_KEY_HEX") ?? "";
  if (!/^[0-9a-f]{64}$/i.test(key)) throw new Error("server_configuration_error");
  return key;
}

function hexToBytes(hex: string) {
  return sodium.from_hex(hex);
}

async function encryptDeviceSecret(secret: string, keyHex: string) {
  await sodium.ready;
  const key = hexToBytes(keyHex);
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const cipher = sodium.crypto_secretbox_easy(
    sodium.from_string(secret),
    nonce,
    key,
  );
  return sodium.to_base64(
    new Uint8Array([...nonce, ...cipher]),
    sodium.base64_variants.ORIGINAL,
  );
}

function randomDeviceSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function validate(body: Body) {
  if (!body.actor_user_id || !UUID.test(body.actor_user_id)) throw new Error("invalid_actor");
  if (!body.device_id || !UUID.test(body.device_id)) throw new Error("invalid_device");
  if (!body.operation || !["provision", "rotate", "reassign"].includes(body.operation)) {
    throw new Error("invalid_operation");
  }
  if (body.device_uid && !DEVICE_UID.test(body.device_uid)) throw new Error("invalid_device_uid");
  if (body.target_warehouse_id && !UUID.test(body.target_warehouse_id)) {
    throw new Error("invalid_target_warehouse");
  }
  if (body.reason && body.reason.length > 500) throw new Error("invalid_reason");

  if (body.operation === "provision" && (!body.device_uid || !DEVICE_UID.test(body.device_uid))) {
    throw new Error("device_uid_required");
  }
  if (body.operation === "reassign" && !body.target_warehouse_id) {
    throw new Error("target_warehouse_required");
  }
}

export default {
  fetch: withSupabase({ auth: "secret" }, async (req, ctx) => {
    if (req.method !== "POST") return json({ status: "error", message: "method_not_allowed" }, 405);

    try {
      const body = await req.json() as Body;
      validate(body);

      const keyHex = configuration();
      const rawSecret = randomDeviceSecret();
      const encryptedSecret = await encryptDeviceSecret(rawSecret, keyHex);

      const { data: intent, error: intentError } = await ctx.supabaseAdmin.rpc(
        "create_device_provisioning_intent",
        {
          p_actor_user_id: body.actor_user_id,
          p_device_id: body.device_id,
          p_operation: body.operation,
          p_encrypted_secret: encryptedSecret,
          p_requested_device_uid: body.device_uid ?? null,
          p_target_warehouse_id: body.target_warehouse_id ?? null,
          p_reason: body.reason ?? null,
        },
      );

      if (intentError || !intent?.[0]?.intent_token) {
        console.error("create provisioning intent failed", intentError?.message ?? "unknown");
        return json({ status: "error", message: "provisioning_intent_failed" }, 400);
      }

      const { data: consumed, error: consumeError } = await ctx.supabaseAdmin.rpc(
        "consume_device_provisioning_intent",
        {
          p_intent_token: intent[0].intent_token,
          p_encrypted_secret: encryptedSecret,
        },
      );

      if (consumeError || !consumed?.[0]) {
        console.error("consume provisioning intent failed", consumeError?.message ?? "unknown");
        return json({ status: "error", message: "provisioning_consume_failed" }, 400);
      }

      const result = consumed[0];
      return json({
        status: "ok",
        device: {
          id: result.device_id,
          uid: result.device_uid,
          warehouse_id: result.warehouse_id,
          lifecycle_status: result.lifecycle_status,
          credential_version: result.credential_version,
        },
        provisioning: {
          device_secret: rawSecret,
          encrypted_secret: encryptedSecret,
          expires_at: intent[0].expires_at,
        },
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "internal_server_error";
      const known = new Set([
        "invalid_actor",
        "invalid_device",
        "invalid_operation",
        "invalid_device_uid",
        "invalid_target_warehouse",
        "invalid_reason",
        "device_uid_required",
        "target_warehouse_required",
        "server_configuration_error",
      ]);
      return json({ status: "error", message: known.has(code) ? code : "internal_server_error" }, known.has(code) ? 400 : 500);
    }
  }),
};
