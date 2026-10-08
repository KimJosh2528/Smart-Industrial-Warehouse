import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import sodiumModule from "npm:libsodium-wrappers@0.7.15";

const sodium = sodiumModule as any;

type Operation = "provision" | "rotate" | "reassign";
type Body = {
  device_id?: unknown;
  operation?: unknown;
  device_uid?: unknown;
  target_warehouse_id?: unknown;
  reason?: unknown;
  actor_user_id?: unknown;
  [key: string]: unknown;
};

type ProvisionResult = {
  device_id: string;
  device_uid: string;
  warehouse_id: string;
  lifecycle_status: string;
  credential_version: number;
};

type IntentResult = { intent_token: string; expires_at: string };

type ProvisionDependencies = {
  getUserId?: (token: string) => Promise<string | null>;
  isFatherAdmin?: (userId: string) => Promise<boolean>;
  createIntent?: (args: Record<string, unknown>) => Promise<IntentResult>;
  consumeIntent?: (args: Record<string, unknown>) => Promise<ProvisionResult>;
  generateSecret?: () => string;
  encryptSecret?: (secret: string, keyHex: string) => Promise<string>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEVICE_UID = /^[A-Za-z0-9._:-]{1,128}$/;
const ALLOWED_FIELDS = new Set([
  "device_id",
  "operation",
  "device_uid",
  "target_warehouse_id",
  "reason",
  "actor_user_id",
]);

function json(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
  });
}

function bearerToken(request: Request): string | null {
  const value = request.headers.get("authorization");
  if (!value) return null;
  const match = /^Bearer ([^\s]+)$/.exec(value);
  return match?.[1] ?? null;
}

function configuration() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authKey = Deno.env.get("SUPABASE_ANON_KEY") ?? serviceRoleKey;
  const secretKeyHex = Deno.env.get("DEVICE_SECRET_KEY_HEX");
  if (!url || !serviceRoleKey || !authKey || !secretKeyHex || !/^[0-9a-f]{64}$/i.test(secretKeyHex)) {
    throw new Error("server_configuration_error");
  }
  return { url, serviceRoleKey, authKey, secretKeyHex };
}

function client(url: string, key: string): SupabaseClient {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function validateBody(value: unknown): { body: Body; operation: Operation } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_body");
  const body = value as Body;
  for (const key of Object.keys(body)) {
    if (!ALLOWED_FIELDS.has(key)) throw new Error("unknown_field");
  }
  if (Object.prototype.hasOwnProperty.call(body, "actor_user_id")) throw new Error("actor_user_id_forbidden");
  if (typeof body.operation !== "string" || !["provision", "rotate", "reassign"].includes(body.operation)) {
    throw new Error("invalid_operation");
  }
  const operation = body.operation as Operation;
  if (typeof body.device_id !== "string" || !UUID.test(body.device_id)) throw new Error("invalid_device_id");
  if (body.device_uid !== undefined && (typeof body.device_uid !== "string" || !DEVICE_UID.test(body.device_uid))) {
    throw new Error("invalid_device_uid");
  }
  if (operation === "provision" && body.device_uid === undefined) throw new Error("device_uid_required");
  if (body.target_warehouse_id !== undefined && (typeof body.target_warehouse_id !== "string" || !UUID.test(body.target_warehouse_id))) {
    throw new Error("invalid_target_warehouse_id");
  }
  if (operation === "reassign" && body.target_warehouse_id === undefined) throw new Error("target_warehouse_required");
  if (operation !== "reassign" && body.target_warehouse_id !== undefined) throw new Error("unexpected_target_warehouse");
  if (body.reason !== undefined && (typeof body.reason !== "string" || body.reason.length > 200)) throw new Error("invalid_reason");
  return { body, operation };
}

function randomDeviceSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function encryptDeviceSecret(secret: string, keyHex: string): Promise<string> {
  await sodium.ready;
  const key = sodium.from_hex(keyHex);
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = sodium.crypto_secretbox_easy(sodium.from_string(secret), nonce, key);
  return sodium.to_base64(
    new Uint8Array([...nonce, ...ciphertext]),
    sodium.base64_variants.ORIGINAL,
  );
}

