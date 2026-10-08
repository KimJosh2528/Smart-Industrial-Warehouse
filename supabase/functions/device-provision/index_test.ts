import sodiumModule from "npm:libsodium-wrappers@0.7.15";
import { assert, assertEquals, assertFalse, assertStringIncludes } from "jsr:@std/assert@1";
import { createProvisionHandler, encryptDeviceSecret, mapRpcError } from "./handler.ts";

const sodium = sodiumModule as any;

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const DEVICE_ID = "22222222-2222-4222-8222-222222222222";
const WAREHOUSE_ID = "33333333-3333-4333-8333-333333333333";
const KEY_HEX = "11".repeat(32);

function configureTestEnvironment() {
  Deno.env.set("SUPABASE_URL", "https://example.supabase.test");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-test-key");
  Deno.env.set("SUPABASE_ANON_KEY", "anon-test-key");
  Deno.env.set("DEVICE_SECRET_KEY_HEX", KEY_HEX);
}

function request(method = "POST", body?: unknown, token: string | null = "test-jwt") {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token !== null) headers.set("Authorization", `Bearer ${token}`);
  return new Request("https://example.test", {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function rawRequest(body: string, token: string | null = "test-jwt") {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token !== null) headers.set("Authorization", `Bearer ${token}`);
  return new Request("https://example.test", { method: "POST", headers, body });
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    getUserId: async () => ACTOR_ID,
    isFatherAdmin: async () => true,
    generateSecret: () => "aa".repeat(32),
    encryptSecret: async (secret: string, key: string) => encryptDeviceSecret(secret, key),
    createIntent: async () => ({ intent_token: "intent-test", expires_at: new Date().toISOString() }),
    consumeIntent: async () => ({
      device_id: DEVICE_ID,
      device_uid: "warehouse-gateway-01",
      warehouse_id: WAREHOUSE_ID,
      lifecycle_status: "provisioned",
      credential_version: 1,
    }),
    ...overrides,
  };
}

async function responseBody(response: Response) {
  return await response.json() as Record<string, unknown>;
}

Deno.test("missing or invalid bearer token returns 401", async () => {
  configureTestEnvironment();
  const missing = createProvisionHandler(dependencies());
  assertEquals((await missing(request("POST", {}, null))).status, 401);
  const invalid = createProvisionHandler(dependencies({ getUserId: async () => null }));
  assertEquals((await invalid(request("POST", {}))).status, 401);
});

Deno.test("rejects actor_user_id supplied by the caller", async () => {
  configureTestEnvironment();
  const handler = createProvisionHandler(dependencies());
  const response = await handler(request("POST", { actor_user_id: ACTOR_ID }));
  assertEquals(response.status, 400);
  assertEquals((await responseBody(response)).error, "actor_user_id_forbidden");
});

Deno.test("Father Admin authorization happens before body validation", async () => {
  configureTestEnvironment();
  const handler = createProvisionHandler(dependencies({ isFatherAdmin: async () => false }));
  const response = await handler(rawRequest("not-json"));
  assertEquals(response.status, 403);
  assertEquals((await responseBody(response)).error, "not_authorized");
});

Deno.test("returns 500 for server configuration errors and 400 for invalid JSON", async () => {
  configureTestEnvironment();
  Deno.env.delete("DEVICE_SECRET_KEY_HEX");
  const configurationFailure = createProvisionHandler(dependencies());
  assertEquals((await configurationFailure(request("POST", {}))).status, 500);
  assertEquals((await configurationFailure(request("POST", {})).then(responseBody)).error, "server_configuration_error");

  configureTestEnvironment();
  const invalidJson = createProvisionHandler(dependencies());
  const response = await invalidJson(rawRequest("not-json"));
  assertEquals(response.status, 400);
  assertEquals((await responseBody(response)).error, "invalid_json");
});

Deno.test("rejects invalid fields and methods", async () => {
  configureTestEnvironment();
  const handler = createProvisionHandler(dependencies());
  assertEquals((await handler(request("GET"))).status, 405);
  assertEquals((await handler(request("POST", { operation: "delete", device_id: DEVICE_ID }))).status, 400);
  assertEquals((await handler(request("POST", { operation: "rotate", device_id: "not-a-uuid" }))).status, 400);
  assertEquals((await handler(request("POST", { operation: "provision", device_id: DEVICE_ID, device_uid: "bad space" }))).status, 400);
  assertEquals((await handler(request("POST", { operation: "rotate", device_id: DEVICE_ID, unexpected: true }))).status, 400);
});

