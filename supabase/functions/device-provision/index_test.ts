import sodium from "npm:libsodium-wrappers@0.7.15";
import { assert, assertEquals, assertFalse, assertStringIncludes } from "jsr:@std/assert@1";
import { createProvisionHandler, encryptDeviceSecret } from "./index.ts";

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

function request(method = "POST", body?: unknown, token = "test-jwt") {
  return new Request("https://example.test", {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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

Deno.test("requires a valid bearer token", async () => {
  configureTestEnvironment();
  const handler = createProvisionHandler(dependencies({ getUserId: async () => null }));
  assertEquals((await handler(request("POST", {}))).status, 401);
});

Deno.test("rejects actor_user_id supplied by the caller", async () => {
  configureTestEnvironment();
  const handler = createProvisionHandler(dependencies());
  const response = await handler(request("POST", { actor_user_id: ACTOR_ID }));
  assertEquals(response.status, 400);
  assertEquals((await responseBody(response)).error, "actor_user_id_forbidden");
});

Deno.test("requires Father Admin authorization", async () => {
  configureTestEnvironment();
  const handler = createProvisionHandler(dependencies({ isFatherAdmin: async () => false }));
  assertEquals((await handler(request("POST", { operation: "rotate", device_id: DEVICE_ID }))).status, 403);
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

Deno.test("returns the raw secret once without encrypted_secret", async () => {
  configureTestEnvironment();
  let createArgs: Record<string, unknown> | undefined;
  const handler = createProvisionHandler(dependencies({
    createIntent: async (args: Record<string, unknown>) => {
      createArgs = args;
      return { intent_token: "intent-test", expires_at: new Date().toISOString() };
    },
  }));
  const response = await handler(request("POST", { operation: "provision", device_id: DEVICE_ID, device_uid: "warehouse-gateway-01" }));
  const body = await responseBody(response);
  assertEquals(response.status, 200);
  assertEquals(body.device_secret, "aa".repeat(32));
  assertFalse(Object.prototype.hasOwnProperty.call(body, "encrypted_secret"));
  assertEquals(response.headers.get("Cache-Control"), "no-store");
  assertEquals(createArgs?.p_actor_user_id, ACTOR_ID);
});

Deno.test("maps RPC errors safely and does not log secrets", async () => {
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
