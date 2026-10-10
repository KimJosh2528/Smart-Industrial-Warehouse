import { createClient } from "./supabase/server";
import { getAuthorizedWarehouses } from "./warehouse-scope";

export const accessMethods = ["staff_rfid", "staff_face", "truck_plate"] as const;
export const accessResults = ["authorized", "unauthorized", "no_readings"] as const;

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
  role: "father_admin" | "system_admin" | "staff" | "guard" | "driver" | null;
  rows: AccessLogItem[];
  total: number;
  page: number;
  pageSize: number;
  areas: { id: string; name: string }[];
};

const empty = (filters: AccessLogFilters, error: string | null = null): AccessLogsData => ({
  configured: !error,
  error,
  role: null,
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

  const scope = await getAuthorizedWarehouses(client);
  if (scope.error) return empty(filters, scope.error);
  const warehouseIds = scope.warehouses.map((warehouse) => warehouse.id);
  if (!warehouseIds.length) return { ...empty(filters, "No warehouse is available."), role: scope.role };

  const { data: areaRows } = await client
    .from("warehouse_areas")
    .select("id,name,area_type_code,entrance_category")
    .in("warehouse_id", warehouseIds);
  const entranceRows = (areaRows ?? []).filter((item) => item.area_type_code === "staff_entrance" || item.area_type_code === "truck_entrance");
  const areas = entranceRows.map((item) => ({ id: item.id, name: item.name ?? item.entrance_category ?? item.area_type_code }));
  const entranceIds = entranceRows.map((item) => item.id);
  if (!entranceIds.length) return { ...empty(filters), configured: true, areas, role: scope.role };

  let query = client
    .from("access_logs")
    .select("id,area_id,device_id,credential_id,staff_member_id,truck_id,event_type,authentication_method,result,occurred_at,metadata", { count: "exact" })
    .in("warehouse_id", warehouseIds)
    .in("area_id", entranceIds)
    .neq("authentication_method", "truck_rfid")
    .order("occurred_at", { ascending: false });

  if (scope.role === "driver") {
    const { data: driver } = await client.from("drivers").select("id").eq("profile_id", scope.userId).maybeSingle<{ id: string }>();
    const { data: truck } = driver
      ? await client.from("trucks").select("id").eq("current_driver_id", driver.id).maybeSingle<{ id: string }>()
      : { data: null };
    // Driver access history is plate-only and limited to the assigned truck.
    query = query.eq("authentication_method", "truck_plate").eq("truck_id", truck?.id ?? "00000000-0000-0000-0000-000000000000");
  }

  if (filters.result && accessResults.includes(filters.result as (typeof accessResults)[number])) query = query.eq("result", filters.result === "authorized" ? "success" : filters.result === "unauthorized" ? "denied" : "failure");
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
  if (error) return { ...empty(filters, "Access logs could not be loaded."), areas, role: scope.role };

  const staffIds = [...new Set((logs ?? []).map((item) => item.staff_member_id).filter(Boolean))];
  const truckIds = [...new Set((logs ?? []).map((item) => item.truck_id).filter(Boolean))];
  const deviceIds = [...new Set((logs ?? []).map((item) => item.device_id).filter(Boolean))];
  const [staffResult, truckResult, deviceResult] = await Promise.all([
    staffIds.length ? client.from("staff_members").select("id,display_name,member_type").in("id", staffIds) : Promise.resolve({ data: [] }),
    truckIds.length ? client.from("trucks").select("id,identity_label,plate_number,current_driver_id").in("id", truckIds) : Promise.resolve({ data: [] }),
    deviceIds.length ? client.from("devices").select("id,name").in("id", deviceIds) : Promise.resolve({ data: [] }),
  ]);
  const staffNames = new Map((staffResult.data ?? []).map((item) => [item.id, `${item.display_name} (${item.member_type === "guard" ? "Guard" : "Staff"})`]));
  const truckNames = new Map((truckResult.data ?? []).map((item) => [item.id, `${item.identity_label} (${item.plate_number})`]));
  const truckDriverIds = [...new Set((truckResult.data ?? []).map((item) => item.current_driver_id).filter(Boolean))];
  const { data: truckDrivers } = truckDriverIds.length
    ? await client.from("drivers").select("id,display_name").in("id", truckDriverIds)
    : { data: [] };
  const truckDriverNames = new Map((truckDrivers ?? []).map((item) => [item.id, item.display_name]));
  const deviceNames = new Map((deviceResult.data ?? []).map((item) => [item.id, item.name]));
  const areaNames = new Map(areas.map((area) => [area.id, area.name]));

  return {
    configured: true,
    error: null,
    role: scope.role,
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
      personName: item.authentication_method === "truck_plate" && !item.truck_id
        ? "Unknown plate"
        : item.truck_id
        ? (() => {
            const truck = (truckResult.data ?? []).find((candidate) => candidate.id === item.truck_id);
            return truck?.current_driver_id ? `${truckDriverNames.get(truck.current_driver_id) ?? "Assigned driver"} (Driver)` : truckNames.get(item.truck_id) ?? "Registered truck";
          })()
        : item.result === "denied" && item.metadata?.reason === "inactive_credential"
        ? "Unregistered RFID"
        : item.staff_member_id
          ? staffNames.get(item.staff_member_id) ?? "Registered staff RFID"
          : item.credential_id
            ? "Registered RFID"
            : "Unregistered RFID",
      truckName: item.truck_id ? truckNames.get(item.truck_id) ?? null : null,
      deviceName: item.device_id ? deviceNames.get(item.device_id) ?? null : null,
    })),
    total: count ?? 0,
    page: filters.page,
    pageSize: filters.pageSize,
    areas,
  };
}
