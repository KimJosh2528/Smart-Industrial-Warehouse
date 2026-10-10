"use client";

import { useActionState } from "react";
import { createGuard, type CreateStaffState } from "@/app/staff/actions";
import type { StaffWarehouse } from "@/lib/staff-data";

const initialState: CreateStaffState = { success: false, message: "" };

export function AddGuardForm({ warehouses }: { warehouses: StaffWarehouse[] }) {
  const [state, formAction, pending] = useActionState(createGuard, initialState);
  return <form action={formAction} className="rounded-2xl border border-amber-300/15 bg-[#0b1d34] p-5"><div className="mb-4"><h3 className="font-semibold text-white">Add guard</h3><p className="mt-1 text-xs text-slate-500">Create a guard identity. Credentials and account claiming are separate steps.</p></div><div className="grid gap-3 sm:grid-cols-3"><label className="text-xs text-slate-400">Warehouse<select name="warehouseId" defaultValue={warehouses[0]?.id ?? ""} required disabled={pending} className="mt-2 w-full rounded-lg border border-white/10 bg-[#10233d] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-amber-300">{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label><label className="text-xs text-slate-400">Display name<input name="displayName" required disabled={pending} placeholder="e.g. Pedro Santos" className="mt-2 w-full rounded-lg border border-white/10 bg-[#10233d] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-amber-300" /></label><label className="text-xs text-slate-400">Guard code <span className="text-slate-600">(optional)</span><input name="employeeCode" disabled={pending} placeholder="e.g. GRD-001" className="mt-2 w-full rounded-lg border border-white/10 bg-[#10233d] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-amber-300" /></label></div><label className="mt-3 flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" name="isActive" defaultChecked disabled={pending} className="accent-amber-500" /> Active guard</label><button type="submit" disabled={pending || !warehouses.length} className="mt-4 rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-60">{pending ? "Creating..." : "Create guard"}</button>{state.message && <p className={`mt-3 text-xs ${state.success ? "text-emerald-300" : "text-rose-300"}`}>{state.message}</p>}</form>;
}
