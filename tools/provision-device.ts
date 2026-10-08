import sodium from "npm:libsodium-wrappers@0.7.15";

function fail(message: string): never {
  console.error(`Provisioning failed: ${message}`);
  Deno.exit(1);
}

function sanitizeMessage(value: unknown): string {
  if (typeof value !== "string") return "request failed";
  return value
    .replace(/(device_secret_encrypted|DEVICE_SECRET_KEY_HEX|SUPABASE_SECRET_KEYS|SUPABASE_SERVICE_ROLE_KEY|authorization|bearer)/gi, "[redacted]")
    .replace(/[A-Za-z0-9+/=_-]{32,}/g, "[redacted]")
    .slice(0, 500);
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) fail(`Missing value for ${name}.`);
  args.splice(index, 2);
  return value;
}

const args = [...Deno.args];
if (args.includes("--help")) {
  console.log(
    "Usage: deno run --allow-env --allow-net tools/provision-device.ts " +
    "--actor-id <father-admin-uuid> --device-id <uuid> [--uid <uid>] \"Device name\"",
  );
  Deno.exit(0);
}

const actorId = option(args, "--actor-id");
const deviceId = option(args, "--device-id");
const requestedUid = option(args, "--uid");
const deviceName = args.length === 1 ? args[0].trim() : "";

if (!actorId || !/^[0-9a-fA-F-]{36}$/.test(actorId)) fail("Use --actor-id with the Father Admin profile UUID.");
if (!deviceId || !/^[0-9a-fA-F-]{36}$/.test(deviceId)) fail("Use --device-id with a valid vacant device UUID.");
if (!deviceName) fail("Provide exactly one non-empty device name.");
if (requestedUid && !/^[A-Za-z0-9._:-]{1,128}$/.test(requestedUid)) fail("Invalid device UID format.");

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const encryptionKeyHex = Deno.env.get("DEVICE_SECRET_KEY_HEX") ?? "";
if (!supabaseUrl || !serviceRoleKey) fail("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
if (!/^[0-9a-fA-F]{64}$/.test(encryptionKeyHex)) fail("DEVICE_SECRET_KEY_HEX must be a 64-character server key.");

await sodium.ready;

const deviceSecret = sodium.to_hex(sodium.randombytes_buf(32));
const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
const ciphertext = sodium.crypto_secretbox_easy(
  deviceSecret,
  nonce,
  sodium.from_hex(encryptionKeyHex),
);
const packed = new Uint8Array(nonce.length + ciphertext.length);
packed.set(nonce);
packed.set(ciphertext, nonce.length);
const encryptedSecret = sodium.to_base64(packed, sodium.base64_variants.ORIGINAL);

const baseUrl = supabaseUrl.replace(/\/$/, "");
const headers = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  "Content-Type": "application/json",
};

async function rpc(name: string, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`${baseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let message: unknown;
    try {
      const payload = await response.json() as Record<string, unknown>;
      message = payload.message;
    } catch {
      message = undefined;
    }
    fail(`${name} failed (HTTP ${response.status}): ${sanitizeMessage(message)}`);
  }

  return response.json();
}

const intent = await rpc("create_device_provisioning_intent", {
  p_actor_user_id: actorId,
  p_device_id: option(args, "--device-id"),
  p_operation: "provision",
  p_encrypted_secret: encryptedSecret,
  p_requested_device_uid: requestedUid ?? `dev_${sodium.to_hex(sodium.randombytes_buf(12))}`,
  p_target_warehouse_id: warehouseId,
  p_reason: "Initial device provisioning",
});

const intentRow = Array.isArray(intent) ? intent[0] as Record<string, unknown> | undefined : undefined;
const intentToken = typeof intentRow?.intent_token === "string" ? intentRow.intent_token : "";
if (!intentToken) fail("Provisioning intent was created but no one-time token was returned.");

const result = await rpc("consume_device_provisioning_intent", {
  p_intent_token: intentToken,
  p_encrypted_secret: encryptedSecret,
});

const device = Array.isArray(result) ? result[0] as Record<string, unknown> | undefined : undefined;
if (!device?.device_id || !device?.device_uid) fail("Provisioning completed without a device result.");

console.log("Device provisioned.");
console.log(`Device ID: ${String(device.device_id)}`);
console.log(`Device UID: ${String(device.device_uid)}`);
console.log(`Lifecycle: ${String(device.lifecycle_status)}`);
console.log(`Credential version: ${String(device.credential_version)}`);
console.log(`Device secret (displayed once): ${deviceSecret}`);
console.log("Store the secret only in the device's private ignored firmware configuration.");
