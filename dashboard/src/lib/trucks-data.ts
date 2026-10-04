import { createClient } from "./supabase/server";

export type TruckWarehouse = { id: string; name: string };

export type TruckCredential = {
  id: string;
  truck_id: string;
  credential_type: "truck_rfid" | "truck_pin";
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type TruckListItem = {
  id: string;
  warehouse_id: string;
  warehouse_name: string;
  identity_label: string;
  plate_number: string;
  division: string | null;
  is_active: boolean;
  current_driver_id: string | null;
  assigned_driver_name: string | null;
  credentials: TruckCredential[];
};

export type TruckData = {
  configured: boolean;
  role: "father_admin" | "system_admin" | null;
  warehouses: TruckWarehouse[];
  rows: TruckListItem[];
  error: string | null;
};

export async function loadTruckData(): Promise<TruckData> {
  const empty = (error: string | null = null): TruckData => ({ configured: false, role: null, warehouses: [], rows: [], error });
  let client;
  try {
    client = await createClient();
  } catch {
    return empty("Supabase is not configured.");
  }

  const { data: authData } = await client.auth.getUser();
  if (!authData.user) return { ...empty("You must be signed in to view trucks."), configured: true };
  const { data: profile } = await client.from("profiles").select("role").eq("id", authData.user.id).maybeSingle();
  const role = profile?.role === "father_admin" || profile?.role === "system_admin" ? profile.role : null;

  const [{ data: warehouses, error: warehouseError }, { data: trucks, error: truckError }, { data: credentials, error: credentialError }] = await Promise.all([
    client.from("warehouses").select("id,name").order("name"),
    client.from("trucks").select("id,warehouse_id,identity_label,plate_number,division,is_active,current_driver_id").order("identity_label"),
    client.rpc("list_truck_credentials"),
  ]);
  if (warehouseError || truckError || credentialError) return { configured: true, role, warehouses: [], rows: [], error: "Truck data could not be loaded." };

  const visibleWarehouses = (warehouses ?? []).map((warehouse) => ({ id: warehouse.id, name: warehouse.name }));
  const warehouseNames = new Map(visibleWarehouses.map((warehouse) => [warehouse.id, warehouse.name]));
  const driverIds = [...new Set((trucks ?? []).map((truck) => truck.current_driver_id).filter((id): id is string => id !== null))];
  const { data: drivers, error: driverError } = driverIds.length
    ? await client.from("drivers").select("id,display_name").in("id", driverIds)
    : { data: [], error: null };
  if (driverError) return { configured: true, role, warehouses: visibleWarehouses, rows: [], error: "Truck data could not be loaded." };
  const driverNames = new Map((drivers ?? []).map((driver) => [driver.id, driver.display_name]));
  const credentialsByTruck = new Map<string, TruckCredential[]>();
  for (const credential of (credentials ?? []) as TruckCredential[]) {
    const existing = credentialsByTruck.get(credential.truck_id) ?? [];
    existing.push(credential);
    credentialsByTruck.set(credential.truck_id, existing);
  }

  return {
    configured: true,
    role,
    warehouses: visibleWarehouses,
    rows: (trucks ?? []).map((truck) => ({
      id: truck.id,
      warehouse_id: truck.warehouse_id,
      warehouse_name: warehouseNames.get(truck.warehouse_id) ?? "Unknown warehouse",
      identity_label: truck.identity_label,
      plate_number: truck.plate_number,
      division: truck.division,
      is_active: truck.is_active,
      current_driver_id: truck.current_driver_id,
      assigned_driver_name: truck.current_driver_id ? driverNames.get(truck.current_driver_id) ?? "Assigned driver" : null,
      credentials: credentialsByTruck.get(truck.id) ?? [],
    })),
    error: null,
  };
}
