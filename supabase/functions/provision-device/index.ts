import sodium from "npm:libsodium-wrappers@0.7.15";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function adminHeaders(): HeadersInit {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
}

function apiUrl(path: string, params: Record<string, string>) {
  const base = Deno.env.get("SUPABASE_URL") ?? "";
  const query = new URLSearchParams(params);
  return `${base.replace(/\/$/, "")}/rest/v1/${path}?${query.toString()}`;
}

async function fetchRows<T>(path: string, params: Record<string, string>, select: string): Promise<T[]> {
  const response = await fetch(apiUrl(path, { ...params, select }), { headers: adminHeaders() });
  if (!response.ok) throw new Error("database_error");
  return await response.json() as T[];
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return response({ status: "error", message: "method_not_allowed" }, 405);

  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return response({ status: "error", message: "unauthorized" }, 401);

  try {
    const authResponse = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, {
      headers: { apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "", Authorization: authorization },
    });
    if (!authResponse.ok) return response({ status: "error", message: "unauthorized" }, 401);
    const user = await authResponse.json() as { id?: string };
    if (!user.id || !UUID_PATTERN.test(user.id)) return response({ status: "error", message: "unauthorized" }, 401);

    const body = await req.json() as { device_id?: unknown; rotate?: unknown };
    const deviceId = typeof body.device_id === "string" ? body.device_id.trim() : "";
    if (!UUID_PATTERN.test(deviceId)) return response({ status: "error", message: "invalid_device" }, 400);

    const profiles = await fetchRows<{ role: string | null }>("profiles", { id: `eq.${user.id}` }, "role");
    const role = profiles[0]?.role ?? null;
    const devices = await fetchRows<{ id: string; warehouse_id: string; name: string; device_uid: string | null }>("devices", { id: `eq.${deviceId}` }, "id,warehouse_id,name,device_uid");
    const device = devices[0];
    if (!device) return response({ status: "error", message: "device_not_found" }, 404);
    // Backward compatibility: older dashboard builds sent only device_id.
    // An authorized request for an already provisioned device rotates its
    // credentials instead of returning a duplicate error.

    const warehouses = role === "father_admin"
      ? await fetchRows<{ id: string }>("warehouses", { id: `eq.${device.warehouse_id}` }, "id")
      : await fetchRows<{ id: string }>("warehouses", { id: `eq.${device.warehouse_id}`, or: `(owner_id.eq.${user.id},system_admin_id.eq.${user.id})` }, "id");
    if (warehouses.length !== 1) return response({ status: "error", message: "not_authorized" }, 403);

    const keyHex = Deno.env.get("DEVICE_SECRET_KEY_HEX") ?? "";
    if (!/^[0-9a-f]{64}$/i.test(keyHex)) return response({ status: "error", message: "provisioning_not_configured" }, 503);

    await sodium.ready;
    const uid = `wg_${crypto.randomUUID().replaceAll("-", "")}`;
    const secretBytes = sodium.randombytes_buf(32);
    const secret = sodium.to_hex(secretBytes);
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const encrypted = sodium.crypto_secretbox_easy(
      sodium.from_string(secret), nonce, sodium.from_hex(keyHex),
    );
    const packed = new Uint8Array(nonce.length + encrypted.length);
    packed.set(nonce);
    packed.set(encrypted, nonce.length);

    const update = await fetch(apiUrl("devices", { id: `eq.${deviceId}` }), {
      method: "PATCH",
      headers: { ...adminHeaders(), Prefer: "return=minimal" },
      body: JSON.stringify({ device_uid: uid, device_secret_encrypted: sodium.to_base64(packed, sodium.base64_variants.ORIGINAL), is_active: true, updated_at: new Date().toISOString() }),
    });
    if (!update.ok) return response({ status: "error", message: "provisioning_failed" }, 500);

    return response({ status: "provisioned", device_id: device.id, device_name: device.name, device_uid: uid, device_secret: secret, warning: "Store this secret securely. It will not be shown again." }, 201);
  } catch {
    return response({ status: "error", message: "internal_server_error" }, 500);
  }
});
