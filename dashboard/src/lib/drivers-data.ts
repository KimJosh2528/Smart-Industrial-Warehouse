import { createClient } from "./supabase/server";
import type { AccountClaim } from "./account-claims";

export type DriverWarehouse = { id: string; name: string };

export type AvailableTruck = {
  id: string;
  warehouse_id: string;
  identity_label: string;
  plate_number: string;
  division: string | null;
};

export type DriverListItem = {
  id: string;
  warehouse_id: string;
  warehouse_name: string;
  display_name: string;
  driver_code: string | null;
  is_active: boolean;
  profile_id: string | null;
  truck: { id: string; identity_label: string; plate_number: string; division: string | null; is_active: boolean } | null;
  available_trucks: AvailableTruck[];
  account_claim: AccountClaim | null;
};

export type DriverData = {
  configured: boolean;
  role: "father_admin" | "system_admin" | null;
  warehouses: DriverWarehouse[];
  rows: DriverListItem[];
  error: string | null;
};

export async function loadDriverData(): Promise<DriverData> {
  const empty = (error: string | null = null): DriverData => ({ configured: false, role: null, warehouses: [], rows: [], error });
  let client;
  try {
    client = await createClient();
  } catch {
    return empty("Supabase is not configured.");
  }

  const { data: authData } = await client.auth.getUser();
  if (!authData.user) return { ...empty("You must be signed in to view drivers."), configured: true };
  const { data: profile } = await client.from("profiles").select("role").eq("id", authData.user.id).maybeSingle();
  const role = profile?.role === "father_admin" || profile?.role === "system_admin" ? profile.role : null;

  const [{ data: warehouses, error: warehouseError }, { data: drivers, error: driverError }] = await Promise.all([
    client.from("warehouses").select("id,name").order("name"),
    client.from("drivers").select("id,warehouse_id,display_name,driver_code,is_active,profile_id").order("display_name"),
  ]);
  if (warehouseError || driverError) return { configured: true, role, warehouses: [], rows: [], error: "Driver data could not be loaded." };

  const visibleWarehouses = (warehouses ?? []).map((warehouse) => ({ id: warehouse.id, name: warehouse.name }));
  const warehouseNames = new Map(visibleWarehouses.map((warehouse) => [warehouse.id, warehouse.name]));
  const warehouseIds = visibleWarehouses.map((warehouse) => warehouse.id);
  const { data: trucks, error: truckError } = warehouseIds.length
    ? await client.from("trucks").select("id,warehouse_id,current_driver_id,identity_label,plate_number,division,is_active").in("warehouse_id", warehouseIds)
    : { data: [], error: null };
  if (truckError) return { configured: true, role, warehouses: visibleWarehouses, rows: [], error: "Driver data could not be loaded." };
  const truckByDriver = new Map((trucks ?? []).filter((truck) => truck.current_driver_id !== null).map((truck) => [truck.current_driver_id, truck]));
  const availableByWarehouse = new Map<string, AvailableTruck[]>();
  for (const truck of trucks ?? []) {
    if (!truck.is_active || truck.current_driver_id !== null) continue;
    const available = availableByWarehouse.get(truck.warehouse_id) ?? [];
    available.push({ id: truck.id, warehouse_id: truck.warehouse_id, identity_label: truck.identity_label, plate_number: truck.plate_number, division: truck.division });
    availableByWarehouse.set(truck.warehouse_id, available);
  }
  const claimResults = await Promise.all((drivers ?? []).map((driver) => client.rpc("list_driver_account_claim", { p_driver_id: driver.id })));
  if (claimResults.some((result) => result.error)) return { configured: true, role, warehouses: visibleWarehouses, rows: [], error: "Driver data could not be loaded." };
  const claimsByDriver = new Map((drivers ?? []).map((driver, index) => [driver.id, ((claimResults[index].data ?? [])[0] as AccountClaim | undefined) ?? null]));

  return {
    configured: true,
    role,
    warehouses: visibleWarehouses,
    rows: (drivers ?? []).map((driver) => {
      const assignedTruck = truckByDriver.get(driver.id);
      return {
        id: driver.id,
        warehouse_id: driver.warehouse_id,
        warehouse_name: warehouseNames.get(driver.warehouse_id) ?? "Unknown warehouse",
        display_name: driver.display_name,
        driver_code: driver.driver_code,
        is_active: driver.is_active,
        profile_id: driver.profile_id,
        truck: assignedTruck ? {
          id: assignedTruck.id,
          identity_label: assignedTruck.identity_label,
          plate_number: assignedTruck.plate_number,
          division: assignedTruck.division,
          is_active: assignedTruck.is_active,
        } : null,
        available_trucks: availableByWarehouse.get(driver.warehouse_id) ?? [],
        account_claim: claimsByDriver.get(driver.id) ?? null,
      };
    }),
    error: null,
  };
}
