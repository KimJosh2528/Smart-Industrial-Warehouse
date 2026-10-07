import { createClient } from "./supabase/server";

export type SensorBand = {
  normalMin: number | null;
  normalMax: number | null;
  warningMin: number | null;
  warningMax: number | null;
  dangerMin: number | null;
  dangerMax: number | null;
};

export type DeviceConfig = {
  areaId: string | null;
  iotRole: "doorlock" | "sensor" | null;
  doorlockMode: "staff" | "truck" | null;
  temperature: SensorBand;
  humidity: SensorBand;
  smoke: SensorBand;
  warningServerAlarm: boolean;
  dangerServerAlarm: boolean;
};

export type DeviceItem = {
  id: string;
  name: string;
  deviceType: string;
  isActive: boolean;
  environmentalState: string | null;
  config: DeviceConfig;
  areaName: string | null;
};

const emptyBand = (): SensorBand => ({ normalMin: null, normalMax: null, warningMin: null, warningMax: null, dangerMin: null, dangerMax: null });

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function loadDevices(): Promise<{ configured: boolean; error: string | null; areas: { id: string; name: string }[]; rows: DeviceItem[]; debug: { role: string | null; warehouseCount: number; areaCount: number; deviceCount: number } }> {
  let client;
  try { client = await createClient(); } catch { return { configured: false, error: "Supabase is not configured.", areas: [], rows: [] }; }
  const { data: authData } = await client.auth.getUser();
  if (!authData.user) return { configured: true, error: "You must be signed in to manage IoT devices.", areas: [], rows: [] };

  const { data: warehouses, error: warehouseError } = await client.from("warehouses").select("id,name").order("name");
  if (warehouseError || !warehouses?.length) return { configured: true, error: "No warehouse is available.", areas: [], rows: [] };
  const warehouseIds = warehouses.map((warehouse) => warehouse.id);

  const [areasResult, devicesResult] = await Promise.all([
    client.from("warehouse_areas").select("id,name").in("warehouse_id", warehouseIds).order("name"),
    client.from("devices").select("id,name,device_type,is_active,environmental_state,area_id,iot_role,doorlock_mode").in("warehouse_id", warehouseIds).order("name"),
  ]);
  if (areasResult.error || devicesResult.error) {
    const details = [
      areasResult.error ? `Areas: ${areasResult.error.message}` : null,
      devicesResult.error ? `Devices: ${devicesResult.error.message}` : null,
    ].filter(Boolean).join(" | ");
    return { configured: true, error: `IoT device data could not be loaded. ${details}`, areas: [], rows: [] };
  }

  const devices = devicesResult.data ?? [];
  const configsResult = devices.length
    ? await client.from("device_safety_config").select("*").in("device_id", devices.map((device) => device.id))
    : { data: [], error: null };
  if (configsResult.error) return { configured: true, error: "Sensor configuration could not be loaded.", areas: [], rows: [], debug: { role: profile?.role ?? null, warehouseCount: warehouses.length, areaCount: areasResult.data?.length ?? 0, deviceCount: devices.length } };

  const configByDevice = new Map((configsResult.data ?? []).map((config) => [config.device_id, config]));
  const rows = devices.map((device) => {
    const c = configByDevice.get(device.id) as Record<string, unknown> | undefined;
    return {
      id: device.id,
      name: device.name,
      deviceType: device.device_type,
      isActive: device.is_active,
      environmentalState: device.environmental_state,
      areaName: (areasResult.data ?? []).find((area) => area.id === device.area_id)?.name ?? null,
      config: {
        areaId: device.area_id ?? null,
        iotRole: device.iot_role ?? null,
        doorlockMode: device.doorlock_mode ?? null,
        temperature: {
          normalMin: num(c?.temperature_normal_min_c), normalMax: num(c?.temperature_normal_max_c),
          warningMin: num(c?.temperature_warning_min_c), warningMax: num(c?.temperature_warning_max_c),
          dangerMin: num(c?.temperature_danger_min_c), dangerMax: num(c?.temperature_danger_max_c),
        },
        humidity: {
          normalMin: num(c?.humidity_normal_min_pct), normalMax: num(c?.humidity_normal_max_pct),
          warningMin: num(c?.humidity_warning_min_pct), warningMax: num(c?.humidity_warning_max_pct),
          dangerMin: num(c?.humidity_danger_min_pct), dangerMax: num(c?.humidity_danger_max_pct),
        },
        smoke: {
          normalMin: num(c?.smoke_normal_min_value), normalMax: num(c?.smoke_normal_max_value),
          warningMin: num(c?.smoke_warning_min_value), warningMax: num(c?.smoke_warning_max_value),
          dangerMin: num(c?.smoke_danger_min_value), dangerMax: num(c?.smoke_danger_max_value),
        },
        warningServerAlarm: Boolean(c?.warning_server_alarm),
        dangerServerAlarm: Boolean(c?.danger_server_alarm),
      },
    };
  });

  return { configured: true, error: null, areas: (areasResult.data ?? []) as { id: string; name: string }[], rows };
}
