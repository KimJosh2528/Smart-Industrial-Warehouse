import { createClient } from "./supabase/server";
import { getAuthorizedWarehouses } from "./warehouse-scope";

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
  role: "father_admin" | "system_admin" | null;
  warehouses: { id: string; name: string }[];
  selectedWarehouseId: string | null;
  staff: { total: number; active: number; inactive: number };
  trucks: { total: number; active: number; inactive: number };
  accessToday: { total: number; authorized: number; denied: number };
  safetyToday: { total: number; warnings: number; dangers: number };
  unresolvedSafetyCount: number;
  activity: { label: string; authorized: number; denied: number }[];
  environment: { temperature: number | null; humidity: number | null; smoke: number | null };
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
  staff: { total: 0, active: 0, inactive: 0 }, trucks: { total: 0, active: 0, inactive: 0 },
  accessToday: { total: 0, authorized: 0, denied: 0 }, safetyToday: { total: 0, warnings: 0, dangers: 0 }, unresolvedSafetyCount: 0,
  activity: [], environment: { temperature: null, humidity: null, smoke: null },
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
  const warehouseIds = warehouses.map((warehouse) => warehouse.id);
  const today = midnight().toISOString();
  const sevenDaysAgo = midnight(6).toISOString();

  const [staffResult, truckResult, areaResult, deviceResult, todayAccessResult, recentResult,
    safetyResult, readingResult, emergencyResult, activityResult, openSafetyResult] = await Promise.all([
    client.from("staff_members").select("id,display_name,is_active").in("warehouse_id", warehouseIds),
    client.from("trucks").select("id,identity_label,is_active").in("warehouse_id", warehouseIds),
    client.from("warehouse_areas").select("id,area_type_code").in("warehouse_id", warehouseIds),
    client.from("devices").select("id,name,last_seen_at").in("warehouse_id", warehouseIds).order("name"),
    client.from("access_logs").select("id,occurred_at,result,authentication_method,area_id,staff_member_id,truck_id,metadata").in("warehouse_id", warehouseIds).gte("occurred_at", today),
    client.from("access_logs").select("id,occurred_at,result,authentication_method,area_id,staff_member_id,truck_id,metadata").in("warehouse_id", warehouseIds).order("occurred_at", { ascending: false }).limit(10),
    client.from("safety_events").select("severity,status").in("warehouse_id", warehouseIds).gte("occurred_at", today),
    client.from("sensor_readings").select("temperature_c,humidity_pct,smoke_value").in("warehouse_id", warehouseIds).order("recorded_at", { ascending: false }).limit(1).maybeSingle(),
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
  const emergencyActive = emergencyResult.data?.state === "emergency_release";
  const danger = emergencyActive || openSafety.some((item) => item.severity === "critical");
  const warning = !danger && openSafety.some((item) => item.severity === "warning");

  return {
    ...blank(true), displayName, role,
    warehouses: warehouses.map((item) => ({ id: item.id, name: item.name })), selectedWarehouseId: role === "system_admin" ? warehouses.find(() => true)?.id ?? null : null,
    staff: { total: staff.length, active: staff.filter((item) => item.is_active).length, inactive: staff.filter((item) => !item.is_active).length },
    trucks: { total: trucks.length, active: trucks.filter((item) => item.is_active).length, inactive: trucks.filter((item) => !item.is_active).length },
    accessToday: { total: todayAccess.length, authorized: todayAccess.filter((item) => item.result === "success").length, denied: todayAccess.filter((item) => item.result !== "success").length },
    safetyToday: { total: safety.length, warnings: safety.filter((item) => item.severity === "warning").length, dangers: safety.filter((item) => item.severity === "critical").length }, unresolvedSafetyCount: openSafety.length,
    activity: Array.from(buckets.values()).map((item, index) => ({ ...item, label: midnight(6 - index).toLocaleDateString("en-US", { month: "short", day: "numeric" }) })),
    environment: { temperature: numberOrNull(readingResult.data?.temperature_c), humidity: numberOrNull(readingResult.data?.humidity_pct), smoke: numberOrNull(readingResult.data?.smoke_value) },
    warehouseStatus: danger ? "danger" : warning ? "warning" : "normal",
    emergency: { active: emergencyActive || openSafety.some((item) => item.severity === "critical"), reason: emergencyResult.data?.reason ?? null },
    devices: (deviceResult.data ?? []).map((item) => ({ id: item.id, name: item.name, online: Boolean(item.last_seen_at && new Date(item.last_seen_at).getTime() > Date.now() - 300000) })),
    recentAccess: (recentResult.data ?? []) as AccessRow[], areas, staffNames, truckNames,
  };
}
