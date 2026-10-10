import { createClient } from "./supabase/server";
import { getAuthorizedWarehouses } from "./warehouse-scope";
import type { PlatformRole } from "./warehouse-scope";

export type AccessRow = {
  id: string;
  occurred_at: string;
  result: string;
  authentication_method: string;
  area_id: string | null;
  staff_member_id: string | null;
  truck_id: string | null;
  metadata: Record<string, unknown> | null;
};

export type DashboardData = {
  configured: boolean;
  displayName: string;
  role: PlatformRole;
  warehouses: { id: string; name: string }[];
  selectedWarehouseId: string | null;
  staff: { total: number; active: number; inactive: number };
  trucks: { total: number; active: number; inactive: number };
  accessToday: { total: number; authorized: number; denied: number };
  staffAccessToday: number;
  plateAccessToday: number;
  safetyToday: { total: number; warnings: number; dangers: number };
  unresolvedSafetyCount: number;
  activity: { label: string; authorized: number; denied: number }[];
  environment: { temperature: number | null; humidity: number | null; smoke: number | null; temperatureState: SensorState; humidityState: SensorState; smokeState: SensorState; environmentalState: SensorState; fireState: "ON" | "OFF" | null; triggerReason: string | null; recordedAt: string | null; gasExposureSeconds: number | null; smokeExposureSeconds: number | null };
  warehouseStatus: "normal" | "warning" | "danger";
  emergency: { active: boolean; reason: string | null };
  devices: { id: string; name: string; online: boolean }[];
  recentAccess: AccessRow[];
  areas: Record<string, string>;
  staffNames: Record<string, string>;
  truckNames: Record<string, string>;
};

const blank = (configured = false): DashboardData => ({
  configured, displayName: "there", role: null, warehouses: [], selectedWarehouseId: null,
  staff: { total: 0, active: 0, inactive: 0 }, trucks: { total: 0, active: 0, inactive: 0 }, plateAccessToday: 0,
  accessToday: { total: 0, authorized: 0, denied: 0 }, staffAccessToday: 0, safetyToday: { total: 0, warnings: 0, dangers: 0 }, unresolvedSafetyCount: 0,
  activity: [], environment: { temperature: null, humidity: null, smoke: null, temperatureState: null, humidityState: null, smokeState: null, environmentalState: null, fireState: null, triggerReason: null, recordedAt: null, gasExposureSeconds: null, smokeExposureSeconds: null },
  warehouseStatus: "normal", emergency: { active: false, reason: null }, devices: [], recentAccess: [],
  areas: {}, staffNames: {}, truckNames: {},
});

const midnight = (daysAgo = 0) => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  return date;
};

const numberOrNull = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

// Keep overview labels aligned with firmware-arduino-ide/esp-main/wareguard.
const FIRMWARE_TEMP_FIRE_C = 35;
const FIRMWARE_HUMIDITY_WARNING_PCT = 80;
const FIRMWARE_SMOKE_WARNING = 450;
const FIRMWARE_SMOKE_DANGER = 650;

type SensorState = "NORMAL" | "WARNING" | "DANGER" | null;

function thresholdState(value: number | null, warningLow: unknown, dangerLow: unknown, warningHigh: unknown, dangerHigh: unknown): SensorState {
  if (value == null) return null;
  const warnLow = numberOrNull(warningLow);
  const dangerLowValue = numberOrNull(dangerLow);
  const warnHigh = numberOrNull(warningHigh);
  const dangerHighValue = numberOrNull(dangerHigh);
  if ((dangerLowValue != null && value <= dangerLowValue) || (dangerHighValue != null && value >= dangerHighValue)) return "DANGER";
  if ((warnLow != null && value <= warnLow) || (warnHigh != null && value >= warnHigh)) return "WARNING";
  return "NORMAL";
}

