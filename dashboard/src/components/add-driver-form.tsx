"use client";

import { useActionState, useState } from "react";
import { createDriver, type CreateDriverState } from "@/app/drivers/actions";
import type { DriverWarehouse } from "@/lib/drivers-data";

const initialState: CreateDriverState = { success: false, message: "" };

export function AddDriverForm({ warehouses }: { warehouses: DriverWarehouse[] }) {
  const [state, formAction, pending] = useActionState(createDriver, initialState);
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "");

  return <form action={formAction} className="rounded-2xl border border-cyan-300/15 bg-[#0b1d34] p-5">
    <div className="mb-4">
      <h3 className="font-semibold text-white">Add driver</h3>
      <p className="mt-1 text-xs text-slate-500">Create a driver identity. Truck assignment and account claiming are separate steps.</p>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs text-slate-400">Warehouse<select name="warehouseId" value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} className="mt-2 w-full rounded-lg border border-white/10 bg-[#10233d] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-cyan-300" required disabled={pending}>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
      <label className="text-xs text-slate-400">Display name<input name="displayName" required disabled={pending} className="mt-2 w-full rounded-lg border border-white/10 bg-[#10233d] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-cyan-300" placeholder="e.g. Juan Dela Cruz" /></label>
      <label className="text-xs text-slate-400">Driver code <span className="text-slate-600">(optional)</span><input name="driverCode" disabled={pending} className="mt-2 w-full rounded-lg border border-white/10 bg-[#10233d] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-cyan-300" placeholder="e.g. DRV-001" /></label>
    </div>
    <label className="mt-3 flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" name="isActive" defaultChecked disabled={pending} className="accent-cyan-500" /> Active driver</label>
    <button type="submit" disabled={pending || !warehouses.length} className="mt-4 rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-cyan-500 disabled:cursor-wait disabled:opacity-60">{pending ? "Creating..." : "Create driver"}</button>
    {state.success && <p className="mt-3 text-xs text-emerald-300">{state.message}</p>}
    {!state.success && state.message && <p className="mt-3 text-xs text-rose-300">{state.message}</p>}
  </form>;
}
