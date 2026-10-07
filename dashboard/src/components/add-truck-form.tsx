"use client";

import { useActionState } from "react";
import { createTruck, type TruckMutationState } from "@/app/trucks/actions";
import type { TruckWarehouse } from "@/lib/trucks-data";

const initial: TruckMutationState = { success: false, message: "" };

export function AddTruckForm({ warehouses }: { warehouses: TruckWarehouse[] }) {
  const [state, formAction, pending] = useActionState(createTruck, initial);
  return <form action={formAction} className="rounded-2xl border border-orange-300/15 bg-[#0b1d34] p-5">
    <div className="mb-4"><h3 className="font-semibold text-white">Add truck</h3><p className="mt-1 text-xs text-slate-500">Register vehicle identity and division. Credentials and driver assignment are managed separately.</p></div>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs text-slate-400">Warehouse<select name="warehouseId" defaultValue={warehouses.find(() => true)?.id ?? ""} required disabled={pending} className="mt-2 w-full rounded-lg border border-white/10 bg-[#10233d] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-cyan-300">{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
      <label className="text-xs text-slate-400">Identity label<input name="identityLabel" required disabled={pending} className="mt-2 w-full rounded-lg border border-white/10 bg-[#10233d] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-cyan-300" placeholder="e.g. Receiving Truck 01" /></label>
      <label className="text-xs text-slate-400">Plate number<input name="plateNumber" required disabled={pending} className="mt-2 w-full rounded-lg border border-white/10 bg-[#10233d] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-cyan-300" placeholder="e.g. ABC-1234" /></label>
      <label className="text-xs text-slate-400">Division<select name="division" defaultValue="" disabled={pending} className="mt-2 w-full rounded-lg border border-white/10 bg-[#10233d] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-cyan-300"><option value="">Not Assigned</option><option value="RECEIVING_INCOMING">Receiving / Incoming</option><option value="PICKING_STAGING_OUTGOING">Picking &amp; Staging / Outgoing</option></select></label>
    </div>
    <label className="mt-3 flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" name="isActive" defaultChecked disabled={pending} className="accent-orange-500" /> Active truck</label>
    <button type="submit" disabled={pending || !warehouses.length} className="mt-4 rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-orange-500 disabled:cursor-wait disabled:opacity-60">{pending ? "Creating..." : "Create truck"}</button>
    {state.message && <p className={`mt-3 text-xs ${state.success ? "text-emerald-300" : "text-rose-300"}`}>{state.message}</p>}
  </form>;
}
