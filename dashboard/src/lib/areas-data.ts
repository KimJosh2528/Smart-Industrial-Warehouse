import { createClient } from "./supabase/server";

export type WarehouseAreaType = { code: string; name: string; sort_order: number };
export type WarehouseArea = { id: string; warehouse_id: string; area_type_code: string; name: string | null; state: string; temperature_warning_c: number | null; temperature_danger_c: number | null; humidity_warning_pct: number | null; humidity_danger_pct: number | null; smoke_warning_value: number | null; smoke_danger_value: number | null; created_at: string; updated_at: string };
export type AreaWarehouse = { id: string; name: string };
export type AreaDepartment = { id: string; warehouse_id: string; name: string; code: string; is_active: boolean };
export type DepartmentAreaDefault = { id: string; department_id: string; area_id: string; area_type_code: string; area_state: string; created_at: string };
export type AreasData = { configured: boolean; warehouses: AreaWarehouse[]; types: WarehouseAreaType[]; areas: WarehouseArea[]; activeAreaByWarehouse: Record<string, string | null>; departments: AreaDepartment[]; departmentDefaults: DepartmentAreaDefault[]; error: string | null };

const empty = (configured = false, error: string | null = null): AreasData => ({ configured, warehouses: [], types: [], areas: [], activeAreaByWarehouse: {}, departments: [], departmentDefaults: [], error });

export async function loadAreasData(): Promise<AreasData> {
  let client;
  try {
    client = await createClient();
  } catch {
    return empty(false, "Supabase is not configured.");
  }

  const { data: authData } = await client.auth.getUser();
  if (!authData.user) return empty(true, "You must be signed in to view warehouse areas.");

  const [warehousesResult, typesResult] = await Promise.all([
    client.from("warehouses").select("id,name").order("name"),
    client.from("warehouse_area_types").select("code,name,sort_order").order("sort_order"),
  ]);
  if (warehousesResult.error || typesResult.error) return empty(true, "Warehouse area data could not be loaded.");

  const warehouses = (warehousesResult.data ?? []) as AreaWarehouse[];
  if (!warehouses.length) return { configured: true, warehouses: [], types: (typesResult.data ?? []) as WarehouseAreaType[], areas: [], activeAreaByWarehouse: {}, departments: [], departmentDefaults: [], error: null };

  const { data: areas, error: areasError } = await client
    .from("warehouse_areas")
    .select("id,warehouse_id,area_type_code,name,state,temperature_warning_c,temperature_danger_c,humidity_warning_pct,humidity_danger_pct,smoke_warning_value,smoke_danger_value,created_at,updated_at")
    .in("warehouse_id", warehouses.map((warehouse) => warehouse.id))
    .order("area_type_code");
  if (areasError) return empty(true, "Warehouse area data could not be loaded.");

  const { data: demoState, error: demoStateError } = await client.from("demo_state").select("warehouse_id,active_area_id").in("warehouse_id", warehouses.map((warehouse) => warehouse.id));
  if (demoStateError) return empty(true, "Demo area state could not be loaded.");

  const { data: departments, error: departmentsError } = await client
    .from("departments")
    .select("id,warehouse_id,name,code,is_active")
    .in("warehouse_id", warehouses.map((warehouse) => warehouse.id))
    .order("name");
  if (departmentsError) return empty(true, "Department area data could not be loaded.");

  const departmentDefaultsResults = await Promise.all((departments ?? []).map((department) =>
    client.rpc("list_department_area_defaults", { p_department_id: department.id })
  ));
  if (departmentDefaultsResults.some((result) => result.error)) return empty(true, "Department area data could not be loaded.");

  return {
    configured: true,
    warehouses,
    types: (typesResult.data ?? []) as WarehouseAreaType[],
    areas: (areas ?? []) as WarehouseArea[],
    activeAreaByWarehouse: Object.fromEntries(warehouses.map((warehouse) => [warehouse.id, demoState?.find((row) => row.warehouse_id === warehouse.id)?.active_area_id ?? null])),
    departments: (departments ?? []) as AreaDepartment[],
    departmentDefaults: departmentDefaultsResults.flatMap((result) => (result.data ?? []) as DepartmentAreaDefault[]),
    error: null,
  };
}
