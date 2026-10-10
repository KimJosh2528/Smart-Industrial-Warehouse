"use client";

import { useActionState } from "react";
import { createTruck, type TruckMutationState } from "@/app/trucks/actions";

const initial: TruckMutationState = { success: false, message: "" };

export function AddTruckFormClient({ warehouseName }: { warehouseName: string | null }) {
  const [state, formAction, pending] = useActionState(createTruck, initial);
  return <form action={formAction} className="rounded-2xl border border-orange-300/15 bg-[#0b1d34] p-5">
    <div className="mb-4"><h3 className="font-semibold text-white">Add truck</h3><p className="mt-1 text-xs text-slate-500">Register the truck identity and plate. The truck entrance uses plate authentication only.</p></div>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs text-slate-400">Identity label<input name="identityLabel" required disabled={pending} className="mt-2 w-full rounded-lg border border-white/10 bg-[#10233d] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-cyan-300" placeholder="e.g. Receiving Truck 01" /></label>
      <label className="text-xs text-slate-400">Plate number<input name="plateNumber" required disabled={pending} className="mt-2 w-full rounded-lg border border-white/10 bg-[#10233d] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-cyan-300" placeholder="e.g. ABC-1234" /></label>
    </div>
    <p className="mt-3 text-xs text-slate-500">Warehouse: <span className="text-slate-300">{warehouseName ?? "Current authorized warehouse"}</span></p>
    <button type="submit" disabled={pending} className="mt-4 rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-orange-500 disabled:cursor-wait disabled:opacity-60">{pending ? "Creating..." : "Create truck"}</button>
    {state.message && <p className={`mt-3 text-xs ${state.success ? "text-emerald-300" : "text-rose-300"}`}>{state.message}</p>}
  </form>;
}
