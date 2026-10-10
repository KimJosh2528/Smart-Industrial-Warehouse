import { createClient } from "./supabase/server";
import { getAuthorizedWarehouses } from "./warehouse-scope";
import type { PlatformRole } from "./warehouse-scope";

export type TruckWarehouse = { id: string; name: string };

export type TruckCredential = {
  id: string;
  truck_id: string;
  credential_type: "truck_rfid" | "truck_pin";
  uid_label?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type TruckRfidPoolItem = {
  id: string;
  warehouse_id: string;
  uid_label: string;
  credential_scope: "truck";
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
  availableRfids: TruckRfidPoolItem[];
};

export type TruckData = {
  configured: boolean;
  role: PlatformRole;
  warehouses: TruckWarehouse[];
  rows: TruckListItem[];
  availableRfids: TruckRfidPoolItem[];
  error: string | null;
};

export async function loadTruckData(): Promise<TruckData> {
  const empty = (error: string | null = null): TruckData => ({ configured: false, role: null, warehouses: [], rows: [], availableRfids: [], error });
  let client;
  try {
    client = await createClient();
  } catch {
    return empty("Supabase is not configured.");
  }

  const scope = await getAuthorizedWarehouses(client);
  const role = scope.role;
  if (scope.error) return { ...empty(scope.error), configured: true, role };
  const warehouseIds = scope.warehouses.map((warehouse) => warehouse.id);

  const [{ data: trucks, error: truckError }, { data: credentials, error: credentialError }, { data: rfidPool, error: rfidError }] = await Promise.all([
    client.from("trucks").select("id,warehouse_id,identity_label,plate_number,division,is_active,current_driver_id").in("warehouse_id", warehouseIds).eq("is_active", true).order("identity_label"),
    client.rpc("list_truck_credentials"),
    client.rpc("list_rfid_pool_uids"),
  ]);
  if (truckError) return { configured: true, role, warehouses: [], rows: [], availableRfids: [], error: "Truck data could not be loaded." };

  const visibleWarehouses = scope.warehouses;
  const warehouseNames = new Map(visibleWarehouses.map((warehouse) => [warehouse.id, warehouse.name]));
  const driverIds = [...new Set((trucks ?? []).map((truck) => truck.current_driver_id).filter((id): id is string => id !== null))];
  const { data: drivers, error: driverError } = driverIds.length
    ? await client.from("drivers").select("id,display_name").in("id", driverIds)
    : { data: [], error: null };
  if (driverError) return { configured: true, role, warehouses: visibleWarehouses, rows: [], availableRfids: [], error: "Truck data could not be loaded." };
  const driverNames = new Map((drivers ?? []).map((driver) => [driver.id, driver.display_name]));
  const credentialsByTruck = new Map<string, TruckCredential[]>();
  for (const credential of (credentialError ? [] : credentials ?? []) as TruckCredential[]) {
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
      availableRfids: ((rfidError ? [] : rfidPool ?? []) as Array<{ id: string; warehouse_id: string; uid_label: string; credential_scope: string; status: string }>)
        .filter((rfid) => rfid.warehouse_id === truck.warehouse_id && rfid.credential_scope === "truck" && rfid.status === "vacant") as TruckRfidPoolItem[],
    })),
    availableRfids: ((rfidError ? [] : rfidPool ?? []) as Array<{ id: string; warehouse_id: string; uid_label: string; credential_scope: string; status: string }>)
      .filter((rfid) => rfid.credential_scope === "truck" && rfid.status === "vacant") as TruckRfidPoolItem[],
    error: null,
  };
}
