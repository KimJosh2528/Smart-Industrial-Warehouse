import type { SupabaseClient } from "@supabase/supabase-js";

export type PlatformRole = "father_admin" | "system_admin" | "staff" | "guard" | "driver" | null;
export type AuthorizedWarehouse = { id: string; name: string };

export async function getAuthorizedWarehouses(client: SupabaseClient): Promise<{
  userId: string;
  role: PlatformRole;
  warehouses: AuthorizedWarehouse[];
  error: string | null;
}> {
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || !authData.user) return { userId: "", role: null, warehouses: [], error: "You must be signed in." };

  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("role")
    .eq("id", authData.user.id)
    .maybeSingle<{ role: string | null }>();
  let role: PlatformRole = profile?.role === "father_admin" || profile?.role === "system_admin" ? profile.role : null;
  let memberWarehouseIds: string[] = [];
  if (!role) {
    const { data: member } = await client.from("staff_members").select("warehouse_id,member_type").eq("profile_id", authData.user.id).maybeSingle<{ warehouse_id: string; member_type: "staff" | "guard" }>();
    if (member) { role = member.member_type; memberWarehouseIds = [member.warehouse_id]; }
    else {
      const { data: driver } = await client.from("drivers").select("warehouse_id").eq("profile_id", authData.user.id).maybeSingle<{ warehouse_id: string }>();
      if (driver) { role = "driver"; memberWarehouseIds = [driver.warehouse_id]; }
    }
  }
  if (profileError || !role) return { userId: authData.user.id, role, warehouses: [], error: "Your platform role could not be verified." };

  const query = client.from("warehouses").select("id,name").order("name");
  const result = role === "system_admin"
    ? await query.eq("system_admin_id", authData.user.id)
    : role === "father_admin"
      ? await query
      : await query.in("id", memberWarehouseIds);
  if (result.error) return { userId: authData.user.id, role, warehouses: [], error: result.error.message };

  // System Admin queries intentionally use the authenticated relationship,
  // never a warehouse ID supplied by a browser form or URL.
  return {
    userId: authData.user.id,
    role,
    warehouses: (result.data ?? []) as AuthorizedWarehouse[],
    error: role === "system_admin" && (result.data ?? []).length !== 1
      ? "A System Admin must have exactly one assigned warehouse."
      : null,
  };
}

export async function resolveAuthorizedWarehouseId(client: SupabaseClient, requestedWarehouseId: string | null): Promise<string | null> {
  const scope = await getAuthorizedWarehouses(client);
  if (scope.error) return null;
  if (scope.role === "system_admin") return scope.warehouses.find(() => true)?.id ?? null;
  if (scope.role === "father_admin" && requestedWarehouseId && scope.warehouses.some((warehouse) => warehouse.id === requestedWarehouseId)) {
    return requestedWarehouseId;
  }
  if (!requestedWarehouseId && scope.warehouses.length === 1) return scope.warehouses[0].id;
  return null;
}
