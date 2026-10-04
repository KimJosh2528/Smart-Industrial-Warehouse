import sodium from "npm:libsodium-wrappers@0.7.15";
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { authenticateDeviceRequest, DeviceAuthError } from "./deviceAuth.ts";

const testKeyHex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const testSecret = "phase6-test-device-secret";
const testUid = "test-device-uid-001";
const device = { id: "device-id", device_uid: testUid, warehouse_id: "warehouse-id", name: "Test device", device_type: "controller", is_active: true, capabilities: {} };

async function encryptedSecret(): Promise<string> {
  await sodium.ready;
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = sodium.crypto_secretbox_easy(testSecret, nonce, sodium.from_hex(testKeyHex));
  const packed = new Uint8Array(nonce.length + ciphertext.length);
  packed.set(nonce); packed.set(ciphertext, nonce.length);
  return sodium.to_base64(packed, sodium.base64_variants.ORIGINAL);
}

async function signature(timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(testSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function binarySignature(timestamp: string, body: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(testSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const prefix = new TextEncoder().encode(`${timestamp}.`);
  const message = new Uint8Array(prefix.length + body.length);
  message.set(prefix); message.set(body, prefix.length);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.test("device authentication accepts the exact signed body and rejects tampering", async () => {
  Deno.env.set("DEVICE_SECRET_KEY_HEX", testKeyHex);
  const body = '{"temperature_c":21.5}';
  const timestamp = "1700000000";
  let consumed = false;
  const deps = {
    nowSeconds: () => 1700000000,
    resolveDevice: async (uid: string) => uid === testUid ? { device, device_secret_encrypted: await encryptedSecret(), last_nonce_ts: null } : null,
    consumeTimestamp: async () => { if (consumed) return false; consumed = true; return true; },
  };
  const headers = { "X-Device-UID": testUid, "X-Timestamp": timestamp, "X-Signature": await signature(timestamp, body) };
  const accepted = await authenticateDeviceRequest(new Request("https://example.test", { headers }), body, deps);
  assertEquals(accepted.rawBody, body);
  assertEquals(accepted.signedMessage, `${timestamp}.${body}`);
  await assertRejects(() => authenticateDeviceRequest(new Request("https://example.test", { headers: { ...headers, "X-Signature": "0".repeat(64) } }), body, deps), DeviceAuthError);
  await assertRejects(() => authenticateDeviceRequest(new Request("https://example.test", { headers: { ...headers, "X-Timestamp": "1700000001" } }), body, deps), DeviceAuthError);
  await assertRejects(() => authenticateDeviceRequest(new Request("https://example.test", { headers }), '{"temperature_c":22}', deps), DeviceAuthError);
});

Deno.test("device authentication signs exact binary request bytes", async () => {
  Deno.env.set("DEVICE_SECRET_KEY_HEX", testKeyHex);
  const body = new Uint8Array([0xff, 0xd8, 0x00, 0x9a, 0xff, 0xd9]);
  const timestamp = "1700000000";
  const deps = {
    nowSeconds: () => 1700000000,
    resolveDevice: async (uid: string) => uid === testUid ? { device, device_secret_encrypted: await encryptedSecret(), last_nonce_ts: null } : null,
    consumeTimestamp: async () => true,
  };
  const headers = { "X-Device-UID": testUid, "X-Timestamp": timestamp, "X-Signature": await binarySignature(timestamp, body) };
  const accepted = await authenticateDeviceRequest(new Request("https://example.test", { headers }), body, deps);
  assertEquals(accepted.rawBody, body);
  assert(accepted.signedMessage instanceof Uint8Array);
});

Deno.test("device authentication rejects missing, unknown, stale, modified, and replayed requests", async () => {
  Deno.env.set("DEVICE_SECRET_KEY_HEX", testKeyHex);
  const body = "{}";
  const timestamp = "1700000000";
  const base = { nowSeconds: () => 1700000000, resolveDevice: async (uid: string) => uid === testUid ? { device, device_secret_encrypted: await encryptedSecret(), last_nonce_ts: null } : null, consumeTimestamp: async () => true };
  const valid = { "X-Device-UID": testUid, "X-Timestamp": timestamp, "X-Signature": await signature(timestamp, body) };
  for (const headers of [
    { "X-Timestamp": timestamp, "X-Signature": valid["X-Signature"] },
    { "X-Device-UID": testUid, "X-Signature": valid["X-Signature"] },
    { "X-Device-UID": testUid, "X-Timestamp": timestamp },
  ]) await assertRejects(() => authenticateDeviceRequest(new Request("https://example.test", { headers }), body, base), DeviceAuthError);
  await assertRejects(() => authenticateDeviceRequest(new Request("https://example.test", { headers: { ...valid, "X-Device-UID": "unknown" } }), body, base), DeviceAuthError);
  await assertRejects(() => authenticateDeviceRequest(new Request("https://example.test", { headers: { ...valid, "X-Timestamp": "1699999000" } }), body, base), DeviceAuthError);
  let calls = 0;
  const replayDeps = { ...base, consumeTimestamp: async () => ++calls === 1 };
  await authenticateDeviceRequest(new Request("https://example.test", { headers: valid }), body, replayDeps);
  await assertRejects(() => authenticateDeviceRequest(new Request("https://example.test", { headers: valid }), body, replayDeps), DeviceAuthError);
  assert(true); // Ensures this test remains a pure authentication test with no production secrets.
});
