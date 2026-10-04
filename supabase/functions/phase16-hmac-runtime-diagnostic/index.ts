import sodium from "npm:libsodium-wrappers@0.7.15";

const TARGET_DEVICE_UID = "dev_028eaedec2ec3249a5fa76c2";
const NONCE_LENGTH = 24;
const TIMESTAMP_TOLERANCE_SECONDS = 60;

interface DeviceRow {
  device_uid: string;
  is_active: boolean;
  device_secret_encrypted: string | null;
  last_nonce_ts: number | null;
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function baseResult(deviceUid: string): Record<string, unknown> {
  return {
    device_uid: deviceUid,
    device_found: false,
    device_active: false,
    encrypted_secret_present: false,
    runtime_key_present: false,
    runtime_key_format_valid: false,
    runtime_key_fingerprint: null,
    decryption_success: false,
    decrypted_secret_format_valid: false,
    decrypted_secret_fingerprint: null,
    request_timestamp: null,
    timestamp_fresh: false,
    body_length: 0,
    hmac_computed: false,
    signature_format_valid: false,
    signature_match: false,
    last_nonce_ts_present: false,
    timestamp_greater_than_last_nonce: false,
    replay_check_passed: false,
  };
}

async function fingerprintBytes(value: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", value as BufferSource));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

async function fingerprintText(value: string): Promise<string> {
  return fingerprintBytes(new TextEncoder().encode(value));
}

function constantTimeEqualHex(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

async function hmacHex(secret: string, timestamp: string, body: Uint8Array): Promise<string> {
  const prefix = new TextEncoder().encode(`${timestamp}.`);
  const message = new Uint8Array(prefix.length + body.length);
  message.set(prefix);
  message.set(body, prefix.length);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, message as BufferSource));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readDevice(): Promise<DeviceRow | null> {
  const url = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceKey) return null;
  const query = new URLSearchParams({
    device_uid: `eq.${TARGET_DEVICE_UID}`,
    select: "device_uid,is_active,device_secret_encrypted,last_nonce_ts",
  });
  const result = await fetch(`${url}/rest/v1/devices?${query}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!result.ok) return null;
  const rows = await result.json() as DeviceRow[];
  return rows.length === 1 && rows[0].device_uid === TARGET_DEVICE_UID ? rows[0] : null;
}

async function decryptSecret(stored: string, keyHex: string): Promise<string | null> {
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) return null;
  await sodium.ready;
  try {
    const packed = sodium.from_base64(stored, sodium.base64_variants.ORIGINAL);
    if (packed.length <= NONCE_LENGTH) return null;
    const plaintext = sodium.crypto_secretbox_open_easy(
      packed.slice(NONCE_LENGTH), packed.slice(0, NONCE_LENGTH), sodium.from_hex(keyHex),
    );
    return sodium.to_string(plaintext);
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  const deviceUid = req.headers.get("x-device-uid") ?? "";
  const result = baseResult(deviceUid);
  if (req.method !== "POST" || deviceUid !== TARGET_DEVICE_UID) return json(result, 400);

  try {
    const body = new Uint8Array(await req.arrayBuffer());
    result.body_length = body.length;
    const timestamp = req.headers.get("x-timestamp") ?? "";
    const signature = req.headers.get("x-signature") ?? "";
    result.request_timestamp = /^\d{1,10}$/.test(timestamp) ? Number(timestamp) : null;
    result.timestamp_fresh = result.request_timestamp !== null && Number.isSafeInteger(result.request_timestamp) && Math.abs(Math.floor(Date.now() / 1000) - (result.request_timestamp as number)) <= TIMESTAMP_TOLERANCE_SECONDS;
    result.signature_format_valid = /^[0-9a-f]{64}$/i.test(signature);

    const runtimeKeyHex = Deno.env.get("DEVICE_SECRET_KEY_HEX") ?? "";
    result.runtime_key_present = runtimeKeyHex.length > 0;
    result.runtime_key_format_valid = /^[0-9a-fA-F]{64}$/.test(runtimeKeyHex);
    if (result.runtime_key_format_valid) {
      const keyBytes = Uint8Array.from({ length: 32 }, (_, index) => Number.parseInt(runtimeKeyHex.slice(index * 2, index * 2 + 2), 16));
      result.runtime_key_fingerprint = await fingerprintBytes(keyBytes);
    }

    const device = await readDevice();
    result.device_found = device !== null;
    result.device_active = device?.is_active === true;
    result.encrypted_secret_present = typeof device?.device_secret_encrypted === "string" && device.device_secret_encrypted.length > 0;
    if (!device) return json(result);

    const hasLastNonce = typeof device.last_nonce_ts === "number" && Number.isFinite(device.last_nonce_ts);
    result.last_nonce_ts_present = hasLastNonce;
    result.timestamp_greater_than_last_nonce = result.request_timestamp !== null && (!hasLastNonce || (result.request_timestamp as number) > (device.last_nonce_ts as number));
    result.replay_check_passed = result.timestamp_greater_than_last_nonce;

    if (!result.encrypted_secret_present) return json(result);
    const secret = await decryptSecret(device.device_secret_encrypted as string, runtimeKeyHex);
    result.decryption_success = secret !== null;
    result.decrypted_secret_format_valid = secret !== null && /^[0-9a-fA-F]{64}$/.test(secret);
    if (!secret || !result.decrypted_secret_format_valid) return json(result);
    result.decrypted_secret_fingerprint = await fingerprintText(secret);

    const expected = await hmacHex(secret, timestamp, body);
    result.hmac_computed = true;
    if (result.signature_format_valid) result.signature_match = constantTimeEqualHex(expected, signature.toLowerCase());
    return json(result);
  } catch {
    return json(baseResult(TARGET_DEVICE_UID), 200);
  }
});
