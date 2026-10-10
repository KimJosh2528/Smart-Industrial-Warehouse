import sodium from "npm:libsodium-wrappers@0.7.15";

const TIMESTAMP_TOLERANCE_SECONDS = 60;
const DEVICE_UID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/i;

function adminHeaders(contentType = false): HeadersInit {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    ...(contentType ? { "Content-Type": "application/json" } : {}),
  };
}

export interface DeviceAuthHeaders { deviceUid: string; timestamp: string; signature: string; }
export interface AuthenticatedDevice {
  id: string; device_uid: string; warehouse_id: string; name: string; device_type: string;
  is_active: boolean;
}
export type SignedBody = string | Uint8Array;
export interface SignedRequestContext {
  headers: DeviceAuthHeaders; rawBody: SignedBody; signedMessage: SignedBody; device: AuthenticatedDevice;
}
export class DeviceAuthError extends Error {
  readonly status = 401;
  readonly code: string;
  constructor(code = "authentication_failed") { super("authentication_failed"); this.code = code; }
}
export interface DeviceAuthDependencies {
  resolveDevice?: (deviceUid: string) => Promise<{
    device: AuthenticatedDevice; device_secret_encrypted: string; last_nonce_ts: number | null;
  } | null>;
  consumeTimestamp?: (deviceId: string, timestamp: number) => Promise<boolean>;
  nowSeconds?: () => number;
}

export function readDeviceAuthHeaders(req: Request): DeviceAuthHeaders {
  const deviceUid = req.headers.get("x-device-uid")?.trim() ?? "";
  const timestamp = req.headers.get("x-timestamp")?.trim() ?? "";
  const signature = req.headers.get("x-signature")?.trim() ?? "";
  if (!DEVICE_UID_PATTERN.test(deviceUid) || !/^\d{1,10}$/.test(timestamp) || !SIGNATURE_PATTERN.test(signature)) {
    throw new DeviceAuthError("invalid_headers");
  }
  return { deviceUid, timestamp, signature: signature.toLowerCase() };
}

function constantTimeEqualHex(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

async function decryptDeviceSecret(stored: string): Promise<string> {
  const keyHex = Deno.env.get("DEVICE_SECRET_KEY_HEX") ?? "";
  if (!/^[0-9a-f]{64}$/i.test(keyHex)) throw new DeviceAuthError("secret_key_missing");
  await sodium.ready;
  try {
    const packed = sodium.from_base64(stored, sodium.base64_variants.ORIGINAL);
    const nonceLength = sodium.crypto_secretbox_NONCEBYTES;
    if (packed.length <= nonceLength) throw new Error("invalid_ciphertext");
    const plaintext = sodium.crypto_secretbox_open_easy(
      packed.slice(nonceLength), packed.slice(0, nonceLength), sodium.from_hex(keyHex),
    );
    return sodium.to_string(plaintext);
  } catch { throw new DeviceAuthError("secret_decrypt"); }
}

function signingBytes(timestamp: string, rawBody: SignedBody): Uint8Array {
  const prefix = new TextEncoder().encode(`${timestamp}.`);
  const body = typeof rawBody === "string" ? new TextEncoder().encode(rawBody) : rawBody;
  const message = new Uint8Array(prefix.length + body.length);
  message.set(prefix);
  message.set(body, prefix.length);
  return message;
}

async function hmacSha256Hex(secret: string, message: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, message as BufferSource));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function defaultResolveDevice(deviceUid: string) {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceKey) throw new DeviceAuthError("service_config");
  const response = await fetch(`${url}/rest/v1/devices?device_uid=eq.${encodeURIComponent(deviceUid)}&select=id,device_uid,warehouse_id,name,device_type,is_active,device_secret_encrypted,last_nonce_ts`, { headers: adminHeaders() });
  if (!response.ok) throw new DeviceAuthError(`device_lookup_http_${response.status}`);
  const rows = await response.json() as Array<Record<string, unknown>>;
  const row = rows[0];
  if (!row || row.is_active !== true || typeof row.device_secret_encrypted !== "string") return null;
  return {
    device: { id: String(row.id), device_uid: String(row.device_uid), warehouse_id: String(row.warehouse_id), name: String(row.name), device_type: String(row.device_type), is_active: true },
    device_secret_encrypted: row.device_secret_encrypted, last_nonce_ts: row.last_nonce_ts === null ? null : Number(row.last_nonce_ts),
  };
}

async function defaultConsumeTimestamp(deviceId: string, timestamp: number): Promise<boolean> {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceKey) throw new DeviceAuthError("service_config");
  const response = await fetch(`${url}/rest/v1/devices?id=eq.${encodeURIComponent(deviceId)}&or=(last_nonce_ts.is.null,last_nonce_ts.lt.${timestamp})`, {
    method: "PATCH", headers: { ...adminHeaders(true), Prefer: "return=representation" },
    body: JSON.stringify({ last_nonce_ts: timestamp, last_seen_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new DeviceAuthError("timestamp_update");
  const rows = await response.json() as unknown[];
  return rows.length === 1;
}

export async function authenticateDeviceRequest(req: Request, rawBody: SignedBody, dependencies: DeviceAuthDependencies = {}): Promise<SignedRequestContext> {
  const headers = readDeviceAuthHeaders(req);
  const timestamp = Number(headers.timestamp);
  const now = dependencies.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > TIMESTAMP_TOLERANCE_SECONDS) throw new DeviceAuthError("timestamp_stale");
  const resolved = await (dependencies.resolveDevice ?? defaultResolveDevice)(headers.deviceUid);
  if (!resolved) throw new DeviceAuthError("device_not_found_or_inactive");
  const secret = await decryptDeviceSecret(resolved.device_secret_encrypted);
  const signedMessage = typeof rawBody === "string"
    ? `${headers.timestamp}.${rawBody}`
    : new Uint8Array(signingBytes(headers.timestamp, rawBody));
  const expected = await hmacSha256Hex(secret, signingBytes(headers.timestamp, rawBody));
  if (!constantTimeEqualHex(expected, headers.signature)) throw new DeviceAuthError("hmac_mismatch");
  const consumed = await (dependencies.consumeTimestamp ?? defaultConsumeTimestamp)(resolved.device.id, timestamp);
  if (!consumed) throw new DeviceAuthError("replay_or_timestamp_update");
  return { headers, rawBody, signedMessage, device: resolved.device };
}

export function preserveSignedRequest(req: Request, rawBody: SignedBody): Pick<SignedRequestContext, "headers" | "rawBody" | "signedMessage"> {
  const headers = readDeviceAuthHeaders(req);
  const signedMessage = typeof rawBody === "string"
    ? `${headers.timestamp}.${rawBody}`
    : new Uint8Array(signingBytes(headers.timestamp, rawBody));
  return { headers, rawBody, signedMessage };
}