Deno.test("maps provision, rotate, and reassign arguments", async () => {
  configureTestEnvironment();
  const calls: Record<string, unknown>[] = [];
  const handler = createProvisionHandler(dependencies({
    createIntent: async (args: Record<string, unknown>) => {
      calls.push(args);
      return { intent_token: "intent-test", expires_at: new Date().toISOString() };
    },
  }));
  await handler(request("POST", { operation: "provision", device_id: DEVICE_ID, device_uid: "device-1", reason: "new" }));
  await handler(request("POST", { operation: "rotate", device_id: DEVICE_ID, reason: "rotate" }));
  await handler(request("POST", { operation: "reassign", device_id: DEVICE_ID, target_warehouse_id: WAREHOUSE_ID, reason: "move" }));
  assertEquals(calls.map((call) => call.p_operation), ["provision", "rotate", "reassign"]);
  assertEquals(calls[0].p_requested_device_uid, "device-1");
  assertEquals(calls[1].p_requested_device_uid, null);
  assertEquals(calls[2].p_target_warehouse_id, WAREHOUSE_ID);
  assertEquals(calls[0].p_target_warehouse_id, null);
});

Deno.test("returns the raw secret once without encrypted_secret", async () => {
  configureTestEnvironment();
  const handler = createProvisionHandler(dependencies());
  const response = await handler(request("POST", { operation: "provision", device_id: DEVICE_ID, device_uid: "warehouse-gateway-01" }));
  const body = await responseBody(response);
  assertEquals(response.status, 200);
  assertEquals(body.device_secret, "aa".repeat(32));
  assertFalse(Object.prototype.hasOwnProperty.call(body, "encrypted_secret"));
  assertEquals(response.headers.get("Cache-Control"), "no-store");
});

Deno.test("maps every RPC error to a safe code and status", async () => {
  const cases = [
    ["device is not vacant", "device_not_vacant", 409],
    ["father admin actor required", "not_authorized", 403],
    ["device not found", "device_not_found", 404],
    ["provisioning intent is invalid or expired", "intent_failed", 400],
    ["device changed since provisioning intent was issued", "intent_failed", 400],
    ["provisioning credential mismatch", "intent_failed", 400],
    ["unexpected database failure", "provisioning_failed", 400],
  ] as const;
  for (const [raw, expected, status] of cases) {
    assertEquals(mapRpcError(new Error(raw)), expected);
    configureTestEnvironment();
    const handler = createProvisionHandler(dependencies({
      createIntent: async () => { throw new Error(expected); },
    }));
    const response = await handler(request("POST", { operation: "rotate", device_id: DEVICE_ID }));
    assertEquals(response.status, status);
    assertEquals((await responseBody(response)).error, expected);
  }
});

Deno.test("does not leak raw RPC errors or secrets", async () => {
  configureTestEnvironment();
  const original = console.error;
  const logs: string[] = [];
  console.error = (...args: unknown[]) => logs.push(args.join(" "));
  try {
    const handler = createProvisionHandler(dependencies({
      createIntent: async () => { throw new Error(`raw-rpc-error ${"aa".repeat(32)}`); },
    }));
    const response = await handler(request("POST", { operation: "rotate", device_id: DEVICE_ID }));
    const body = await responseBody(response);
    assertEquals(response.status, 400);
    assertEquals(body.error, "provisioning_failed");
    assertFalse(logs.some((line) => line.includes("aa".repeat(32))));
    assertFalse(JSON.stringify(body).includes("raw-rpc-error"));
  } finally {
    console.error = original;
  }
});

Deno.test("uses the same Secretbox format as deviceAuth", async () => {
  const secret = "aa".repeat(32);
  const encoded = await encryptDeviceSecret(secret, KEY_HEX);
  await sodium.ready;
  const packed = sodium.from_base64(encoded, sodium.base64_variants.ORIGINAL);
  const nonce = packed.slice(0, sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = packed.slice(sodium.crypto_secretbox_NONCEBYTES);
  const plaintext = sodium.crypto_secretbox_open_easy(ciphertext, nonce, sodium.from_hex(KEY_HEX));
  assertStringIncludes(sodium.to_string(plaintext), secret);
  assert(plaintext.length === secret.length);
});
