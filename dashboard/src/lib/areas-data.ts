import { createClient } from "./supabase/server";

export type WarehouseArea = { id: string; warehouse_id: string; area_type_code: string | null; name: string; state: string; temperature_warning_c: number | null; temperature_danger_c: number | null; humidity_warning_pct: number | null; humidity_danger_pct: number | null; smoke_warning_value: number | null; smoke_danger_value: number | null; created_at: string; updated_at: string };
export type AreaWarehouse = { id: string; name: string };
export type AreasData = { configured: boolean; warehouses: AreaWarehouse[]; areas: WarehouseArea[]; activeAreaByWarehouse: Record<string, string | null>; error: string | null };

const empty = (configured = false, error: string | null = null): AreasData => ({ configured, warehouses: [], areas: [], activeAreaByWarehouse: {}, error });

export async function loadAreasData(): Promise<AreasData> {
  let client;
  try { client = await createClient(); } catch { return empty(false, "Supabase is not configured."); }
  const { data: authData } = await client.auth.getUser();
  if (!authData.user) return empty(true, "You must be signed in to view warehouse areas.");

  const { data: profile } = await client.from("profiles").select("role").eq("id", authData.user.id).maybeSingle();
  const { data: warehouses, error: warehousesError } = profile?.role === "system_admin"
    ? await client.from("warehouses").select("id,name").eq("system_admin_id", authData.user.id).limit(1)
    : await client.from("warehouses").select("id,name").order("name");
  if (warehousesError) return empty(true, "Warehouse data could not be loaded.");
  const warehouseRows = (warehouses ?? []) as AreaWarehouse[];
  if (!warehouseRows.length) return { configured: true, warehouses: [], areas: [], activeAreaByWarehouse: {}, error: null };

  const ids = warehouseRows.map((warehouse) => warehouse.id);
  const [areasResult, demoResult] = await Promise.all([
    client.from("warehouse_areas").select("id,warehouse_id,area_type_code,name,state,temperature_warning_c,temperature_danger_c,humidity_warning_pct,humidity_danger_pct,smoke_warning_value,smoke_danger_value,created_at,updated_at").in("warehouse_id", ids).order("name"),
    client.from("demo_state").select("warehouse_id,active_area_id").in("warehouse_id", ids),
  ]);
  if (areasResult.error) return empty(true, "Warehouse areas could not be loaded.");
  if (demoResult.error) return empty(true, "Demo area state could not be loaded.");

  return {
    configured: true,
    warehouses: warehouseRows,
    areas: ((areasResult.data ?? []) as WarehouseArea[]).map((area) => ({ ...area, name: area.name?.trim() || "Unnamed Area" })),
    activeAreaByWarehouse: Object.fromEntries(warehouseRows.map((warehouse) => [warehouse.id, demoResult.data?.find((row) => row.warehouse_id === warehouse.id)?.active_area_id ?? null])),
    error: null,
  };
}
