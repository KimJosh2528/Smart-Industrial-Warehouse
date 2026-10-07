"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Edit2, Pause, Play, Save, X } from "lucide-react";
import { createDepartment, setDepartmentActive, updateDepartment, type DepartmentMutationState } from "@/app/areas/actions";
import type { AreaDepartment, AreaWarehouse } from "@/lib/areas-data";

const initialState: DepartmentMutationState = { success: false, message: "" };

export function DepartmentManager({ departments, warehouses }: { departments: AreaDepartment[]; warehouses: AreaWarehouse[] }) {
  const router = useRouter();
  const [createState, createAction, createPending] = useActionState(createDepartment, initialState);
  const [updateState, updateAction, updatePending] = useActionState(updateDepartment, initialState);
  const [activeState, activeAction, activePending] = useActionState(setDepartmentActive, initialState);
  const pending = createPending || updatePending || activePending;

  useEffect(() => {
    if (createState.success || updateState.success || activeState.success) router.refresh();
  }, [createState.success, updateState.success, activeState.success, router]);

  return <section className="mt-5 space-y-4 rounded-2xl border border-white/10 bg-[#0b1d34] p-5">
    <div>
      <h2 className="font-semibold text-white">Departments</h2>
      <p className="mt-1 text-xs text-slate-500">Manage the organizational departments for your authorized warehouse.</p>
    </div>

    {warehouses.length > 0 && <form action={createAction} className="grid gap-3 rounded-xl border border-white/[0.06] bg-[#10233d] p-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
      <label className="text-xs text-slate-400">Warehouse<select name="warehouseId" defaultValue={warehouses.find(() => true)?.id ?? ""} required disabled={pending} className="mt-1 w-full rounded-md border border-white/10 bg-[#0b1d34] px-3 py-2 text-sm text-white outline-none focus:border-cyan-300">{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
      <label className="text-xs text-slate-400">Department Name<input name="name" required className="mt-1 w-full rounded-md border border-white/10 bg-[#0b1d34] px-3 py-2 text-sm text-white outline-none focus:border-cyan-300" placeholder="Customs" disabled={pending} /></label>
      <label className="text-xs text-slate-400">Department Code<input name="code" required className="mt-1 w-full rounded-md border border-white/10 bg-[#0b1d34] px-3 py-2 text-sm uppercase text-white outline-none focus:border-cyan-300" placeholder="CUS" disabled={pending} /></label>
      <button type="submit" disabled={pending} className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"><PlusIcon />{createPending ? "Adding..." : "Add department"}</button>
    </form>}

    {(createState.message || updateState.message || activeState.message) && <p className={`text-xs ${createState.success || updateState.success || activeState.success ? "text-emerald-300" : "text-rose-300"}`}>{createState.message || updateState.message || activeState.message}</p>}

    {!departments.length ? <p className="rounded-lg border border-dashed border-white/10 px-4 py-5 text-sm text-slate-400">No departments configured.</p> : <div className="space-y-2">{departments.map((department) => <DepartmentRow key={department.id} department={department} updateAction={updateAction} activeAction={activeAction} pending={pending} />)}</div>}
  </section>;
}

function DepartmentRow({ department, updateAction, activeAction, pending }: { department: AreaDepartment; updateAction: (payload: FormData) => void; activeAction: (payload: FormData) => void; pending: boolean }) {
  const [editing, setEditing] = useState(false);

  if (editing) return <form action={updateAction} className="grid gap-2 rounded-xl border border-cyan-300/20 bg-[#10233d] p-4 md:grid-cols-[1fr_1fr_auto_auto] md:items-end">
    <input type="hidden" name="departmentId" value={department.id} />
    <label className="text-xs text-slate-400">Name<input name="name" defaultValue={department.name} required className="mt-1 w-full rounded-md border border-white/10 bg-[#0b1d34] px-3 py-2 text-sm text-white outline-none focus:border-cyan-300" disabled={pending} /></label>
    <label className="text-xs text-slate-400">Code<input name="code" defaultValue={department.code} required className="mt-1 w-full rounded-md border border-white/10 bg-[#0b1d34] px-3 py-2 text-sm uppercase text-white outline-none focus:border-cyan-300" disabled={pending} /></label>
    <button type="submit" disabled={pending} className="inline-flex items-center justify-center gap-1 rounded-md bg-blue-600 px-3 py-2 text-xs text-white disabled:opacity-50"><Save size={13} />Save</button>
    <button type="button" disabled={pending} onClick={() => setEditing(false)} className="inline-flex items-center justify-center gap-1 rounded-md border border-white/10 px-3 py-2 text-xs text-slate-300 disabled:opacity-50"><X size={13} />Cancel</button>
  </form>;

  return <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-[#10233d] p-4">
    <div><p className="text-sm font-medium text-white">{department.name}</p><p className="mt-1 text-xs text-slate-500">Code: {department.code}</p></div>
    <div className="flex flex-wrap items-center gap-2"><span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] ${department.is_active ? "bg-emerald-400/10 text-emerald-300" : "bg-slate-400/10 text-slate-400"}`}>{department.is_active ? <Check size={12} /> : <Pause size={12} />}{department.is_active ? "Active" : "Inactive"}</span><button type="button" disabled={pending} onClick={() => setEditing(true)} className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50"><Edit2 size={12} />Edit</button><form action={activeAction}><input type="hidden" name="departmentId" value={department.id} /><input type="hidden" name="isActive" value={String(!department.is_active)} /><button type="submit" disabled={pending} className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50">{department.is_active ? <Pause size={12} /> : <Play size={12} />}{department.is_active ? "Deactivate" : "Activate"}</button></form></div>
  </div>;
}

function PlusIcon() { return <span aria-hidden="true" className="text-base leading-none">+</span>; }