export function mapRpcError(error: unknown): string {
  const message = String((error as { message?: unknown } | null)?.message ?? "").toLowerCase();
  if (message.includes("device is not vacant")) return "device_not_vacant";
  if (message.includes("father admin actor required")) return "not_authorized";
  if (message.includes("device not found")) return "device_not_found";
  if (
    message.includes("provisioning intent is invalid or expired") ||
    message.includes("device changed since provisioning intent was issued") ||
    message.includes("provisioning credential mismatch")
  ) return "intent_failed";
  return "provisioning_failed";
}

function productionDependencies(config: ReturnType<typeof configuration>): ProvisionDependencies {
  const admin = client(config.url, config.serviceRoleKey);
  const auth = client(config.url, config.authKey);
  return {
    getUserId: async (token) => {
      const { data, error } = await auth.auth.getUser(token);
      if (error || !data.user) return null;
      return data.user.id;
    },
    isFatherAdmin: async (userId) => {
      const { data, error } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
      if (error) throw new Error("profile_lookup_failed");
      return data?.role === "father_admin";
    },
    createIntent: async (args) => {
      const { data, error } = await admin.rpc("create_device_provisioning_intent", args);
      if (error) throw new Error(mapRpcError(error));
      if (!data) throw new Error("provisioning_failed");
      return (Array.isArray(data) ? data[0] : data) as IntentResult;
    },
    consumeIntent: async (args) => {
      const { data, error } = await admin.rpc("consume_device_provisioning_intent", args);
      if (error) throw new Error(mapRpcError(error));
      if (!data) throw new Error("provisioning_failed");
      return (Array.isArray(data) ? data[0] : data) as ProvisionResult;
    },
    generateSecret: randomDeviceSecret,
    encryptSecret: encryptDeviceSecret,
  };
}

const VALIDATION_CODES = new Set([
  "invalid_body",
  "invalid_json",
  "unknown_field",
  "actor_user_id_forbidden",
  "invalid_operation",
  "invalid_device_id",
  "invalid_device_uid",
  "device_uid_required",
  "invalid_target_warehouse_id",
  "target_warehouse_required",
  "unexpected_target_warehouse",
  "invalid_reason",
]);

function safeCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (VALIDATION_CODES.has(message)) return message;
  if (message === "server_configuration_error" || message === "profile_lookup_failed") return message;
  if (message === "device_not_vacant" || message === "not_authorized" || message === "device_not_found" || message === "intent_failed" || message === "provisioning_failed") {
    return message;
  }
  return "provisioning_failed";
}

function statusForCode(code: string): number {
  if (code === "server_configuration_error" || code === "profile_lookup_failed") return 500;
  if (code === "not_authorized") return 403;
  if (code === "device_not_found") return 404;
  if (code === "device_not_vacant") return 409;
  return 400;
}

export function createProvisionHandler(overrides: ProvisionDependencies = {}) {
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") return new Response(null, { status: 204 });
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    const token = bearerToken(request);
    if (!token) return json({ error: "unauthorized" }, 401);

    try {
      const config = configuration();
      const deps = { ...productionDependencies(config), ...overrides };
      const actorUserId = await deps.getUserId!(token);
      if (!actorUserId) return json({ error: "unauthorized" }, 401);
      if (!(await deps.isFatherAdmin!(actorUserId))) return json({ error: "not_authorized" }, 403);

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ error: "invalid_json" }, 400);
      }
      const parsed = validateBody(body);
      const rawSecret = deps.generateSecret!();
      const encryptedSecret = await deps.encryptSecret!(rawSecret, config.secretKeyHex);
      const intent = await deps.createIntent!({
        p_actor_user_id: actorUserId,
        p_device_id: parsed.body.device_id,
        p_operation: parsed.operation,
        p_encrypted_secret: encryptedSecret,
        p_requested_device_uid: parsed.body.device_uid ?? null,
        p_target_warehouse_id: parsed.body.target_warehouse_id ?? null,
        p_reason: parsed.body.reason ?? null,
      });
      const result = await deps.consumeIntent!({
        p_intent_token: intent.intent_token,
        p_encrypted_secret: encryptedSecret,
      });
      return json({ ...result, device_secret: rawSecret });
    } catch (error) {
      const code = safeCode(error);
      console.error(`device-provision failed: ${code}`);
      return json({ error: code }, statusForCode(code));
    }
  };
}
