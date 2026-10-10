import { createClient } from "./supabase/server";
import { getAuthorizedWarehouses } from "./warehouse-scope";

export type WarehouseAreaType = { code: string; name: string; sort_order: number };
export type RoomEnvironmentConfig = { area_id: string; temperature_min_c: number | null; temperature_max_c: number | null; humidity_min_pct: number | null; humidity_max_pct: number | null; smoke_max_value: number | null; temperature_warning_low_c: number | null; temperature_danger_low_c: number | null; temperature_warning_high_c: number | null; temperature_danger_high_c: number | null; humidity_warning_low_pct: number | null; humidity_danger_low_pct: number | null; humidity_warning_high_pct: number | null; humidity_danger_high_pct: number | null; smoke_warning_value: number | null; smoke_danger_value: number | null; gas_exposure_seconds: number | null };
export type WarehouseArea = { id: string; warehouse_id: string; name: string; area_type_code: string; entrance_category: string | null; state: string; created_at: string; updated_at: string; environment_config: RoomEnvironmentConfig | null };
export type AreaWarehouse = { id: string; name: string };
export type AreaDepartment = { id: string; warehouse_id: string; name: string; code: string; is_active: boolean };
export type DepartmentAreaDefault = { id: string; department_id: string; area_id: string; area_type_code: string; area_state: string; created_at: string };
export type AreasData = { configured: boolean; warehouses: AreaWarehouse[]; types: WarehouseAreaType[]; areas: WarehouseArea[]; departments: AreaDepartment[]; departmentDefaults: DepartmentAreaDefault[]; error: string | null };

const empty = (configured = false, error: string | null = null): AreasData => ({ configured, warehouses: [], types: [], areas: [], departments: [], departmentDefaults: [], error });

export async function loadAreasData(): Promise<AreasData> {
  let client;
  try {
    client = await createClient();
  } catch {
    return empty(false, "Supabase is not configured.");
  }

  const scope = await getAuthorizedWarehouses(client);
  if (scope.error) return empty(true, scope.error);

  const typesResult = await client.from("warehouse_area_types").select("code,name,sort_order").order("sort_order");
  if (typesResult.error) return empty(true, "Warehouse area data could not be loaded.");

  const warehouses = scope.warehouses as AreaWarehouse[];
  if (!warehouses.length) return { configured: true, warehouses: [], types: (typesResult.data ?? []) as WarehouseAreaType[], areas: [], departments: [], departmentDefaults: [], error: null };

  const { data: areas, error: areasError } = await client
    .from("warehouse_areas")
    .select("id,warehouse_id,name,area_type_code,entrance_category,state,created_at,updated_at")
    .in("warehouse_id", warehouses.map((warehouse) => warehouse.id))
    .order("area_type_code");
  if (areasError) return empty(true, "Warehouse area data could not be loaded.");

  const roomIds = (areas ?? []).filter((area) => area.area_type_code === "room").map((area) => area.id);
  const { data: configs } = roomIds.length
    ? await client.from("room_environment_configs").select("area_id,temperature_min_c,temperature_max_c,humidity_min_pct,humidity_max_pct,smoke_max_value,temperature_warning_low_c,temperature_danger_low_c,temperature_warning_high_c,temperature_danger_high_c,humidity_warning_low_pct,humidity_danger_low_pct,humidity_warning_high_pct,humidity_danger_high_pct,smoke_warning_value,smoke_danger_value,gas_exposure_seconds").in("area_id", roomIds)
    : { data: [] };
  const configByArea = new Map((configs ?? []).map((config) => [config.area_id, config as RoomEnvironmentConfig]));

  return {
    configured: true,
    warehouses,
    types: (typesResult.data ?? []) as WarehouseAreaType[],
    areas: (areas ?? []).map((area) => ({ ...area, environment_config: configByArea.get(area.id) ?? null })) as WarehouseArea[],
    departments: [],
    departmentDefaults: [],
    error: null,
  };
}
