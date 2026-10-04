"use client";

import { useActionState } from "react";
import { setTruckActive, updateTruck, type TruckMutationState } from "@/app/trucks/actions";
import type { TruckListItem } from "@/lib/trucks-data";

const initial: TruckMutationState = { success: false, message: "" };

export function TruckEditor({ truck }: { truck: TruckListItem }) {
  const [state, formAction, pending] = useActionState(updateTruck, initial);
  const [statusState, statusAction, statusPending] = useActionState(setTruckActive, initial);
  return <div className="mt-4 grid gap-3 rounded-xl border border-white/[0.06] bg-white/[0.025] p-4 lg:grid-cols-[1fr_auto]">
    <form action={formAction} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="truckId" value={truck.id} />
      <label className="text-xs text-slate-400">Identity label<input name="identityLabel" defaultValue={truck.identity_label} required disabled={pending} className="mt-2 w-full rounded-lg border border-white/10 bg-[#10233d] px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-300" /></label>
      <label className="text-xs text-slate-400">Plate number <span className="text-slate-600">(registered identity)</span><input name="plateNumber" value={truck.plate_number} readOnly className="mt-2 w-full rounded-lg border border-white/10 bg-[#10233d]/60 px-3 py-2 text-sm text-slate-500 outline-none" /></label>
      <label className="text-xs text-slate-400">Division<select name="division" defaultValue={truck.division ?? ""} disabled={pending} className="mt-2 w-full rounded-lg border border-white/10 bg-[#10233d] px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-300"><option value="">Not Assigned</option><option value="RECEIVING_INCOMING">Receiving / Incoming</option><option value="PICKING_STAGING_OUTGOING">Picking &amp; Staging / Outgoing</option></select></label>
      <label className="flex items-end gap-2 pb-2 text-xs text-slate-300"><input type="checkbox" name="isActive" defaultChecked={truck.is_active} disabled={pending} className="accent-orange-500" /> Active truck</label>
      <div className="sm:col-span-2"><button type="submit" disabled={pending} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-60">{pending ? "Saving..." : "Save truck"}</button>{state.message && <p className={`mt-2 text-xs ${state.success ? "text-emerald-300" : "text-rose-300"}`}>{state.message}</p>}</div>
    </form>
    <form action={statusAction} className="flex items-start lg:justify-end"><input type="hidden" name="truckId" value={truck.id} /><input type="hidden" name="isActive" value={String(!truck.is_active)} /><button type="submit" disabled={statusPending} className={`rounded-lg border px-3 py-2 text-xs ${truck.is_active ? "border-rose-300/20 text-rose-200 hover:bg-rose-400/10" : "border-emerald-300/20 text-emerald-200 hover:bg-emerald-400/10"}`}>{statusPending ? "Saving..." : truck.is_active ? "Deactivate" : "Activate"}</button>{statusState.message && <p className={`ml-2 text-xs ${statusState.success ? "text-emerald-300" : "text-rose-300"}`}>{statusState.message}</p>}</form>
  </div>;
}
