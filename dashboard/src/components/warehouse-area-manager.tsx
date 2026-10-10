"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { addWarehouseArea, deleteWarehouseArea, type AreaMutationState } from "@/app/areas/actions";
import type { AreaWarehouse, WarehouseArea, WarehouseAreaType } from "@/lib/areas-data";

const initialState: AreaMutationState = { success: false, message: "" };
const labels: Record<string, string> = { truck_entrance: "Truck Entrance", staff_entrance: "Staff Main Entrance", room: "Roll Yard" };

export function WarehouseAreaManager({ warehouses, types, areas }: { warehouses: AreaWarehouse[]; types: WarehouseAreaType[]; areas: WarehouseArea[] }) {
  const router = useRouter();
  const [addState, addAction, addPending] = useActionState(addWarehouseArea, initialState);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteWarehouseArea, initialState);
  const pending = addPending || deletePending;
  useEffect(() => { if (addState.success || deleteState.success) router.refresh(); }, [addState, deleteState, router]);
  const areasByWarehouse = new Map<string, WarehouseArea[]>();
  for (const area of areas) {
    if (area.area_type_code !== "room" && area.entrance_category !== "staff_main" && area.entrance_category !== "truck_main") continue;
    areasByWarehouse.set(area.warehouse_id, [...(areasByWarehouse.get(area.warehouse_id) ?? []), area]);
  }
  return <div className="space-y-5">{warehouses.map((warehouse) => { const warehouseAreas = areasByWarehouse.get(warehouse.id) ?? []; const hasType = (code: string) => types.some((type) => type.code === code); return <section key={warehouse.id} className="overflow-hidden rounded-2xl border border-white/10 bg-[#0b1d34]"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-4"><div><h2 className="font-semibold text-white">{warehouse.name}</h2><p className="mt-1 text-xs text-slate-500">{warehouseAreas.length} configured area{warehouseAreas.length === 1 ? "" : "s"}</p></div><span className="rounded-full bg-cyan-400/10 px-2.5 py-1 text-[11px] text-cyan-200">Demo scope</span></div><div className="space-y-3 p-5">{!warehouseAreas.length && <p className="rounded-lg border border-dashed border-white/10 px-4 py-5 text-sm text-slate-400">No warehouse areas configured.</p>}{warehouseAreas.map((area) => <AreaRow key={`${area.id}-${area.state}`} area={area} deleteAction={deleteAction} pending={pending} />)}<div className="grid gap-3 border-t border-white/[0.07] pt-4 lg:grid-cols-3"><CreateCard title="Staff Main Entrance" description="One RFID doorlock." tone="cyan" action={addAction} warehouseId={warehouse.id} type="staff_entrance" hasType={hasType("staff_entrance")} pending={pending} label="Add Staff Main Entrance" /><CreateCard title="Truck Entrance" description="One plate camera gate." tone="amber" action={addAction} warehouseId={warehouse.id} type="truck_entrance" hasType={hasType("truck_entrance")} pending={pending} label="Add Truck Entrance" /><CreateCard title="Roll Yard" description="One sensor room." tone="violet" action={addAction} warehouseId={warehouse.id} type="room" hasType={hasType("room")} pending={pending} label="Add Roll Yard" /></div></div></section>; })}{(addState.message || deleteState.message) && <p className={`rounded-xl border px-4 py-3 text-sm ${addState.success || deleteState.success ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200" : "border-rose-400/20 bg-rose-400/10 text-rose-200"}`}>{addState.message || deleteState.message}</p>}</div>;
}

function AreaRow({ area, deleteAction, pending }: { area: WarehouseArea; deleteAction: (payload: FormData) => void; pending: boolean }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-[#10233d] px-4 py-3"><div><p className="text-sm font-medium text-white">{area.name}</p><p className="mt-1 text-xs text-slate-500">{labels[area.area_type_code] ?? area.area_type_code} · IoT controls status</p></div><div className="flex items-center gap-2"><span className="rounded-full border border-cyan-300/15 bg-cyan-400/[0.06] px-2.5 py-1.5 text-[11px] text-cyan-200">IoT controlled</span><form action={deleteAction} onSubmit={(event) => { if (!window.confirm(`Delete ${area.name}?`)) event.preventDefault(); }}><input type="hidden" name="areaId" value={area.id} /><button type="submit" disabled={pending} className="inline-flex items-center gap-1 rounded-md border border-rose-300/20 px-2.5 py-2 text-xs text-rose-200 hover:bg-rose-400/10 disabled:opacity-50"><Trash2 size={13} />Delete</button></form></div></div>;
}

function CreateCard({ title, description, tone, action, warehouseId, type, hasType, pending, label }: { title: string; description: string; tone: "cyan" | "amber" | "violet"; action: (payload: FormData) => void; warehouseId: string; type: string; hasType: boolean; pending: boolean; label: string }) {
  const border = tone === "cyan" ? "border-cyan-300/10 bg-cyan-400/[0.04]" : tone === "amber" ? "border-amber-300/10 bg-amber-400/[0.04]" : "border-violet-300/10 bg-violet-400/[0.04]";
  return <div className={`flex min-h-[180px] flex-col rounded-xl border p-4 ${border}`}><p className="text-sm font-semibold text-white">{title}</p><p className="mt-1 text-xs leading-5 text-slate-500">{description}</p><form action={action} className="mt-auto"><input type="hidden" name="warehouseId" value={warehouseId} /><input type="hidden" name="areaTypeCode" value={type} />{type === "room" && <input type="hidden" name="name" value="Roll Yard" />}<button type="submit" disabled={pending || !hasType} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"><Plus size={15} />{pending ? "Adding..." : label}</button></form></div>;
}
