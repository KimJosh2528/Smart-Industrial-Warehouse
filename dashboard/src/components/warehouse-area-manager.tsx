"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Check, LockKeyhole, Plus } from "lucide-react";
import { addWarehouseArea, updateWarehouseAreaState, type AreaMutationState } from "@/app/areas/actions";
import type { AreaWarehouse, WarehouseArea, WarehouseAreaType } from "@/lib/areas-data";

const initialState: AreaMutationState = { success: false, message: "" };
const labels: Record<string, string> = {
  truck_entrance: "Truck Entrance",
  staff_entrance: "Staff Entrance",
  staff_room_1: "Room 1 — Server & IT Room",
  staff_room_2: "Room 2 — HR & Personnel Office",
  staff_room_3: "Room 3 — High-Value Inventory Cage",
  staff_room_4: "Room 4 — Manager's Office & Finance Room",
};
const stateLabels: Record<string, string> = { locked: "Locked", unlocked: "Unlocked", emergency_release: "Emergency Release" };

export function WarehouseAreaManager({ warehouses, types, areas }: { warehouses: AreaWarehouse[]; types: WarehouseAreaType[]; areas: WarehouseArea[] }) {
  const router = useRouter();
  const [addState, addAction, addPending] = useActionState(addWarehouseArea, initialState);
  const [stateState, stateAction, statePending] = useActionState(updateWarehouseAreaState, initialState);
  const pending = addPending || statePending;

  useEffect(() => {
    if (addState.success || stateState.success) router.refresh();
  }, [addState, stateState, router]);

  const areasByWarehouse = new Map<string, WarehouseArea[]>();
  for (const area of areas) areasByWarehouse.set(area.warehouse_id, [...(areasByWarehouse.get(area.warehouse_id) ?? []), area]);
  const configuredTypes = new Set(areas.map((area) => `${area.warehouse_id}:${area.area_type_code}`));

  return <div className="space-y-5">
    {warehouses.map((warehouse) => {
      const warehouseAreas = areasByWarehouse.get(warehouse.id) ?? [];
      const availableTypes = types.filter((type) => !configuredTypes.has(`${warehouse.id}:${type.code}`));
      return <section key={warehouse.id} className="overflow-hidden rounded-2xl border border-white/10 bg-[#0b1d34]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-4"><div><h2 className="font-semibold text-white">{warehouse.name}</h2><p className="mt-1 text-xs text-slate-500">{warehouseAreas.length} configured area{warehouseAreas.length === 1 ? "" : "s"}</p></div><span className="rounded-full bg-cyan-400/10 px-2.5 py-1 text-[11px] text-cyan-200">Warehouse-scoped</span></div>
        <div className="space-y-3 p-5">
          {!warehouseAreas.length && <p className="rounded-lg border border-dashed border-white/10 px-4 py-5 text-sm text-slate-400">No warehouse areas configured.</p>}
          {warehouseAreas.map((area) => <AreaRow key={`${area.id}-${area.state}`} area={area} action={stateAction} pending={pending} />)}
          <form action={addAction} className="flex flex-wrap items-end gap-3 border-t border-white/[0.07] pt-4"><input type="hidden" name="warehouseId" value={warehouse.id} /><label className="min-w-[260px] flex-1 text-xs text-slate-400">Add area type<select name="areaTypeCode" required disabled={pending || availableTypes.length === 0} defaultValue="" className="mt-2 w-full rounded-lg border border-white/10 bg-[#10233d] px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300 disabled:opacity-50"><option value="">{availableTypes.length ? "Select an area type" : "All area types configured"}</option>{availableTypes.map((type) => <option key={type.code} value={type.code}>{areaLabel(type.code)}</option>)}</select></label><button type="submit" disabled={pending || availableTypes.length === 0} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"><Plus size={15} />{addPending ? "Adding..." : "Add area"}</button></form>
        </div>
      </section>;
    })}
    {(addState.message || stateState.message) && <p className={`rounded-xl border px-4 py-3 text-sm ${addState.success || stateState.success ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200" : "border-rose-400/20 bg-rose-400/10 text-rose-200"}`}>{addState.message || stateState.message}</p>}
  </div>;
}

function AreaRow({ area, action, pending }: { area: WarehouseArea; action: (payload: FormData) => void; pending: boolean }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-[#10233d] px-4 py-3"><div><p className="text-sm font-medium text-white">{areaLabel(area.area_type_code)}</p><p className="mt-1 text-xs text-slate-500">Operational state: {stateLabels[area.state] ?? area.state}</p></div><form action={action} className="flex items-center gap-2"><input type="hidden" name="areaId" value={area.id} /><LockKeyhole size={14} className="text-slate-500" /><select name="state" defaultValue={area.state} disabled={pending} className="rounded-md border border-white/10 bg-[#0b1d34] px-2.5 py-2 text-xs text-white outline-none focus:border-cyan-300"><option value="locked">Locked</option><option value="unlocked">Unlocked</option><option value="emergency_release">Emergency Release</option></select><button type="submit" disabled={pending} className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2.5 py-2 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50"><Check size={13} />{pending ? "Saving..." : "Save"}</button></form></div>;
}

function areaLabel(code: string) { return labels[code] ?? code.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
