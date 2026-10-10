import { createClient } from "./supabase/server";
import type { AccountClaim } from "./account-claims";
import { getAuthorizedWarehouses } from "./warehouse-scope";
import type { PlatformRole } from "./warehouse-scope";

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
  truck: { id: string; identity_label: string; plate_number: string; division: string | null; is_active: boolean; rfid_label: string | null } | null;
  available_trucks: AvailableTruck[];
  account_claim: AccountClaim | null;
  applicant_email: string | null;
  facebook_profile_url: string | null;
};

export type DriverData = {
  configured: boolean;
  role: PlatformRole;
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

  const scope = await getAuthorizedWarehouses(client);
  const role = scope.role;
  if (scope.error) return { ...empty(scope.error), configured: true, role };

  const [{ data: driverRows, error: driverError }, { data: truckCredentials }] = await Promise.all([
    client.rpc("list_owned_driver_records"),
    client.rpc("list_truck_credentials"),
  ]);
  if (driverError) return { configured: true, role, warehouses: [], rows: [], error: "Driver data could not be loaded." };
  const drivers = (driverRows ?? []) as Array<{
    id: string;
    warehouse_id: string;
    display_name: string;
    is_active: boolean;
    profile_id: string | null;
  }>;

  const visibleWarehouses = scope.warehouses;
  const warehouseNames = new Map(visibleWarehouses.map((warehouse) => [warehouse.id, warehouse.name]));
  const warehouseIds = visibleWarehouses.map((warehouse) => warehouse.id);
  const { data: trucks, error: truckError } = warehouseIds.length
    ? await client.from("trucks").select("id,warehouse_id,current_driver_id,identity_label,plate_number,division,is_active").in("warehouse_id", warehouseIds)
    : { data: [], error: null };
  if (truckError) return { configured: true, role, warehouses: visibleWarehouses, rows: [], error: "Driver data could not be loaded." };
  const truckByDriver = new Map((trucks ?? []).filter((truck) => truck.current_driver_id !== null).map((truck) => [truck.current_driver_id, truck]));
  const truckRfidByTruck = new Map(((truckCredentials ?? []) as Array<{ truck_id: string; credential_type: string; uid_label?: string | null }>)
    .filter((credential) => credential.credential_type === "truck_rfid")
    .map((credential) => [credential.truck_id, credential.uid_label ?? null]));
  const availableByWarehouse = new Map<string, AvailableTruck[]>();
  for (const truck of trucks ?? []) {
    if (!truck.is_active || truck.current_driver_id !== null) continue;
    const available = availableByWarehouse.get(truck.warehouse_id) ?? [];
    available.push({ id: truck.id, warehouse_id: truck.warehouse_id, identity_label: truck.identity_label, plate_number: truck.plate_number, division: truck.division });
    availableByWarehouse.set(truck.warehouse_id, available);
  }
  const [claimResults, contactResults] = await Promise.all([
    Promise.all((drivers ?? []).map((driver) => client.rpc("list_driver_account_claim", { p_driver_id: driver.id }))),
    Promise.all((drivers ?? []).map((driver) => client.rpc("list_driver_record_application_contact", { p_driver_id: driver.id }))),
  ]);
  // Account claims are optional. A missing/broken claim lookup must not hide
  // the driver and paired truck records that were already loaded successfully.
  const claimsByDriver = new Map((drivers ?? []).map((driver, index) => {
    const result = claimResults[index];
    return [driver.id, result?.error ? null : (((result?.data ?? [])[0] as AccountClaim | undefined) ?? null)] as const;
  }));

  return {
    configured: true,
    role,
    warehouses: visibleWarehouses,
    rows: (drivers ?? []).map((driver, index) => {
      const assignedTruck = truckByDriver.get(driver.id);
      return {
        id: driver.id,
        warehouse_id: driver.warehouse_id,
        warehouse_name: warehouseNames.get(driver.warehouse_id) ?? "Unknown warehouse",
        display_name: driver.display_name,
        driver_code: null,
        is_active: driver.is_active,
        profile_id: driver.profile_id,
        truck: assignedTruck ? {
          id: assignedTruck.id,
          identity_label: assignedTruck.identity_label,
          plate_number: assignedTruck.plate_number,
          division: assignedTruck.division,
          is_active: assignedTruck.is_active,
          rfid_label: truckRfidByTruck.get(assignedTruck.id) ?? null,
        } : null,
        available_trucks: availableByWarehouse.get(driver.warehouse_id) ?? [],
        account_claim: claimsByDriver.get(driver.id) ?? null,
        applicant_email: (contactResults[index]?.data?.[0] as { applicant_email?: string | null } | undefined)?.applicant_email ?? null,
        facebook_profile_url: (contactResults[index]?.data?.[0] as { facebook_profile_url?: string | null } | undefined)?.facebook_profile_url ?? null,
      };
    }),
    error: null,
  };
}
