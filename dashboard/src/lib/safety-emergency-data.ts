import { createClient } from "./supabase/server";
import { getAuthorizedWarehouses } from "./warehouse-scope";

export const safetySeverities = ["info", "warning", "critical"] as const;
export const safetyStatuses = ["open", "acknowledged", "resolved"] as const;
export const safetyEventTypes = [
  "TEMPERATURE_WARNING",
  "SMOKE_DETECTED",
  "FIRE_EMERGENCY",
  "EMERGENCY_RELEASE_ACTIVE",
  "EMERGENCY_CLEARED",
  "ENVIRONMENTAL_STATE_CHANGED",
] as const;

export type SafetyLogFilters = {
  page: number;
  pageSize: number;
  severity: string;
  status: string;
  eventType: string;
  deviceId: string;
  areaId: string;
  dateFrom: string;
  dateTo: string;
};

export type SafetyEventItem = {
  id: string;
  eventType: string;
  severity: string;
  status: string;
  occurredAt: string;
  areaName: string | null;
  deviceName: string | null;
  environmentalState: string | null;
  previousEnvironmentalState: string | null;
  temperature: number | null;
  humidity: number | null;
  smoke: number | null;
  metadata: Record<string, unknown>;
};

export type SafetyEmergencyData = {
  configured: boolean;
  error: string | null;
  rows: SafetyEventItem[];
  total: number;
  page: number;
  pageSize: number;
  areas: { id: string; name: string }[];
  devices: { id: string; name: string }[];
  emergency: { state: string; reason: string | null; changedAt: string | null } | null;
};

const empty = (filters: SafetyLogFilters, error: string | null = null): SafetyEmergencyData => ({
  configured: !error,
  error,
  rows: [],
  total: 0,
  page: filters.page,
  pageSize: filters.pageSize,
  areas: [],
  devices: [],
  emergency: null,
});

function dateStart(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : null;
}

function dateEnd(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.999Z` : null;
}

export async function loadSafetyEmergencyData(filters: SafetyLogFilters): Promise<SafetyEmergencyData> {
  let client;
  try {
    client = await createClient();
  } catch {
    return empty(filters, "Supabase is not configured.");
  }

  const scope = await getAuthorizedWarehouses(client);
  if (scope.error) return empty(filters, scope.error);
  const warehouseIds = scope.warehouses.map((warehouse) => warehouse.id);
  if (!warehouseIds.length) return empty(filters, "No warehouse is available.");

  const [{ data: areaRows }, { data: devices }, { data: emergency }] = await Promise.all([
    client.from("warehouse_areas").select("id,name,area_type_code").in("warehouse_id", warehouseIds).eq("area_type_code", "room"),
    client.from("devices").select("id,name").in("warehouse_id", warehouseIds).order("name"),
    client.from("warehouse_emergency_states").select("state,reason,changed_at").in("warehouse_id", warehouseIds).order("changed_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const areas = (areaRows ?? []).map((item) => ({ id: item.id, name: item.name ?? item.area_type_code }));
  const deviceOptions = (devices ?? []).map((item) => ({ id: item.id, name: item.name }));
  const roomIds = areas.map((area) => area.id);
  if (!roomIds.length) return { ...empty(filters), configured: true, areas, devices: deviceOptions, emergency: emergency ? { state: emergency.state, reason: emergency.reason, changedAt: emergency.changed_at } : null };

  let query = client
    .from("safety_events")
    .select("id,event_type,severity,status,occurred_at,area_id,device_id,previous_environmental_state,environmental_state,sensor_reading_id,metadata", { count: "exact" })
    .in("warehouse_id", warehouseIds)
    .in("area_id", roomIds)
    .order("occurred_at", { ascending: false });

  if (filters.severity && safetySeverities.includes(filters.severity as (typeof safetySeverities)[number])) query = query.eq("severity", filters.severity);
  if (filters.status && safetyStatuses.includes(filters.status as (typeof safetyStatuses)[number])) query = query.eq("status", filters.status);
  if (filters.eventType && safetyEventTypes.includes(filters.eventType as (typeof safetyEventTypes)[number])) query = query.eq("event_type", filters.eventType);
  if (filters.deviceId && deviceOptions.some((device) => device.id === filters.deviceId)) query = query.eq("device_id", filters.deviceId);
  if (filters.areaId && areas.some((area) => area.id === filters.areaId)) query = query.eq("area_id", filters.areaId);
  const from = dateStart(filters.dateFrom);
  const to = dateEnd(filters.dateTo);
  if (from) query = query.gte("occurred_at", from);
  if (to) query = query.lte("occurred_at", to);

  const fromIndex = (filters.page - 1) * filters.pageSize;
  const { data: events, count, error } = await query.range(fromIndex, fromIndex + filters.pageSize - 1);
  if (error) return { ...empty(filters, "Safety events could not be loaded."), areas, devices: deviceOptions, emergency: emergency ? { state: emergency.state, reason: emergency.reason, changedAt: emergency.changed_at } : null };

  const readingIds = [...new Set((events ?? []).map((event) => event.sensor_reading_id).filter(Boolean))];
  const { data: readings } = readingIds.length
    ? await client.from("sensor_readings").select("id,temperature_c,humidity_pct,smoke_value,environmental_state").in("id", readingIds)
    : { data: [] };
  const readingsById = new Map((readings ?? []).map((reading) => [reading.id, reading]));
  const areaNames = new Map(areas.map((area) => [area.id, area.name]));
  const deviceNames = new Map(deviceOptions.map((device) => [device.id, device.name]));

  return {
    configured: true,
    error: null,
    rows: (events ?? []).map((event) => {
      const reading = event.sensor_reading_id ? readingsById.get(event.sensor_reading_id) : undefined;
      return {
        id: event.id,
        eventType: event.event_type,
        severity: event.severity,
        status: event.status,
        occurredAt: event.occurred_at,
        areaName: event.area_id ? areaNames.get(event.area_id) ?? null : null,
        deviceName: event.device_id ? deviceNames.get(event.device_id) ?? null : null,
        environmentalState: event.environmental_state ?? reading?.environmental_state ?? null,
        previousEnvironmentalState: event.previous_environmental_state ?? null,
        temperature: reading?.temperature_c ?? null,
        humidity: reading?.humidity_pct ?? null,
        smoke: reading?.smoke_value ?? null,
        metadata: event.metadata ?? {},
      };
    }),
    total: count ?? 0,
    page: filters.page,
    pageSize: filters.pageSize,
    areas,
    devices: deviceOptions,
    emergency: emergency ? { state: emergency.state, reason: emergency.reason, changedAt: emergency.changed_at } : null,
  };
}
