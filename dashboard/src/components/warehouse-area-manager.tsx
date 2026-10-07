"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { addWarehouseArea, deleteWarehouseArea, setActiveDemoArea, updateWarehouseArea, updateWarehouseAreaState, type AreaMutationState } from "@/app/areas/actions";
import type { AreaWarehouse, WarehouseArea } from "@/lib/areas-data";

const initialState: AreaMutationState = { success: false, message: "" };
const stateLabels: Record<string, string> = { locked: "Locked", unlocked: "Unlocked", emergency_release: "Emergency Release" };

export function WarehouseAreaManager({ warehouses, areas, activeAreaByWarehouse }: { warehouses: AreaWarehouse[]; areas: WarehouseArea[]; activeAreaByWarehouse: Record<string, string | null> }) {
  const router = useRouter();
  const [addState, addAction, addPending] = useActionState(addWarehouseArea, initialState);
  const [updateState, updateAction, updatePending] = useActionState(updateWarehouseArea, initialState);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteWarehouseArea, initialState);
  const [stateState, stateAction, statePending] = useActionState(updateWarehouseAreaState, initialState);
  const [demoState, demoAction, demoPending] = useActionState(setActiveDemoArea, initialState);
  const pending = addPending || updatePending || deletePending || statePending || demoPending;

  useEffect(() => {
    if (addState.success || updateState.success || deleteState.success || stateState.success || demoState.success) router.refresh();
  }, [addState, updateState, deleteState, stateState, demoState, router]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const message = addState.message || updateState.message || deleteState.message || stateState.message || demoState.message;
  const success = addState.success || updateState.success || deleteState.success || stateState.success || demoState.success;

  return <div className="space-y-6">
    {warehouses.map((warehouse) => {
      const warehouseAreas = areas.filter((area) => area.warehouse_id === warehouse.id);
      const activeAreaId = activeAreaByWarehouse[warehouse.id] ?? null;
      return <section key={warehouse.id} className="rounded-2xl border border-white/10 bg-[#0b1d34]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-4"><div><h2 className="font-semibold text-white">{warehouse.name}</h2><p className="mt-1 text-xs text-slate-500">{warehouseAreas.length} area{warehouseAreas.length === 1 ? "" : "s"}</p></div></div>
        <div className="space-y-4 p-5">
          <div className="rounded-xl border border-cyan-400/15 bg-cyan-400/[0.05] p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-cyan-300">Active demo area</p>
            <form action={demoAction} className="mt-3 flex flex-wrap gap-2">
              <input type="hidden" name="warehouseId" value={warehouse.id} />
              <select name="areaId" defaultValue={activeAreaId ?? ""} disabled={pending || !warehouseAreas.length} className="min-w-[220px] flex-1 rounded-lg border border-white/10 bg-[#10233d] px-3 py-2.5 text-sm text-white"><option value="">Select an area</option>{warehouseAreas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select>
              <button type="submit" disabled={pending || !warehouseAreas.length} className="rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{demoPending ? "Saving..." : "Use for demo"}</button>
            </form>
          </div>
          {!warehouseAreas.length && <p className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-sm text-slate-400">No areas yet. Create the first area below.</p>}
          <div className="grid gap-3 md:grid-cols-2">
            {warehouseAreas.map((area) => <div key={area.id} className="rounded-xl border border-white/[0.07] bg-[#10233d] p-4">
              {editingId === area.id ? <form action={updateAction} onSubmit={() => setEditingId(null)} className="space-y-3">
                <input type="hidden" name="areaId" value={area.id} />
                <input name="name" required defaultValue={area.name} disabled={pending} className="w-full rounded-lg border border-white/10 bg-[#0b1d34] px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300" />
                <div className="flex gap-2"><button type="submit" disabled={pending} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white"><Check size={14} />Save</button><button type="button" onClick={() => setEditingId(null)} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300"><X size={14} />Cancel</button></div>
              </form> : <>
                <div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><p className="font-medium text-white">{area.name}</p>{activeAreaId === area.id && <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-300">ACTIVE DEMO</span>}</div><p className="mt-1 text-xs text-slate-500">Status: {stateLabels[area.state] ?? area.state}</p></div><div className="flex gap-1"><button type="button" onClick={() => setEditingId(area.id)} className="rounded-md border border-white/10 p-2 text-slate-300 hover:bg-white/5"><Pencil size={14} /></button><form action={deleteAction}><input type="hidden" name="areaId" value={area.id} /><button type="submit" disabled={pending} className="rounded-md border border-rose-400/20 p-2 text-rose-300 hover:bg-rose-400/10 disabled:opacity-50" title="Delete area"><Trash2 size={14} /></button></form></div></div>
                <form action={stateAction} className="mt-3 flex gap-2"><input type="hidden" name="areaId" value={area.id} /><select name="state" defaultValue={area.state} disabled={pending} className="flex-1 rounded-lg border border-white/10 bg-[#0b1d34] px-3 py-2 text-xs text-white"><option value="locked">Locked</option><option value="unlocked">Unlocked</option><option value="emergency_release">Emergency Release</option></select><button type="submit" disabled={pending} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300">Save</button></form>
              </>}
            </div>)}
          </div>
          <form action={addAction} className="flex flex-wrap gap-2 border-t border-white/[0.07] pt-4"><input type="hidden" name="warehouseId" value={warehouse.id} /><input name="name" required placeholder="New area name" disabled={pending} className="min-w-[220px] flex-1 rounded-lg border border-white/10 bg-[#10233d] px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300" /><button type="submit" disabled={pending} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white"><Plus size={15} />{addPending ? "Adding..." : "Add Area"}</button></form>
        </div>
      </section>;
    })}
    {message && <p className={`rounded-xl border px-4 py-3 text-sm ${success ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200" : "border-rose-400/20 bg-rose-400/10 text-rose-200"}`}>{message}</p>}
  </div>;
}
