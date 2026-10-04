export class SupabaseAdminError extends Error {}

function adminHeaders(): HeadersInit {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!serviceKey) throw new SupabaseAdminError("server_configuration_error");
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
}

function restUrl(path: string, query: Record<string, string>): string {
  const base = Deno.env.get("SUPABASE_URL") ?? "";
  if (!base) throw new SupabaseAdminError("server_configuration_error");
  const params = new URLSearchParams(query);
  return `${base.replace(/\/$/, "")}/rest/v1/${path}?${params.toString()}`;
}

export async function selectRows<T>(table: string, query: Record<string, string>, select: string): Promise<T[]> {
  const response = await fetch(restUrl(table, { ...query, select }), { headers: adminHeaders() });
  if (!response.ok) throw new SupabaseAdminError("database_error");
  return await response.json() as T[];
}

export async function insertRow(table: string, row: Record<string, unknown>): Promise<void> {
  const response = await fetch(restUrl(table, {}), {
    method: "POST",
    headers: { ...adminHeaders(), "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  if (!response.ok) throw new SupabaseAdminError("database_error");
}

export async function callRpc<T>(functionName: string, args: Record<string, unknown>): Promise<T> {
  const base = Deno.env.get("SUPABASE_URL") ?? "";
  if (!base) throw new SupabaseAdminError("server_configuration_error");
  const response = await fetch(`${base.replace(/\/$/, "")}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: { ...adminHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!response.ok) throw new SupabaseAdminError("database_error");
  return await response.json() as T;
}
