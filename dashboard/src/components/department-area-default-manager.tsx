"use client";

import { useActionState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Minus, Plus } from "lucide-react";
import { addDepartmentAreaDefault, removeDepartmentAreaDefault, type DepartmentAreaMutationState } from "@/app/areas/actions";
import type { AreaDepartment, DepartmentAreaDefault, WarehouseArea } from "@/lib/areas-data";

const initialState: DepartmentAreaMutationState = { success: false, message: "" };
const labels: Record<string, string> = {
  truck_entrance: "Truck Entrance",
  staff_entrance: "Staff Entrance",
  staff_room_1: "Room 1 — Server & IT Room",
  staff_room_2: "Room 2 — HR & Personnel Office",
  staff_room_3: "Room 3 — High-Value Inventory Cage",
  staff_room_4: "Room 4 — Manager's Office & Finance Room",
};

export function DepartmentAreaDefaultManager({ departments, areas, defaults }: { departments: AreaDepartment[]; areas: WarehouseArea[]; defaults: DepartmentAreaDefault[] }) {
  const router = useRouter();
  const [addState, addAction, addPending] = useActionState(addDepartmentAreaDefault, initialState);
  const [removeState, removeAction, removePending] = useActionState(removeDepartmentAreaDefault, initialState);
  const pending = addPending || removePending;

  useEffect(() => {
    if (addState.success || removeState.success) router.refresh();
  }, [addState.success, removeState.success, router]);

  return <section className="mt-5 space-y-4 rounded-2xl border border-white/10 bg-[#0b1d34] p-5">
    <div><h2 className="font-semibold text-white">Department associated areas</h2><p className="mt-1 text-xs text-slate-500">Defaults are recommendations only. Staff area permissions remain the actual access authorization.</p></div>
    {!departments.length ? <p className="rounded-lg border border-dashed border-white/10 px-4 py-5 text-sm text-slate-400">No departments configured.</p> : departments.map((department) => <DepartmentRow key={department.id} department={department} areas={areas} defaults={defaults.filter((item) => item.department_id === department.id)} action={removeAction} addAction={addAction} pending={pending} addPending={addPending} />)}
    {(addState.message || removeState.message) && <p className={`text-xs ${addState.success || removeState.success ? "text-emerald-300" : "text-rose-300"}`}>{addState.message || removeState.message}</p>}
  </section>;
}

function DepartmentRow({ department, areas, defaults, action, addAction, pending, addPending }: { department: AreaDepartment; areas: WarehouseArea[]; defaults: DepartmentAreaDefault[]; action: (payload: FormData) => void; addAction: (payload: FormData) => void; pending: boolean; addPending: boolean }) {
  const assignedIds = useMemo(() => new Set(defaults.map((item) => item.area_id)), [defaults]);
  const available = areas.filter((area) => area.warehouse_id === department.warehouse_id && !assignedIds.has(area.id));

  return <div className="rounded-xl border border-white/[0.06] bg-[#10233d] p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-medium text-white">{department.name}</p><p className="mt-1 text-xs text-slate-500">Associated/default areas</p></div><span className="text-[11px] text-slate-500">{defaults.length} associated</span></div>
    {defaults.length > 0 && <div className="mt-3 space-y-1.5">{defaults.map((item) => <div key={item.id} className="flex items-center justify-between gap-2 rounded-md border border-white/[0.06] bg-[#0b1d34] px-2.5 py-2 text-[11px]"><span className="text-slate-300">{areaLabel(item.area_type_code)}</span><form action={action}><input type="hidden" name="departmentId" value={department.id} /><input type="hidden" name="areaId" value={item.area_id} /><button type="submit" disabled={pending} className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-slate-400 hover:bg-white/5 disabled:opacity-50"><Minus size={11} />Remove</button></form></div>)}</div>}
    <form action={addAction} className="mt-3 flex flex-wrap items-center gap-2"><input type="hidden" name="departmentId" value={department.id} /><select name="areaId" required disabled={pending || available.length === 0} defaultValue="" className="min-w-0 flex-1 rounded-md border border-white/10 bg-[#0b1d34] px-2 py-1.5 text-[11px] text-white outline-none focus:border-cyan-300 disabled:opacity-50"><option value="">{available.length ? "Add associated area..." : "All warehouse areas associated"}</option>{available.map((area) => <option key={area.id} value={area.id}>{areaLabel(area.area_type_code)}</option>)}</select><button type="submit" disabled={pending || available.length === 0} className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-blue-500 disabled:opacity-50"><Plus size={12} />{addPending ? "Saving..." : "Add Area"}</button></form>
  </div>;
}

function areaLabel(value: string) { return labels[value] ?? value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
