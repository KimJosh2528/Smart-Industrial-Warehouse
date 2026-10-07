"use client";

import { useActionState, useMemo, useState } from "react";
import { createStaff } from "@/app/staff/actions";
import type { CreateStaffState } from "@/app/staff/actions";
import type { StaffDepartment, StaffWarehouse } from "@/lib/staff-data";

const initialState: CreateStaffState = { success: false, message: "" };

export function AddStaffForm({ warehouses, departments }: { warehouses: StaffWarehouse[]; departments: Record<string, StaffDepartment[]> }) {
  const [state, formAction, pending] = useActionState(createStaffAction, initialState);
  const [warehouseId, setWarehouseId] = useState(warehouses.find(() => true)?.id ?? "");
  const availableDepartments = useMemo(() => departments[warehouseId] ?? [], [departments, warehouseId]);

  return <form action={formAction} className="rounded-2xl border border-blue-300/15 bg-[#0b1d34] p-5">
    <div className="mb-4">
      <h3 className="font-semibold text-white">Add staff member</h3>
      <p className="mt-1 text-xs text-slate-500">Create an unclaimed staff identity. Credentials and account claiming are managed separately.</p>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs text-slate-400">Warehouse<select name="warehouseId" value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} className="mt-2 w-full rounded-lg border border-white/10 bg-[#10233d] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-cyan-300" required disabled={pending}>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
      <label className="text-xs text-slate-400">Display name<input name="displayName" required disabled={pending} className="mt-2 w-full rounded-lg border border-white/10 bg-[#10233d] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-cyan-300" placeholder="e.g. Maria Santos" /></label>
      <label className="text-xs text-slate-400">Employee code <span className="text-slate-600">(optional)</span><input name="employeeCode" disabled={pending} className="mt-2 w-full rounded-lg border border-white/10 bg-[#10233d] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-cyan-300" placeholder="e.g. EMP-001" /></label>
      <label className="text-xs text-slate-400">Department <span className="text-slate-600">(optional)</span><select name="departmentId" defaultValue="" disabled={pending || !availableDepartments.length} className="mt-2 w-full rounded-lg border border-white/10 bg-[#10233d] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-cyan-300"><option value="">Unassigned</option>{availableDepartments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
    </div>
    <label className="mt-3 flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" name="isActive" defaultChecked disabled={pending} className="accent-blue-500" /> Active staff member</label>
    <button type="submit" disabled={pending || !warehouses.length} className="mt-4 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-wait disabled:opacity-60">{pending ? "Creating..." : "Create staff member"}</button>
    {state.success && <p className="mt-3 text-xs text-emerald-300">{state.message}</p>}
    {!state.success && state.message && <p className="mt-3 text-xs text-rose-300">{state.message}</p>}
  </form>;
}

const createStaffAction = createStaff;
