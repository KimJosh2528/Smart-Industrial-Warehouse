import { createClient } from "./supabase/server";

export const deviceTypes = ["controller", "camera", "sensor_module", "access_module", "other"] as const;
export const deviceActivityStates = ["active", "inactive"] as const;
export const deviceConnectivityStates = ["online", "offline", "never"] as const;
export const environmentalStates = ["NORMAL", "WARNING", "DANGER"] as const;

export type DeviceFilters = {
  search: string;
  deviceType: string;
  activity: string;
  connectivity: string;
  environmentalState: string;
};

export type DeviceItem = {
  id: string;
  warehouseId: string;
  name: string;
  deviceType: string;
  serialNumber: string | null;
  isActive: boolean;
  capabilities: Record<string, unknown>;
  deviceUid: string | null;
  lastSeenAt: string | null;
  environmentalState: string | null;
  createdAt: string;
  updatedAt: string;
  connectivity: "online" | "offline" | "never";
};

export type DevicesData = {
  configured: boolean;
  error: string | null;
  rows: DeviceItem[];
};

const empty = (error: string | null = null): DevicesData => ({
  configured: !error,
  error,
  rows: [],
});

function validFilter<T extends readonly string[]>(values: T, value: string): value is T[number] {
  return values.includes(value as T[number]);
}

function getConnectivity(lastSeenAt: string | null): DeviceItem["connectivity"] {
  if (!lastSeenAt) return "never";
  return Date.now() - new Date(lastSeenAt).getTime() <= 5 * 60 * 1000 ? "online" : "offline";
}

export async function loadDevices(filters: DeviceFilters): Promise<DevicesData> {
  let client;
  try {
    client = await createClient();
  } catch {
    return empty("Supabase is not configured.");
  }

  const { data: warehouses, error: warehouseError } = await client
    .from("warehouses")
    .select("id")
    .order("name")
    .limit(1);
  const warehouseId = warehouses?.[0]?.id;
  if (warehouseError || !warehouseId) return empty(warehouseError?.message ?? "No warehouse is available.");

  let query = client
    .from("devices")
    .select("id,warehouse_id,name,device_type,serial_number,is_active,capabilities,device_uid,last_seen_at,environmental_state,created_at,updated_at")
    .eq("warehouse_id", warehouseId)
    .order("name");

  const search = filters.search.replace(/[^a-zA-Z0-9._:-]/g, "").trim();
  if (search) query = query.or(`name.ilike.%${search}%,serial_number.ilike.%${search}%,device_uid.ilike.%${search}%`);
  if (validFilter(deviceTypes, filters.deviceType)) query = query.eq("device_type", filters.deviceType);
  if (filters.activity === "active") query = query.eq("is_active", true);
  if (filters.activity === "inactive") query = query.eq("is_active", false);
  if (validFilter(environmentalStates, filters.environmentalState)) query = query.eq("environmental_state", filters.environmentalState);

  const { data: devices, error } = await query;
  if (error) return empty("Devices could not be loaded.");

  const rows = (devices ?? []).map((device) => ({
    id: device.id,
    warehouseId: device.warehouse_id,
    name: device.name,
    deviceType: device.device_type,
    serialNumber: device.serial_number,
    isActive: device.is_active,
    capabilities: (device.capabilities ?? {}) as Record<string, unknown>,
    deviceUid: device.device_uid,
    lastSeenAt: device.last_seen_at,
    environmentalState: device.environmental_state,
    createdAt: device.created_at,
    updatedAt: device.updated_at,
    connectivity: getConnectivity(device.last_seen_at),
  }));

  return {
    configured: true,
    error: null,
    rows: filters.connectivity && validFilter(deviceConnectivityStates, filters.connectivity)
      ? rows.filter((device) => device.connectivity === filters.connectivity)
      : rows,
  };
}
