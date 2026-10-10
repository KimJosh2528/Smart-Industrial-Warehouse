import { loadAreasData } from "@/lib/areas-data";
import { SecurityChannelsWorkspace } from "@/components/security-channels-workspace";
import { createClient } from "@/lib/supabase/server";
import { getAuthorizedWarehouses } from "@/lib/warehouse-scope";

export default async function SecurityChannelsPage() {
  const data = await loadAreasData();
  const client = await createClient();
  const scope = await getAuthorizedWarehouses(client);
  if (scope.role !== "system_admin") return null;
  const accessibleAreaIds: string[] | null = null;
  const visibleAreaIds = accessibleAreaIds === null ? data.areas.map((area) => area.id) : accessibleAreaIds;
  const { data: recentLogs } = visibleAreaIds.length
    ? await client.from("access_logs").select("area_id,event_type,result,occurred_at").in("area_id", visibleAreaIds).order("occurred_at", { ascending: false }).limit(100)
    : { data: [] as Array<{ area_id: string; event_type: string; result: string; occurred_at: string }> };
  const lastEvents = Object.fromEntries((recentLogs ?? []).reduce<Array<[string, { eventType: string; result: string; occurredAt: string }]>>((items, row) => {
    if (!items.some(([areaId]) => areaId === row.area_id)) items.push([row.area_id, { eventType: row.event_type, result: row.result, occurredAt: row.occurred_at }]);
    return items;
  }, []));
  const warehouseIds = scope.warehouses.map((warehouse) => warehouse.id);
  const [{ data: people }, { data: trucks }, { data: drivers }] = await Promise.all([
    warehouseIds.length ? client.from("staff_members").select("id,display_name,member_type").in("warehouse_id", warehouseIds).order("display_name") : Promise.resolve({ data: [] }),
    warehouseIds.length ? client.from("trucks").select("id,identity_label,plate_number,current_driver_id").in("warehouse_id", warehouseIds).order("identity_label") : Promise.resolve({ data: [] }),
    warehouseIds.length ? client.from("drivers").select("id,display_name").in("warehouse_id", warehouseIds).order("display_name") : Promise.resolve({ data: [] }),
  ]);
  const driverNames = new Map(((drivers ?? []) as Array<{ id: string; display_name: string }>).map((driver) => [driver.id, driver.display_name]));
  const staffActors = ((people ?? []) as Array<{ id: string; display_name: string; member_type: "staff" | "guard" }>).map((person) => ({ id: person.id, label: `${person.display_name} (${person.member_type === "guard" ? "Guard" : "Staff"})` }));
  const truckActors = ((trucks ?? []) as Array<{ id: string; identity_label: string; plate_number: string; current_driver_id: string | null }>).map((truck) => ({ id: truck.id, label: `${driverNames.get(truck.current_driver_id ?? "") ?? "Unassigned driver"} — ${truck.identity_label} · ${truck.plate_number}` }));
  return <SecurityChannelsWorkspace areas={data.areas} error={data.error} viewerRole={scope.role} accessibleAreaIds={accessibleAreaIds} cameraTunnelUrl={process.env.CAMERA_TUNNEL_URL ?? "http://127.0.0.1:5001"} lastEvents={lastEvents} staffActors={staffActors} truckActors={truckActors} />;
}
