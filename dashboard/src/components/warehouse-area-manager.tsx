"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Check, LockKeyhole, Plus } from "lucide-react";
import { addWarehouseArea, setActiveDemoArea, updateWarehouseAreaState, type AreaMutationState } from "@/app/areas/actions";
import type { AreaWarehouse, WarehouseArea, WarehouseAreaType } from "@/lib/areas-data";

const initialState: AreaMutationState = { success: false, message: "" };
const labels: Record<string, string> = {
  truck_entrance: "Truck Entrance",
  staff_entrance: "Staff Entrance",
  staff_room_1: "Electronics Supply",
  staff_room_2: "Furniture Supply",
  staff_room_3: "Server Room",
  staff_room_4: "Staff Room 4",
};
const stateLabels: Record<string, string> = { locked: "Locked", unlocked: "Unlocked", emergency_release: "Emergency Release" };

export function WarehouseAreaManager({ warehouses, types, areas, activeAreaByWarehouse }: { warehouses: AreaWarehouse[]; types: WarehouseAreaType[]; areas: WarehouseArea[]; activeAreaByWarehouse: Record<string, string | null> }) {
  const router = useRouter();
  const [addState, addAction, addPending] = useActionState(addWarehouseArea, initialState);
  const [stateState, stateAction, statePending] = useActionState(updateWarehouseAreaState, initialState);
  const [demoState, demoAction, demoPending] = useActionState(setActiveDemoArea, initialState);
  const pending = addPending || statePending || demoPending;

  useEffect(() => {
    if (addState.success || stateState.success || demoState.success) router.refresh();
  }, [addState, stateState, router]);

  const areasByWarehouse = new Map<string, WarehouseArea[]>();
  for (const area of areas) areasByWarehouse.set(area.warehouse_id, [...(areasByWarehouse.get(area.warehouse_id) ?? []), area]);
  const configuredTypes = new Set(areas.map((area) => `${area.warehouse_id}:${area.area_type_code}`));

  return <div className="space-y-5">
    {warehouses.map((warehouse) => {
      const warehouseAreas = areasByWarehouse.get(warehouse.id) ?? [];
      const availableTypes = types.filter((type) => !configuredTypes.has(`${warehouse.id}:${type.code}`));
      const activeAreaId = activeAreaByWarehouse[warehouse.id] ?? null;
      return <section key={warehouse.id} className="overflow-hidden rounded-2xl border border-white/10 bg-[#0b1d34]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-4"><div><h2 className="font-semibold text-white">{warehouse.name}</h2><p className="mt-1 text-xs text-slate-500">{warehouseAreas.length} configured area{warehouseAreas.length === 1 ? "" : "s"}</p></div><span className="rounded-full bg-cyan-400/10 px-2.5 py-1 text-[11px] text-cyan-200">Warehouse-scoped</span></div>
        <div className="space-y-3 p-5"><div className="rounded-xl border border-cyan-400/15 bg-cyan-400/[0.05] p-4"><p className="text-xs font-medium uppercase tracking-wider text-cyan-300">Active demo area</p><p className="mt-1 text-sm text-white">{areaName(warehouseAreas.find((area) => area.id === activeAreaId))}</p><p className="mt-1 text-[11px] text-slate-500">New sensor readings from the Arduino are assigned to this area.</p><form action={demoAction} className="mt-3 flex flex-wrap gap-2"><input type="hidden" name="warehouseId" value={warehouse.id} /><select name="areaId" defaultValue={activeAreaId ?? ""} disabled={pending || !warehouseAreas.length} className="min-w-[220px] flex-1 rounded-lg border border-white/10 bg-[#10233d] px-3 py-2.5 text-sm text-white"><option value="">Select an area</option>{warehouseAreas.map((area) => <option key={area.id} value={area.id}>{areaName(area)}</option>)}</select><button type="submit" disabled={pending || !warehouseAreas.length} className="rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{demoPending ? "Switching..." : "Use for demo"}</button></form></div>
          {!warehouseAreas.length && <p className="rounded-lg border border-dashed border-white/10 px-4 py-5 text-sm text-slate-400">No warehouse areas configured.</p>}
          {warehouseAreas.map((area) => <AreaRow key={`${area.id}-${area.state}`} area={area} action={stateAction} pending={pending} active={area.id === activeAreaId} />)}
          <form action={addAction} className="flex flex-wrap items-end gap-3 border-t border-white/[0.07] pt-4"><input type="hidden" name="warehouseId" value={warehouse.id} /><label className="min-w-[260px] flex-1 text-xs text-slate-400">Add area type<select name="areaTypeCode" required disabled={pending || availableTypes.length === 0} defaultValue="" className="mt-2 w-full rounded-lg border border-white/10 bg-[#10233d] px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300 disabled:opacity-50"><option value="">{availableTypes.length ? "Select an area type" : "All area types configured"}</option>{availableTypes.map((type) => <option key={type.code} value={type.code}>{areaLabel(type.code)}</option>)}</select></label><button type="submit" disabled={pending || availableTypes.length === 0} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"><Plus size={15} />{addPending ? "Adding..." : "Add area"}</button></form>
        </div>
      </section>;
    })}
    {(addState.message || stateState.message || demoState.message) && <p className={`rounded-xl border px-4 py-3 text-sm ${addState.success || stateState.success ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200" : "border-rose-400/20 bg-rose-400/10 text-rose-200"}`}>{addState.message || stateState.message || demoState.message}</p>}
  </div>;
}

function AreaRow({ area, action, pending, active }: { area: WarehouseArea; action: (payload: FormData) => void; pending: boolean; active: boolean }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-[#10233d] px-4 py-3"><div><div className="flex items-center gap-2"><p className="text-sm font-medium text-white">{areaName(area)}</p>{active && <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-300">ACTIVE DEMO</span>}</div><p className="mt-1 text-xs text-slate-500">Operational state: {stateLabels[area.state] ?? area.state}</p></div><form action={action} className="flex items-center gap-2"><input type="hidden" name="areaId" value={area.id} /><LockKeyhole size={14} className="text-slate-500" /><select name="state" defaultValue={area.state} disabled={pending} className="rounded-md border border-white/10 bg-[#0b1d34] px-2.5 py-2 text-xs text-white outline-none focus:border-cyan-300"><option value="locked">Locked</option><option value="unlocked">Unlocked</option><option value="emergency_release">Emergency Release</option></select><button type="submit" disabled={pending} className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2.5 py-2 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50"><Check size={13} />{pending ? "Saving..." : "Save"}</button></form></div>;
}

function areaLabel(code: string) { return labels[code] ?? code.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }

function areaName(area?: WarehouseArea) { return area?.name?.trim() || areaLabel(area?.area_type_code ?? "area"); }
