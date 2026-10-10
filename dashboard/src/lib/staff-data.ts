import { createClient } from "./supabase/server";
import type { AccountClaim } from "./account-claims";
import { getAuthorizedWarehouses } from "./warehouse-scope";
import type { PlatformRole } from "./warehouse-scope";

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
  name: string;
  area_type_code: string;
  entrance_category: string | null;
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
  member_type: "staff" | "guard";
  camera_enabled: boolean;
  applicant_email: string | null;
  facebook_profile_url: string | null;
};

export type StaffData = {
  configured: boolean;
  role: PlatformRole;
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

export async function loadStaffData(memberType: "staff" | "guard" = "staff"): Promise<StaffData> {
  let client;
  try {
    client = await createClient();
  } catch {
    return empty(false, "Supabase is not configured.");
  }

  const scope = await getAuthorizedWarehouses(client);
  const role = scope.role;
  if (scope.error) return { ...empty(true, scope.error), role };

  // The authenticated server client and existing RLS determine which
  // warehouses are visible. No warehouse ID is accepted from the client.
  const visibleWarehouses = scope.warehouses;
  if (!visibleWarehouses.length) return { configured: true, role, warehouses: [], departments: {}, rows: [], error: null };

  const warehouseIds = visibleWarehouses.map((warehouse) => warehouse.id);
  const warehouseNames = new Map(visibleWarehouses.map((warehouse) => [warehouse.id, warehouse.name]));
  const { data: areaRows, error: areaError } = await client
    .from("warehouse_areas")
    .select("id,warehouse_id,name,area_type_code,entrance_category,state")
    .in("warehouse_id", warehouseIds)
    .order("area_type_code");
  if (areaError) return { ...empty(true, "Staff data could not be loaded."), role };

  const areasByWarehouse = new Map<string, StaffArea[]>();
  for (const area of areaRows ?? []) {
    const existing = areasByWarehouse.get(area.warehouse_id) ?? [];
    if (area.area_type_code !== "staff_entrance" || area.entrance_category !== "staff_main") continue;
    existing.push({ id: area.id, warehouse_id: area.warehouse_id, name: area.name ?? area.area_type_code, area_type_code: area.area_type_code, entrance_category: area.entrance_category, state: area.state });
    areasByWarehouse.set(area.warehouse_id, existing);
  }

  const departmentsByWarehouse = new Map<string, StaffDepartment[]>();
  const { data: staffRows, error: staffError } = await client
    .from("staff_members")
    .select("id,warehouse_id,display_name,employee_code,is_active,profile_id,member_type")
    .in("warehouse_id", warehouseIds)
    .eq("member_type", memberType)
    .order("display_name");
  if (staffError) return { ...empty(true, "Staff data could not be loaded."), role };

  const rows = await Promise.all((staffRows ?? []).map(async (staff) => {
    const [credentialsResult, permissionsResult, applicationResult, claimResult] = await Promise.all([
      client.rpc("list_staff_record_credentials", { p_staff_member_id: staff.id }),
      client.rpc("list_staff_record_permissions", { p_staff_member_id: staff.id }),
      client.rpc("list_staff_record_application_contact", { p_staff_member_id: staff.id }),
      client.rpc("list_staff_account_claim", { p_staff_member_id: staff.id }),
    ]);

    const permissions = ((permissionsResult.data ?? []) as Array<{ id: string; area_id: string; area_type_code: string; area_state: string }>).map((permission) => {
      const area = areasByWarehouse.get(staff.warehouse_id)?.find((candidate) => candidate.id === permission.area_id);
      return { id: permission.id, area_id: permission.area_id, area_type_code: area?.area_type_code ?? "unknown", area_state: area?.state ?? "unknown" };
    });

    return {
      id: staff.id,
      display_name: staff.display_name,
      employee_code: staff.employee_code,
      is_active: staff.is_active,
      profile_id: staff.profile_id,
      warehouse_id: staff.warehouse_id,
      department_id: null,
      warehouse_name: warehouseNames.get(staff.warehouse_id) ?? "Unknown warehouse",
      department_name: null,
      departments: departmentsByWarehouse.get(staff.warehouse_id) ?? [],
      credentials: (credentialsResult.data ?? []) as StaffCredential[],
      permissions: permissions as StaffPermission[],
      areas: areasByWarehouse.get(staff.warehouse_id) ?? [],
      account_claim: claimResult.error ? null : ((claimResult.data ?? [])[0] as AccountClaim | undefined) ?? null,
      member_type: memberType,
      camera_enabled: false,
      applicant_email: (applicationResult.data?.[0] as { applicant_email?: string | null } | undefined)?.applicant_email ?? null,
      facebook_profile_url: (applicationResult.data?.[0] as { facebook_profile_url?: string | null } | undefined)?.facebook_profile_url ?? null,
    };
  }));

  return {
    configured: true,
    role,
    warehouses: visibleWarehouses.map((warehouse) => ({ id: warehouse.id, name: warehouse.name })),
    departments: Object.fromEntries([...departmentsByWarehouse.entries()]),
    rows,
    error: null,
  };
}
