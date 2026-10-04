import sodium from "npm:libsodium-wrappers@0.7.15";

function fail(message: string): never {
  console.error(`Provisioning failed: ${message}`);
  Deno.exit(1);
}

function sanitizePostgrestMessage(value: unknown): string {
  if (typeof value !== "string") return "request failed";
  return value
    .replace(/(device_secret_encrypted|DEVICE_SECRET_KEY_HEX|SUPABASE_SERVICE_ROLE_KEY|authorization|bearer)/gi, "[redacted]")
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
  console.log("Usage: deno run --allow-env --allow-net tools/provision-device.ts --warehouse-id <uuid> \"Device name\"");
  Deno.exit(0);
}

const warehouseId = option(args, "--warehouse-id");
const deviceType = option(args, "--device-type") ?? "controller";
const requestedUid = option(args, "--uid");
const deviceName = args.length === 1 ? args[0].trim() : "";

if (!warehouseId || !/^[0-9a-fA-F-]{36}$/.test(warehouseId)) fail("Use --warehouse-id with a valid warehouse UUID.");
if (!deviceName) fail("Provide exactly one non-empty device name.");
if (!["controller", "camera", "sensor_module", "access_module", "other"].includes(deviceType)) fail("Invalid device type.");
if (requestedUid && !/^[A-Za-z0-9._:-]{1,128}$/.test(requestedUid)) fail("Invalid device UID format.");

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const encryptionKeyHex = Deno.env.get("DEVICE_SECRET_KEY_HEX") ?? "";
if (!supabaseUrl || !serviceRoleKey) fail("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
if (!/^[0-9a-fA-F]{64}$/.test(encryptionKeyHex)) fail("DEVICE_SECRET_KEY_HEX must be a 64-character hexadecimal server key.");

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

let created: { id: string; device_uid: string } | undefined;
for (let attempt = 0; attempt < 5 && !created; attempt += 1) {
  const deviceUid = requestedUid ?? `dev_${sodium.to_hex(sodium.randombytes_buf(12))}`;
  const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/devices`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      warehouse_id: warehouseId,
      name: deviceName,
      device_type: deviceType,
      device_uid: deviceUid,
      device_secret_encrypted: encryptedSecret,
      capabilities: {},
    }),
  });

  if (response.ok) {
    const rows = await response.json() as Array<{ id: string; device_uid: string }>;
    created = rows[0];
    break;
  }

  if (response.status === 409 && !requestedUid) continue;
  if (response.status === 409) fail("The requested device UID already exists.");

  let code = "unknown";
  let message: unknown;
  try {
    const payload = await response.json() as Record<string, unknown>;
    if (typeof payload.code === "string") code = payload.code.slice(0, 64);
    message = payload.message;
  } catch {
    message = undefined;
  }
  fail(`HTTP status: ${response.status}\nPostgREST code: ${code}\nMessage: ${sanitizePostgrestMessage(message)}`);
}

if (!created) fail("Could not generate a unique device UID.");

console.log("Device created.");
console.log(`Device ID: ${created.id}`);
console.log(`Device UID: ${created.device_uid}`);
console.log(`Device secret (displayed once): ${deviceSecret}`);
console.log("Store the secret only in the device's private ignored firmware configuration.");
