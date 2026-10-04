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

function response(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function fingerprintBytes(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
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

async function hmacSha256Hex(secret: string, timestamp: string, body: Uint8Array): Promise<string> {
  const prefix = new TextEncoder().encode(`${timestamp}.`);
  const message = new Uint8Array(prefix.length + body.length);
  message.set(prefix);
  message.set(body, prefix.length);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, message as BufferSource));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function baseResult(deviceUid: string): Record<string, unknown> {
  return {
    device_uid: deviceUid,
    timestamp_present: false,
    timestamp_parse_success: false,
    timestamp_fresh: false,
    body_length: 0,
    body_sha256_fingerprint: null,
    signature_present: false,
    signature_format_valid: false,
    signature_length: 0,
    expected_signature_fingerprint: null,
    received_signature_fingerprint: null,
    hmac_match: false,
    replay_preflight: false,
  };
}

async function readTargetDevice(): Promise<DeviceRow | null> {
  const url = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceRoleKey) return null;
  const query = new URLSearchParams({ device_uid: `eq.${TARGET_DEVICE_UID}`, select: "device_uid,is_active,device_secret_encrypted,last_nonce_ts" });
  const lookup = await fetch(`${url}/rest/v1/devices?${query}`, { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } });
  if (!lookup.ok) return null;
  const rows = await lookup.json() as DeviceRow[];
  return rows.length === 1 && rows[0].device_uid === TARGET_DEVICE_UID ? rows[0] : null;
}

async function decryptStoredSecret(stored: string, keyHex: string): Promise<string | null> {
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) return null;
  await sodium.ready;
  try {
    const packed = sodium.from_base64(stored, sodium.base64_variants.ORIGINAL);
    if (packed.length <= NONCE_LENGTH) return null;
    const plaintext = sodium.crypto_secretbox_open_easy(packed.slice(NONCE_LENGTH), packed.slice(0, NONCE_LENGTH), sodium.from_hex(keyHex));
    return sodium.to_string(plaintext);
  } catch {
    return null;
  }
}

async function postDiagnostic(req: Request): Promise<Response> {
  const deviceUid = req.headers.get("x-device-uid") ?? "";
  const result = baseResult(deviceUid);
  const body = new Uint8Array(await req.arrayBuffer());
  result.body_length = body.length;
  result.body_sha256_fingerprint = await fingerprintBytes(body);

  const timestamp = req.headers.get("x-timestamp");
  const signature = req.headers.get("x-signature");
  result.timestamp_present = timestamp !== null && timestamp.length > 0;
  result.signature_present = signature !== null && signature.length > 0;
  result.signature_length = signature?.length ?? 0;
  result.signature_format_valid = signature !== null && /^[0-9a-f]{64}$/i.test(signature);
  if (signature !== null && signature.length > 0) result.received_signature_fingerprint = await fingerprintText(signature);

  const timestampValidFormat = timestamp !== null && /^\d{1,10}$/.test(timestamp);
  result.timestamp_parse_success = timestampValidFormat;
  const parsedTimestamp = timestampValidFormat ? Number(timestamp) : null;
  if (parsedTimestamp !== null && Number.isSafeInteger(parsedTimestamp)) result.timestamp_fresh = Math.abs(Math.floor(Date.now() / 1000) - parsedTimestamp) <= TIMESTAMP_TOLERANCE_SECONDS;

  const device = await readTargetDevice();
  if (!device || deviceUid !== TARGET_DEVICE_UID) return response(result);
  const lastNoncePresent = typeof device.last_nonce_ts === "number" && Number.isFinite(device.last_nonce_ts);
  result.replay_preflight = parsedTimestamp !== null && (!lastNoncePresent || parsedTimestamp > (device.last_nonce_ts as number));

  const secret = typeof device.device_secret_encrypted === "string"
    ? await decryptStoredSecret(device.device_secret_encrypted, Deno.env.get("DEVICE_SECRET_KEY_HEX") ?? "")
    : null;
  if (secret === null) return response(result);

  const expected = await hmacSha256Hex(secret, timestamp ?? "", body);
  result.expected_signature_fingerprint = await fingerprintText(expected);
  if (signature !== null && result.signature_format_valid) result.hmac_match = constantTimeEqualHex(expected, signature.toLowerCase());
  return response(result);
}

Deno.serve(async (req) => {
  try {
    if (req.method === "POST") return await postDiagnostic(req);
    return response({ status: "diagnostic", message: "method_not_allowed" }, 405);
  } catch {
    return response(baseResult(TARGET_DEVICE_UID));
  }
});
