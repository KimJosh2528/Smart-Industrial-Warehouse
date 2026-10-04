import sodium from "npm:libsodium-wrappers@0.7.15";

const DEVICE_UID = "dev_028eaedec2ec3249a5fa76c2";
const TARGET_PROJECT_URL = "https://odavmzgciaoahebanpmy.supabase.co";
const FIXTURE_PATH = "C:\\Users\\kim joshua\\Downloads\\car with plate number test.jpg";
const TIMESTAMP_TOLERANCE_SECONDS = 60;

function requireEnv(name: string): string {
  const value = Deno.env.get(name) ?? "";
  if (!value) throw new Error(`${name}_missing`);
  return value;
}

async function sha256Fingerprint(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

async function hmacHex(secret: string, timestamp: string, body: Uint8Array): Promise<string> {
  const prefix = new TextEncoder().encode(`${timestamp}.`);
  const message = new Uint8Array(prefix.length + body.length);
  message.set(prefix);
  message.set(body, prefix.length);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function equalHex(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

interface DeviceRow {
  device_uid: string;
  is_active: boolean;
  device_secret_encrypted: string | null;
  last_nonce_ts: number | null;
}

const supabaseUrl = requireEnv("SUPABASE_URL").replace(/\/$/, "");
const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const encryptionKeyHex = requireEnv("DEVICE_SECRET_KEY_HEX");
const testSecret = requireEnv("TEST_DEVICE_HMAC_SECRET");
if (supabaseUrl !== TARGET_PROJECT_URL) throw new Error("unexpected_supabase_url");
if (!/^[0-9a-fA-F]{64}$/.test(encryptionKeyHex)) throw new Error("invalid_device_secret_key_format");

const fixture = await Deno.readFile(FIXTURE_PATH);
const timestamp = Math.floor(Date.now() / 1000);
const timestampText = String(timestamp);
const timestampFreshLocally = Math.abs(Math.floor(Date.now() / 1000) - timestamp) <= TIMESTAMP_TOLERANCE_SECONDS;
const testSecretFormatValid = /^[0-9a-fA-F]{64}$/.test(testSecret);
const testSignature = await hmacHex(testSecret, timestampText, fixture);

const query = new URLSearchParams({
  device_uid: `eq.${DEVICE_UID}`,
  select: "device_uid,is_active,device_secret_encrypted,last_nonce_ts",
});
const response = await fetch(`${supabaseUrl}/rest/v1/devices?${query}`, {
  headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
});
if (!response.ok) throw new Error("device_read_failed");
const rows = await response.json() as DeviceRow[];
const row = rows.length === 1 && rows[0].device_uid === DEVICE_UID ? rows[0] : null;

let localSecretDecryptionSuccess = false;
let plaintextFormatValid = false;
let storedSecretFingerprint: string | null = null;
let hmacMatch = false;

if (row && typeof row.device_secret_encrypted === "string" && row.device_secret_encrypted.length > 0) {
  await sodium.ready;
  try {
    const packed = sodium.from_base64(row.device_secret_encrypted, sodium.base64_variants.ORIGINAL);
    const nonceLength = sodium.crypto_secretbox_NONCEBYTES;
    const plaintext = sodium.crypto_secretbox_open_easy(
      packed.slice(nonceLength),
      packed.slice(0, nonceLength),
      sodium.from_hex(encryptionKeyHex),
    );
    const storedSecret = sodium.to_string(plaintext);
    localSecretDecryptionSuccess = true;
    plaintextFormatValid = /^[0-9a-fA-F]{64}$/.test(storedSecret);
    if (plaintextFormatValid) {
      storedSecretFingerprint = await sha256Fingerprint(storedSecret);
      const storedSignature = await hmacHex(storedSecret, timestampText, fixture);
      hmacMatch = equalHex(testSignature, storedSignature);
    }
  } catch {
    localSecretDecryptionSuccess = false;
  }
}

const encryptedSecretPresent = typeof row?.device_secret_encrypted === "string" && row.device_secret_encrypted.length > 0;
const lastNoncePresent = typeof row?.last_nonce_ts === "number" && Number.isFinite(row.last_nonce_ts);
const replayPreflight = row !== null && (!lastNoncePresent || timestamp > (row.last_nonce_ts as number));
const testSecretFingerprint = await sha256Fingerprint(testSecret);

console.log(JSON.stringify({
  device_found: row !== null,
  device_active: row?.is_active === true,
  encrypted_secret_present: encryptedSecretPresent,
  local_secret_decryption_success: localSecretDecryptionSuccess,
  plaintext_format_valid: localSecretDecryptionSuccess ? plaintextFormatValid : false,
  test_secret_present: testSecret.length > 0,
  test_secret_format_valid: testSecretFormatValid,
  timestamp,
  timestamp_fresh_locally: timestampFreshLocally,
  last_nonce_ts_present: lastNoncePresent,
  replay_preflight: replayPreflight,
  hmac_match_test_secret_vs_stored_secret: hmacMatch,
  test_secret_fingerprint: testSecretFingerprint,
  stored_device_secret_fingerprint: storedSecretFingerprint,
  secret_fingerprint_match: testSecretFingerprint === storedSecretFingerprint,
}));

if (testSecretFingerprint !== storedSecretFingerprint) {
  console.log("LOCAL TEST SECRET DOES NOT MATCH STORED DEVICE SECRET");
}
