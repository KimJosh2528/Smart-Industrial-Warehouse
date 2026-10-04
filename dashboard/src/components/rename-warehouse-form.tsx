"use client";

import { useActionState } from "react";
import type { RenameWarehouseState } from "@/app/warehouse/actions";

export function RenameWarehouseForm({
  warehouseId,
  currentName,
  action,
}: {
  warehouseId: string;
  currentName: string;
  action: (state: RenameWarehouseState, formData: FormData) => Promise<RenameWarehouseState>;
}) {
  const [state, formAction, pending] = useActionState(action, { success: false, error: null });

  return <form action={formAction} className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.035] p-3">
    <p className="text-[11px] text-slate-400">Rename assigned warehouse</p>
    <input type="hidden" name="warehouseId" value={warehouseId} />
    <input name="newName" defaultValue={currentName} required className="mt-2 w-full rounded-lg border border-white/[0.06] bg-[#10233d] px-2 py-2 text-xs text-slate-200 outline-none focus:border-cyan-300" />
    <button type="submit" disabled={pending} className="mt-2 w-full rounded-lg bg-blue-600 px-2 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-wait disabled:opacity-60">{pending ? "Saving..." : "Save name"}</button>
    {state.success && <p className="mt-2 text-[11px] text-emerald-300">Warehouse name updated.</p>}
    {state.error && <p className="mt-2 text-[11px] text-rose-300">{state.error}</p>}
  </form>;
}
