import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { jsonResponse, methodNotAllowed } from "../_shared/response.ts";

const SUPPORTED_TYPES = new Set([
  "staff_rfid",
  "staff_pin",
  "truck_rfid",
  "truck_pin",
]);
const STAFF_TYPES = new Set(["staff_rfid", "staff_pin"]);
const TRUCK_TYPES = new Set(["truck_rfid", "truck_pin"]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CredentialType = "staff_rfid" | "staff_pin" | "truck_rfid" | "truck_pin";
type Operation = "create" | "replace" | "activate" | "deactivate" | "view";

interface CredentialRow {
  id: string;
  warehouse_id: string;
  staff_member_id: string | null;
  truck_id: string | null;
  credential_type: CredentialType;
  is_active: boolean;
}

interface WarehouseRow {
  id: string;
  system_admin_id: string | null;
}

function configuration(): { url: string; serviceKey: string; encryptionKey: string; authKey: string } {
  const url = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const encryptionKey = Deno.env.get("CREDENTIAL_ENCRYPTION_KEY_HEX") ?? "";
  const authKey = Deno.env.get("SUPABASE_ANON_KEY") ?? serviceKey;
  if (!url || !serviceKey || !authKey || !/^[0-9a-f]{64}$/i.test(encryptionKey)) {
    throw new Error("server_configuration_error");
  }
  return { url, serviceKey, encryptionKey, authKey };
}

function adminClient(url: string, serviceKey: string): SupabaseClient {
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() || null : null;
}

function normalizeCredential(type: CredentialType, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("credential_required");
  if (type.endsWith("rfid")) {
    const canonical = trimmed.toLowerCase();
    if (!/^[0-9a-f]+$/.test(canonical) || canonical.length % 2 !== 0) {
      throw new Error("invalid_rfid");
    }
    return canonical;
  }
  if (!/^[0-9]{4,6}$/.test(trimmed)) throw new Error("invalid_pin");
  return trimmed;
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function encryptionKey(keyHex: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(hexToBytes(keyHex)),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptValue(value: string, keyHex: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(keyHex),
    toArrayBuffer(new TextEncoder().encode(value)),
  );
  return `v1.${base64Url(iv)}.${base64Url(new Uint8Array(ciphertext))}`;
}

async function decryptValue(encoded: string, keyHex: string): Promise<string> {
  const [version, ivValue, ciphertextValue] = encoded.split(".");
  if (version !== "v1" || !ivValue || !ciphertextValue) throw new Error("invalid_ciphertext");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(fromBase64Url(ivValue)) },
    await encryptionKey(keyHex),
    toArrayBuffer(fromBase64Url(ciphertextValue)),
  );
  return new TextDecoder().decode(plaintext);
}

