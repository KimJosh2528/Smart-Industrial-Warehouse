import { createClient } from "./supabase/server";
import { getAuthorizedWarehouses } from "./warehouse-scope";

export type SensorLogFilters = { status: string; thresholds: string[]; areaId: string; dateFrom: string; dateTo: string };
export type SensorLogRow = { id: string; recordedAt: string; roomName: string; temperature: number | null; humidity: number | null; gas: number | null; status: string; fireState: "ON" | "OFF"; triggerReason: string };
export type SensorLogsData = { rows: SensorLogRow[]; rooms: { id: string; name: string }[]; error: string | null };

function statusOf(value: string | null) {
  const normalized = (value ?? "normal").toLowerCase();
  if (normalized.includes("fire")) return "fire";
  if (normalized.includes("danger") || normalized.includes("critical")) return "danger";
  if (normalized.includes("warning") || normalized.includes("high")) return "warning";
  return "normal";
}

function reasonOf(status: string, fireState: "ON" | "OFF", storedReason: string | null) {
  if (storedReason) return storedReason;
  if (fireState === "ON") return "Fire condition detected";
  if (status === "danger") return "Danger threshold reached";
  if (status === "warning") return "Warning threshold reached";
  return "—";
}

export async function loadSensorLogs(filters: SensorLogFilters): Promise<SensorLogsData> {
  const client = await createClient();
  const scope = await getAuthorizedWarehouses(client);
  if (scope.error) return { rows: [], rooms: [], error: scope.error };
  const warehouseIds = scope.warehouses.map((warehouse) => warehouse.id);
  if (!warehouseIds.length) return { rows: [], rooms: [], error: "No warehouse is available." };

  const { data: roomRows, error: roomError } = await client.from("warehouse_areas").select("id,name").in("warehouse_id", warehouseIds).eq("area_type_code", "room").order("name");
  if (roomError) return { rows: [], rooms: [], error: "Room data could not be loaded." };
  const rooms = (roomRows ?? []).map((room) => ({ id: room.id, name: room.name }));
  const roomIds = rooms.map((room) => room.id);
  if (!roomIds.length) return { rows: [], rooms, error: null };

  let query = client.from("sensor_readings").select("id,area_id,recorded_at,temperature_c,humidity_pct,smoke_value,environmental_state,fire_state,trigger_reason").in("area_id", roomIds).order("recorded_at", { ascending: false }).limit(500);
  if (filters.areaId && roomIds.includes(filters.areaId)) query = query.eq("area_id", filters.areaId);
  if (filters.dateFrom) query = query.gte("recorded_at", filters.dateFrom);
  if (filters.dateTo) query = query.lte("recorded_at", filters.dateTo);
  const { data: readingRows, error: readingError } = await query;
  if (readingError) return { rows: [], rooms, error: "Sensor logs could not be loaded." };

  const names = new Map(rooms.map((room) => [room.id, room.name]));
  const selectedThresholds = new Set(filters.thresholds);
  const rows = (readingRows ?? []).map((reading) => {
    const status = statusOf(reading.environmental_state);
    const fireState: "ON" | "OFF" = reading.fire_state === "ON" ? "ON" : "OFF";
    return { id: reading.id, recordedAt: reading.recorded_at, roomName: names.get(reading.area_id) ?? "Unknown room", temperature: reading.temperature_c, humidity: reading.humidity_pct, gas: reading.smoke_value, status, fireState, triggerReason: reasonOf(status, fireState, reading.trigger_reason) };
  }).filter((row) => !filters.status || row.status === filters.status || (filters.status === "fire" && row.fireState === "ON"))
    .filter((row) => !selectedThresholds.size || (selectedThresholds.has("temperature") && row.temperature !== null) || (selectedThresholds.has("humidity") && row.humidity !== null) || (selectedThresholds.has("gas") && row.gas !== null));
  return { rows, rooms, error: null };
}
