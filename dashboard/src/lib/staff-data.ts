import { createClient } from "./supabase/server";
import type { AccountClaim } from "./account-claims";

export type StaffCredential = {
  id: string;
  credential_type: string;
  is_active: boolean;
};

export type StaffPermission = {
  id: string;
  area_id: string;
  area_type_code: string;
  area_state: string;
};

export type StaffArea = {
  id: string;
  warehouse_id: string;
  area_type_code: string;
  state: string;
};

export type StaffDepartment = {
  id: string;
  name: string;
  code: string;
};

export type StaffWarehouse = {
  id: string;
  name: string;
};

export type StaffListItem = {
  id: string;
  display_name: string;
  employee_code: string | null;
  is_active: boolean;
  profile_id: string | null;
  warehouse_id: string;
  department_id: string | null;
  warehouse_name: string;
  department_name: string | null;
  departments: StaffDepartment[];
  credentials: StaffCredential[];
  permissions: StaffPermission[];
  areas: StaffArea[];
  account_claim: AccountClaim | null;
};

export type StaffData = {
  configured: boolean;
  role: "father_admin" | "system_admin" | null;
  warehouses: StaffWarehouse[];
  departments: Record<string, StaffDepartment[]>;
  rows: StaffListItem[];
  error: string | null;
};

const empty = (configured = false, error: string | null = null): StaffData => ({
  configured,
  role: null,
  warehouses: [],
  departments: {},
  rows: [],
  error,
});

export async function loadStaffData(): Promise<StaffData> {
  let client;
  try {
    client = await createClient();
  } catch {
    return empty(false, "Supabase is not configured.");
  }

  const { data: authData } = await client.auth.getUser();
  if (!authData.user) return empty(true, "You must be signed in to view staff.");

  const { data: profile } = await client
    .from("profiles")
    .select("role")
    .eq("id", authData.user.id)
    .maybeSingle();
  const role = profile?.role === "father_admin" || profile?.role === "system_admin"
    ? profile.role
    : null;

  // The authenticated server client and existing RLS determine which
  // warehouses are visible. No warehouse ID is accepted from the client.
  const { data: warehouses, error: warehouseError } = await client
    .from("warehouses")
    .select("id,name")
    .order("name");
  if (warehouseError) return { ...empty(true, "Staff data could not be loaded."), role };

  const visibleWarehouses = warehouses ?? [];
  if (!visibleWarehouses.length) return { configured: true, role, warehouses: [], departments: {}, rows: [], error: null };

  const warehouseIds = visibleWarehouses.map((warehouse) => warehouse.id);
  const warehouseNames = new Map(visibleWarehouses.map((warehouse) => [warehouse.id, warehouse.name]));
  const { data: departments, error: departmentError } = await client
    .from("departments")
    .select("id,warehouse_id,name,code,is_active")
    .in("warehouse_id", warehouseIds)
    .order("name");
  if (departmentError) return { ...empty(true, "Staff data could not be loaded."), role };

  const { data: areaRows, error: areaError } = await client
    .from("warehouse_areas")
    .select("id,warehouse_id,area_type_code,state")
    .in("warehouse_id", warehouseIds)
    .order("area_type_code");
  if (areaError) return { ...empty(true, "Staff data could not be loaded."), role };

  const areasByWarehouse = new Map<string, StaffArea[]>();
  for (const area of areaRows ?? []) {
    const existing = areasByWarehouse.get(area.warehouse_id) ?? [];
    existing.push({ id: area.id, warehouse_id: area.warehouse_id, area_type_code: area.area_type_code, state: area.state });
    areasByWarehouse.set(area.warehouse_id, existing);
  }

  const departmentNames = new Map((departments ?? []).map((department) => [department.id, department.name]));
  const departmentsByWarehouse = new Map<string, StaffDepartment[]>();
  for (const department of departments ?? []) {
    if (!department.is_active) continue;
    const existing = departmentsByWarehouse.get(department.warehouse_id) ?? [];
    existing.push({ id: department.id, name: department.name, code: department.code });
    departmentsByWarehouse.set(department.warehouse_id, existing);
  }
  const { data: staffRows, error: staffError } = await client
    .from("staff_members")
    .select("id,warehouse_id,department_id,display_name,employee_code,is_active,profile_id")
    .in("warehouse_id", warehouseIds)
    .order("display_name");
  if (staffError) return { ...empty(true, "Staff data could not be loaded."), role };

  let metadataError = false;
  const rows = await Promise.all((staffRows ?? []).map(async (staff) => {
    const [credentialsResult, permissionsResult, claimResult] = await Promise.all([
      client.rpc("list_staff_credentials", { p_staff_member_id: staff.id }),
      client.rpc("list_staff_area_permissions", { p_staff_member_id: staff.id }),
      client.rpc("list_staff_account_claim", { p_staff_member_id: staff.id }),
    ]);

    if (credentialsResult.error || permissionsResult.error || claimResult.error) metadataError = true;

    return {
      id: staff.id,
      display_name: staff.display_name,
      employee_code: staff.employee_code,
      is_active: staff.is_active,
      profile_id: staff.profile_id,
      warehouse_id: staff.warehouse_id,
      department_id: staff.department_id,
      warehouse_name: warehouseNames.get(staff.warehouse_id) ?? "Unknown warehouse",
      department_name: staff.department_id ? departmentNames.get(staff.department_id) ?? null : null,
      departments: departmentsByWarehouse.get(staff.warehouse_id) ?? [],
      credentials: (credentialsResult.data ?? []) as StaffCredential[],
      permissions: (permissionsResult.data ?? []) as StaffPermission[],
      areas: areasByWarehouse.get(staff.warehouse_id) ?? [],
      account_claim: ((claimResult.data ?? [])[0] as AccountClaim | undefined) ?? null,
    };
  }));

  return {
    configured: true,
    role,
    warehouses: visibleWarehouses.map((warehouse) => ({ id: warehouse.id, name: warehouse.name })),
    departments: Object.fromEntries([...departmentsByWarehouse.entries()]),
    rows,
    error: metadataError ? "Some staff details could not be loaded." : null,
  };
}
