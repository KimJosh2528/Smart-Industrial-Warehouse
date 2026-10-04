import { createClient } from "./supabase/server";

export const accessMethods = ["staff_rfid", "staff_pin", "truck_plate", "truck_rfid", "unknown"] as const;
export const accessResults = ["success", "failure", "denied"] as const;

export type AccessLogFilters = {
  page: number;
  pageSize: number;
  search: string;
  result: string;
  method: string;
  areaId: string;
  dateFrom: string;
  dateTo: string;
};

export type AccessLogItem = {
  id: string;
  areaId: string | null;
  deviceId: string | null;
  credentialId: string | null;
  staffMemberId: string | null;
  truckId: string | null;
  eventType: string;
  authenticationMethod: string;
  result: string;
  occurredAt: string;
  metadata: Record<string, unknown>;
  areaName: string | null;
  personName: string | null;
  truckName: string | null;
  deviceName: string | null;
};

export type AccessLogsData = {
  configured: boolean;
  error: string | null;
  rows: AccessLogItem[];
  total: number;
  page: number;
  pageSize: number;
  areas: { id: string; name: string }[];
};

const empty = (filters: AccessLogFilters, error: string | null = null): AccessLogsData => ({
  configured: !error,
  error,
  rows: [],
  total: 0,
  page: filters.page,
  pageSize: filters.pageSize,
  areas: [],
});

function dateStart(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : null;
}

function dateEnd(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.999Z` : null;
}

export async function loadAccessLogs(filters: AccessLogFilters): Promise<AccessLogsData> {
  let client;
  try {
    client = await createClient();
  } catch {
    return empty(filters, "Supabase is not configured.");
  }

  const { data: warehouses, error: warehouseError } = await client
    .from("warehouses")
    .select("id")
    .order("name")
    .limit(1);
  const warehouseId = warehouses?.[0]?.id;
  if (warehouseError || !warehouseId) return empty(filters, warehouseError?.message ?? "No warehouse is available.");

  const { data: areaRows } = await client
    .from("warehouse_areas")
    .select("id,area_type_code")
    .eq("warehouse_id", warehouseId);
  const { data: areaTypes } = await client.from("warehouse_area_types").select("code,name");
  const areaTypeNames = new Map((areaTypes ?? []).map((item) => [item.code, item.name]));
  const areas = (areaRows ?? []).map((item) => ({ id: item.id, name: areaTypeNames.get(item.area_type_code) ?? item.area_type_code }));

  let query = client
    .from("access_logs")
    .select("id,area_id,device_id,credential_id,staff_member_id,truck_id,event_type,authentication_method,result,occurred_at,metadata", { count: "exact" })
    .eq("warehouse_id", warehouseId)
    .order("occurred_at", { ascending: false });

  if (filters.result && accessResults.includes(filters.result as (typeof accessResults)[number])) query = query.eq("result", filters.result);
  if (filters.method && accessMethods.includes(filters.method as (typeof accessMethods)[number])) query = query.eq("authentication_method", filters.method);
  if (filters.areaId && areas.some((area) => area.id === filters.areaId)) query = query.eq("area_id", filters.areaId);
  const from = dateStart(filters.dateFrom);
  const to = dateEnd(filters.dateTo);
  if (from) query = query.gte("occurred_at", from);
  if (to) query = query.lte("occurred_at", to);
  const search = filters.search.replace(/[^a-zA-Z0-9_ -]/g, "").trim();
  if (search) query = query.or(`event_type.ilike.%${search}%,authentication_method.ilike.%${search}%`);

  const fromIndex = (filters.page - 1) * filters.pageSize;
  const { data: logs, count, error } = await query.range(fromIndex, fromIndex + filters.pageSize - 1);
  if (error) return { ...empty(filters, "Access logs could not be loaded."), areas };

  const staffIds = [...new Set((logs ?? []).map((item) => item.staff_member_id).filter(Boolean))];
  const truckIds = [...new Set((logs ?? []).map((item) => item.truck_id).filter(Boolean))];
  const deviceIds = [...new Set((logs ?? []).map((item) => item.device_id).filter(Boolean))];
  const [staffResult, truckResult, deviceResult] = await Promise.all([
    staffIds.length ? client.from("staff_members").select("id,display_name").in("id", staffIds) : Promise.resolve({ data: [] }),
    truckIds.length ? client.from("trucks").select("id,identity_label,plate_number").in("id", truckIds) : Promise.resolve({ data: [] }),
    deviceIds.length ? client.from("devices").select("id,name").in("id", deviceIds) : Promise.resolve({ data: [] }),
  ]);
  const staffNames = new Map((staffResult.data ?? []).map((item) => [item.id, item.display_name]));
  const truckNames = new Map((truckResult.data ?? []).map((item) => [item.id, `${item.identity_label} (${item.plate_number})`]));
  const deviceNames = new Map((deviceResult.data ?? []).map((item) => [item.id, item.name]));
  const areaNames = new Map(areas.map((area) => [area.id, area.name]));

  return {
    configured: true,
    error: null,
    rows: (logs ?? []).map((item) => ({
      id: item.id,
      areaId: item.area_id,
      deviceId: item.device_id,
      credentialId: item.credential_id,
      staffMemberId: item.staff_member_id,
      truckId: item.truck_id,
      eventType: item.event_type,
      authenticationMethod: item.authentication_method,
      result: item.result,
      occurredAt: item.occurred_at,
      metadata: item.metadata ?? {},
      areaName: item.area_id ? areaNames.get(item.area_id) ?? null : null,
      personName: item.staff_member_id ? staffNames.get(item.staff_member_id) ?? null : null,
      truckName: item.truck_id ? truckNames.get(item.truck_id) ?? null : null,
      deviceName: item.device_id ? deviceNames.get(item.device_id) ?? null : null,
    })),
    total: count ?? 0,
    page: filters.page,
    pageSize: filters.pageSize,
    areas,
  };
}