async function hashValue(value: string): Promise<string> {
  return bytesToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function authorizedWarehouse(
  client: SupabaseClient,
  warehouseId: string,
  userId: string,
  role: string,
): Promise<boolean> {
  if (role === "father_admin") return true;
  if (role !== "system_admin") return false;
  const { data, error } = await client
    .from("warehouses")
    .select("id,system_admin_id")
    .eq("id", warehouseId)
    .maybeSingle<WarehouseRow>();
  return !error && data?.system_admin_id === userId;
}

function safeError(error: unknown): Response {
  const code = error instanceof Error ? error.message : "internal_server_error";
  const known = new Set([
    "not_authenticated",
    "forbidden",
    "invalid_request",
    "credential_required",
    "invalid_rfid",
    "invalid_pin",
    "unsupported_credential_type",
    "credential_not_owned",
    "credential_value_unavailable",
    "credential_already_exists",
  ]);
  return jsonResponse({ status: "error", message: known.has(code) ? code : "internal_server_error" }, known.has(code) ? 400 : 500);
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return methodNotAllowed(["POST"]);

  try {
    const config = configuration();
    const token = bearerToken(request);
    if (!token) return jsonResponse({ status: "error", message: "not_authenticated" }, 401);

    const userClient = createClient(config.url, config.authKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) return jsonResponse({ status: "error", message: "not_authenticated" }, 401);

    const body = await request.json() as Record<string, unknown>;
    const operation = body.operation;
    const credentialType = body.credential_type;
    const credentialId = typeof body.credential_id === "string" ? body.credential_id : null;
    const rawValue = typeof body.credential_value === "string" ? body.credential_value : null;
    if (!['create', 'replace', 'activate', 'deactivate', 'view'].includes(String(operation))) throw new Error("invalid_request");
    if (typeof credentialType !== "string" || !SUPPORTED_TYPES.has(credentialType)) throw new Error("unsupported_credential_type");
    if (credentialType === "staff_face") throw new Error("unsupported_credential_type");
    const typedCredentialType = credentialType as CredentialType;
    if (credentialId && !UUID_PATTERN.test(credentialId)) throw new Error("invalid_request");

    const admin = adminClient(config.url, config.serviceKey);
    const { data: profile, error: profileError } = await admin.from("profiles").select("role").eq("id", userData.user.id).maybeSingle<{ role: string | null }>();
    if (profileError || !profile?.role || !["father_admin", "system_admin"].includes(profile.role)) throw new Error("forbidden");

    let credential: CredentialRow | null = null;
    if (credentialId) {
      const result = await admin.from("access_credentials").select("id,warehouse_id,staff_member_id,truck_id,credential_type,is_active").eq("id", credentialId).maybeSingle<CredentialRow>();
      if (result.error) throw new Error("internal_server_error");
      credential = result.data;
      if (!credential || credential.credential_type !== credentialType) throw new Error("credential_not_owned");
    }

    const ownerId = typeof body.staff_member_id === "string" ? body.staff_member_id : typeof body.truck_id === "string" ? body.truck_id : null;
    if ((operation === "create" && !ownerId) || (ownerId && !UUID_PATTERN.test(ownerId))) throw new Error("invalid_request");

    let warehouseId = credential?.warehouse_id ?? null;
    if (!warehouseId && ownerId) {
      const table = STAFF_TYPES.has(credentialType) ? "staff_members" : "trucks";
      const result = await admin.from(table).select("warehouse_id").eq("id", ownerId).maybeSingle<{ warehouse_id: string }>();
      if (result.error || !result.data) throw new Error("credential_not_owned");
      warehouseId = result.data.warehouse_id;
    }
    if (!warehouseId || !(await authorizedWarehouse(admin, warehouseId, userData.user.id, profile.role))) throw new Error("forbidden");

    if (operation === "view") {
      if (!credentialId || !credential) throw new Error("invalid_request");
      const { data: valueRow, error } = await admin.from("access_credential_values").select("encrypted_value").eq("credential_id", credential.id).maybeSingle<{ encrypted_value: string }>();
      if (error) throw new Error("internal_server_error");
      if (!valueRow?.encrypted_value) throw new Error("credential_value_unavailable");
      const value = await decryptValue(valueRow.encrypted_value, config.encryptionKey);
      return jsonResponse({ status: "ok", credential_id: credential.id, credential_type: credential.credential_type, credential_value: value });
    }

    if (operation === "activate" || operation === "deactivate") {
      if (!credentialId || !credential) throw new Error("invalid_request");
      const { error } = await admin.from("access_credentials").update({ is_active: operation === "activate", updated_at: new Date().toISOString() }).eq("id", credential.id);
      if (error) throw new Error("internal_server_error");
      return jsonResponse({ status: "ok", credential_id: credential.id, credential_type: credential.credential_type, is_active: operation === "activate" });
    }

    if (!rawValue) throw new Error("credential_required");
    const canonical = normalizeCredential(typedCredentialType, rawValue);
    const hash = await hashValue(canonical);
    const encrypted = await encryptValue(canonical, config.encryptionKey);

    const material = await admin.rpc("store_credential_material", {
      p_credential_id: credentialId,
      p_warehouse_id: warehouseId,
      p_staff_member_id: STAFF_TYPES.has(typedCredentialType) ? ownerId : null,
      p_truck_id: TRUCK_TYPES.has(typedCredentialType) ? ownerId : null,
      p_credential_type: typedCredentialType,
      p_credential_hash: hash,
      p_encrypted_value: encrypted,
      p_is_active: true,
    });
    if (material.error || !material.data?.[0]) {
      if (material.error?.message.includes("credential_already_exists")) throw new Error("credential_already_exists");
      if (material.error?.message.includes("credential_not_owned")) throw new Error("credential_not_owned");
      throw new Error("internal_server_error");
    }
    return jsonResponse({ status: "ok", credential_id: material.data[0].id, credential_type: typedCredentialType, is_active: true });
  } catch (error) {
    return safeError(error);
  }
});
