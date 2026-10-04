import sodium from "npm:libsodium-wrappers@0.7.15";

const DEVICE_ID = "d9351322-d29b-4f34-ab99-b0d9ca6a118e";
const DEVICE_UID = "dev_028eaedec2ec3249a5fa76c2";
const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/i;

interface DeviceRow {
  id: string;
  device_uid: string;
  is_active: boolean;
  device_secret_encrypted: string | null;
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function runtimeKeyFingerprint(): Promise<Response> {
  const keyHex = Deno.env.get("DEVICE_SECRET_KEY_HEX") ?? "";
  const validFormat = /^[0-9a-f]{64}$/i.test(keyHex);
  if (!validFormat) {
    return jsonResponse({
      status: "key_fingerprint_diagnostic",
      runtime_key_present: keyHex.length > 0,
      runtime_key_valid_format: false,
      runtime_key_fingerprint: null,
    });
  }
  const keyBytes = Uint8Array.from({ length: 32 }, (_, index) => Number.parseInt(keyHex.slice(index * 2, index * 2 + 2), 16));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", keyBytes));
  const fingerprint = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 16);
  return jsonResponse({
    status: "key_fingerprint_diagnostic",
    runtime_key_present: true,
    runtime_key_valid_format: true,
    runtime_key_fingerprint: fingerprint,
  });
}

function adminHeaders(): HeadersInit {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!serviceKey) throw new Error("server_configuration_error");
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
}

async function readDevice(): Promise<DeviceRow | null> {
  const base = Deno.env.get("SUPABASE_URL") ?? "";
  if (!base) throw new Error("server_configuration_error");
  const query = new URLSearchParams({
    id: `eq.${DEVICE_ID}`,
    device_uid: `eq.${DEVICE_UID}`,
    select: "id,device_uid,is_active,device_secret_encrypted",
  });
  const response = await fetch(`${base.replace(/\/$/, "")}/rest/v1/devices?${query}`, {
    headers: adminHeaders(),
  });
  if (!response.ok) throw new Error("database_read_error");
  const rows = await response.json() as DeviceRow[];
  return rows.length === 1 ? rows[0] : null;
}

async function decryptSecret(stored: string): Promise<string | null> {
  const keyHex = Deno.env.get("DEVICE_SECRET_KEY_HEX") ?? "";
  if (!/^[0-9a-f]{64}$/i.test(keyHex)) return null;
  await sodium.ready;
  try {
    const packed = sodium.from_base64(stored, sodium.base64_variants.ORIGINAL);
    const nonceLength = sodium.crypto_secretbox_NONCEBYTES;
    if (packed.length <= nonceLength) return null;
    const plaintext = sodium.crypto_secretbox_open_easy(
      packed.slice(nonceLength),
      packed.slice(0, nonceLength),
      sodium.from_hex(keyHex),
    );
    return sodium.to_string(plaintext);
  } catch {
    return null;
  }
}

async function hmacMatches(secret: string, timestamp: string, body: Uint8Array, signature: string): Promise<boolean> {
  if (!/^\d{1,10}$/.test(timestamp) || !SIGNATURE_PATTERN.test(signature)) return false;
  const messagePrefix = new TextEncoder().encode(`${timestamp}.`);
  const message = new Uint8Array(messagePrefix.length + body.length);
  message.set(messagePrefix);
  message.set(body, messagePrefix.length);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
  let difference = signature.length === 64 ? 0 : 1;
  for (let index = 0; index < 64; index += 1) {
    const expected = digest[index >> 1].toString(16).padStart(2, "0")[index & 1] ?? "0";
    difference |= expected.charCodeAt(0) ^ (signature.toLowerCase()[index] ?? "0").charCodeAt(0);
  }
  return difference === 0;
}

Deno.serve(async (req) => {
  if (req.method === "GET" && new URL(req.url).searchParams.get("mode") === "key-fingerprint") {
    if (req.headers.get("x-device-uid")?.trim() !== DEVICE_UID) {
      return jsonResponse({ status: "key_fingerprint_diagnostic", runtime_key_present: false, runtime_key_valid_format: false, runtime_key_fingerprint: null }, 403);
    }
    try {
      return await runtimeKeyFingerprint();
    } catch {
      return jsonResponse({ status: "key_fingerprint_diagnostic", runtime_key_present: false, runtime_key_valid_format: false, runtime_key_fingerprint: null }, 500);
    }
  }
  if (req.method !== "POST") return jsonResponse({ status: "diagnostic", message: "method_not_allowed" }, 405);
  if (req.headers.get("x-device-uid")?.trim() !== DEVICE_UID) {
    return jsonResponse({ status: "diagnostic", message: "device_not_allowed" }, 403);
  }

  try {
    const row = await readDevice();
    const deviceFound = row !== null;
    const deviceActive = row?.is_active === true;
    const encryptedSecretPresent = typeof row?.device_secret_encrypted === "string" && row.device_secret_encrypted.length > 0;
    let secretDecryptionSuccess = false;
    let hmacMatch = false;

    if (encryptedSecretPresent && row) {
      const secret = await decryptSecret(row.device_secret_encrypted as string);
      secretDecryptionSuccess = secret !== null;
      if (secret !== null) {
        const body = new Uint8Array(await req.arrayBuffer());
        hmacMatch = await hmacMatches(
          secret,
          req.headers.get("x-timestamp")?.trim() ?? "",
          body,
          req.headers.get("x-signature")?.trim() ?? "",
        );
      }
    }

    return jsonResponse({
      status: "diagnostic",
      device_found: deviceFound,
      device_active: deviceActive,
      encrypted_secret_present: encryptedSecretPresent,
      secret_decryption_success: secretDecryptionSuccess,
      hmac_match: hmacMatch,
    });
  } catch {
    return jsonResponse({ status: "diagnostic", message: "diagnostic_error" }, 500);
  }
});