export async function loadDashboardData(): Promise<DashboardData> {
  let client;
  try {
    client = await createClient();
  } catch {
    return blank();
  }

  const { data: authData } = await client.auth.getUser();
  let displayName = authData.user?.user_metadata?.display_name ??
    authData.user?.user_metadata?.name ?? "there";
  const scope = await getAuthorizedWarehouses(client);
  const role = scope.role;
  if (scope.error) return { ...blank(true), displayName, role };
  if (authData.user) {
    const { data: profile } = await client.from("profiles").select("display_name")
      .eq("id", authData.user.id).maybeSingle();
    displayName = profile?.display_name ?? displayName;
  }
  const warehouses = scope.warehouses;
  if (!warehouses.length) return { ...blank(true), displayName, role };
  let assignedTruckId: string | null = null;
  if (role === "driver") {
    const { data: driver } = await client.from("drivers").select("id").eq("profile_id", scope.userId).maybeSingle<{ id: string }>();
    if (driver) {
      const { data: truck } = await client.from("trucks").select("id").eq("current_driver_id", driver.id).maybeSingle<{ id: string }>();
      assignedTruckId = truck?.id ?? null;
    }
  }
  const warehouseIds = warehouses.map((warehouse) => warehouse.id);
  const today = midnight().toISOString();
  const sevenDaysAgo = midnight(6).toISOString();

  const [staffResult, truckResult, areaResult, deviceResult, todayAccessResult, recentResult,
    safetyResult, readingResult, emergencyResult, activityResult, openSafetyResult] = await Promise.all([
    client.from("staff_members").select("id,display_name,is_active").in("warehouse_id", warehouseIds),
    client.from("trucks").select("id,identity_label,is_active,current_driver_id").in("warehouse_id", warehouseIds),
    client.from("warehouse_areas").select("id,area_type_code").in("warehouse_id", warehouseIds),
    client.from("devices").select("id,name,last_seen_at").in("warehouse_id", warehouseIds).order("name"),
    client.from("access_logs").select("id,occurred_at,result,authentication_method,area_id,staff_member_id,truck_id,metadata").in("warehouse_id", warehouseIds).gte("occurred_at", today),
    client.from("access_logs").select("id,occurred_at,result,authentication_method,area_id,staff_member_id,truck_id,metadata").in("warehouse_id", warehouseIds).order("occurred_at", { ascending: false }).limit(10),
    client.from("safety_events").select("severity,status").in("warehouse_id", warehouseIds).gte("occurred_at", today),
    client.from("sensor_readings").select("area_id,temperature_c,humidity_pct,smoke_value,environmental_state,fire_state,trigger_reason,recorded_at").in("warehouse_id", warehouseIds).order("recorded_at", { ascending: false }).limit(1).maybeSingle(),
    client.from("warehouse_emergency_states").select("state,reason").in("warehouse_id", warehouseIds).order("changed_at", { ascending: false }).limit(1).maybeSingle(),
    client.from("access_logs").select("occurred_at,result").in("warehouse_id", warehouseIds).gte("occurred_at", sevenDaysAgo),
    client.from("safety_events").select("severity,status").in("warehouse_id", warehouseIds).neq("status", "resolved"),
  ]);

  const staff = staffResult.data ?? [];
  const trucks = truckResult.data ?? [];
  const todayAccess = todayAccessResult.data ?? [];
  const safety = safetyResult.data ?? [];
  const areas = Object.fromEntries((areaResult.data ?? []).map((item) => [item.id, item.area_type_code]));
  const staffNames = Object.fromEntries(staff.map((item) => [item.id, item.display_name]));
  const truckNames = Object.fromEntries(trucks.map((item) => [item.id, item.identity_label]));
  const buckets = new Map<string, { authorized: number; denied: number }>();
  for (let day = 6; day >= 0; day -= 1) buckets.set(midnight(day).toISOString().slice(0, 10), { authorized: 0, denied: 0 });
  for (const row of activityResult.data ?? []) {
    const bucket = buckets.get(new Date(row.occurred_at).toISOString().slice(0, 10));
    if (!bucket) continue;
    if (row.result === "success") bucket.authorized += 1;
    else if (row.result === "denied" || row.result === "failure") bucket.denied += 1;
  }
  const openSafety = openSafetyResult.data ?? [];
  const roomIds = (areaResult.data ?? []).filter((area) => area.area_type_code === "room").map((area) => area.id);
  const [{ data: roomConfigs }, { data: recentReadings }] = await Promise.all([
    roomIds.length ? client.from("room_environment_configs").select("area_id,gas_exposure_seconds,smoke_warning_value,smoke_danger_value,temperature_warning_low_c,temperature_danger_low_c,temperature_warning_high_c,temperature_danger_high_c,humidity_warning_low_pct,humidity_danger_low_pct,humidity_warning_high_pct,humidity_danger_high_pct").in("area_id", roomIds) : Promise.resolve({ data: [] }),
    roomIds.length ? client.from("sensor_readings").select("area_id,recorded_at,smoke_value").in("area_id", roomIds).order("recorded_at", { ascending: false }).limit(300) : Promise.resolve({ data: [] }),
  ]);
  const latestReading = readingResult.data;
  const activeConfig = (roomConfigs ?? []).find((config) => config.area_id === latestReading?.area_id) ?? roomConfigs?.[0];
  const exposureLimit = numberOrNull(activeConfig?.gas_exposure_seconds);
  const smokeDanger = FIRMWARE_SMOKE_DANGER;
  const temperature = numberOrNull(latestReading?.temperature_c);
  const humidity = numberOrNull(latestReading?.humidity_pct);
  const smoke = numberOrNull(latestReading?.smoke_value);
  // Match the Arduino IDE firmware directly: high values trigger warning,
  // except smoke, which has separate warning and danger levels.
  const temperatureState: SensorState = temperature == null ? null : temperature >= FIRMWARE_TEMP_FIRE_C ? "WARNING" : "NORMAL";
  const humidityState: SensorState = humidity == null ? null : humidity >= FIRMWARE_HUMIDITY_WARNING_PCT ? "WARNING" : "NORMAL";
  const smokeState: SensorState = smoke == null ? null : smoke >= FIRMWARE_SMOKE_DANGER ? "DANGER" : smoke >= FIRMWARE_SMOKE_WARNING ? "WARNING" : "NORMAL";
  let smokeExposureSeconds: number | null = null;
  if (latestReading?.smoke_value != null && smokeDanger != null && Number(latestReading.smoke_value) >= smokeDanger && exposureLimit != null) {
    const readings = (recentReadings ?? []).filter((reading) => reading.area_id === latestReading.area_id);
    const clearReading = readings.find((reading) => reading.smoke_value == null || Number(reading.smoke_value) < smokeDanger);
    const readingsSinceClear = clearReading ? readings.slice(0, readings.indexOf(clearReading)) : readings;
    const oldestHigh = [...readingsSinceClear].reverse().find((reading) => reading.smoke_value != null && Number(reading.smoke_value) >= smokeDanger);
    const startedAt = oldestHigh?.recorded_at ?? latestReading.recorded_at;
    smokeExposureSeconds = Math.max(0, exposureLimit - Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  }
  const emergencyActive = emergencyResult.data?.state === "emergency_release";
  const danger = emergencyActive || openSafety.some((item) => item.severity === "critical");
  const warning = !danger && openSafety.some((item) => item.severity === "warning");
  const environmentalState = String(readingResult.data?.environmental_state ?? "").trim().toUpperCase();
  const fireState = String(readingResult.data?.fire_state ?? "").trim().toUpperCase();
  const triggerReason = typeof readingResult.data?.trigger_reason === "string"
    ? readingResult.data.trigger_reason.trim()
    : "";
  // Environmental DANGER/high gas is not a fire alarm by itself. The fire
  // alarm turns on only when the backend has completed one of the fire rules:
  // high temperature + high gas, sudden high temperature rise, or long smoke
  // exposure after the configured countdown.
  const smokeExposureReached = smokeExposureSeconds != null && smokeExposureSeconds <= 0;
  const fireActive = fireState === "ON" || smokeExposureReached;
  const displayTriggerReason = fireActive
    ? triggerReason || (smokeExposureReached ? "Long smoke exposure" : "Fire condition detected")
    : null;

  return {
    ...blank(true), displayName, role,
    warehouses: warehouses.map((item) => ({ id: item.id, name: item.name })), selectedWarehouseId: role === "system_admin" ? warehouses.find(() => true)?.id ?? null : null,
    staff: { total: staff.length, active: staff.filter((item) => item.is_active).length, inactive: staff.filter((item) => !item.is_active).length },
    trucks: { total: trucks.length, active: trucks.filter((item) => item.is_active).length, inactive: trucks.filter((item) => !item.is_active).length },
    accessToday: { total: todayAccess.length, authorized: todayAccess.filter((item) => item.result === "success").length, denied: todayAccess.filter((item) => item.result !== "success").length },
    staffAccessToday: todayAccess.filter((item) => item.result === "success" && (item.authentication_method.startsWith("staff_") || Boolean(item.staff_member_id))).length,
    plateAccessToday: todayAccess.filter((item) => item.result === "success" && item.authentication_method === "truck_plate" && (role !== "driver" || item.truck_id === assignedTruckId)).length,
    safetyToday: { total: safety.length, warnings: safety.filter((item) => item.severity === "warning").length, dangers: safety.filter((item) => item.severity === "critical").length }, unresolvedSafetyCount: openSafety.length,
    activity: Array.from(buckets.values()).map((item, index) => ({ ...item, label: midnight(6 - index).toLocaleDateString("en-US", { month: "short", day: "numeric" }) })),
    environment: { temperature, humidity, smoke, temperatureState, humidityState, smokeState, environmentalState: environmentalState === "WARNING" || environmentalState === "DANGER" || environmentalState === "NORMAL" ? environmentalState : null, fireState: fireActive ? "ON" : fireState === "OFF" ? "OFF" : null, triggerReason: displayTriggerReason, recordedAt: readingResult.data?.recorded_at ?? null, gasExposureSeconds: exposureLimit, smokeExposureSeconds },
    warehouseStatus: danger ? "danger" : warning ? "warning" : "normal",
    emergency: { active: emergencyActive || openSafety.some((item) => item.severity === "critical"), reason: emergencyResult.data?.reason ?? null },
    devices: (deviceResult.data ?? []).map((item) => ({ id: item.id, name: item.name, online: Boolean(item.last_seen_at && new Date(item.last_seen_at).getTime() > Date.now() - 300000) })),
    recentAccess: (recentResult.data ?? []) as AccessRow[], areas, staffNames, truckNames,
  };
}
