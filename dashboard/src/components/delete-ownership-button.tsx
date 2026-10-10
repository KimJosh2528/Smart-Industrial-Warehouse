"use client";

import { useActionState, useState } from "react";
import type { DeleteOwnershipState } from "@/app/admin/system-admins/actions";

const initial: DeleteOwnershipState = { success: false, message: "" };

export function DeleteOwnershipButton({ warehouseId, action }: { warehouseId: string; action: (previous: DeleteOwnershipState, formData: FormData) => Promise<DeleteOwnershipState> }) {
  const [open, setOpen] = useState(false);
  const [state, submit, pending] = useActionState(action, initial);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="rounded-lg border border-rose-300/30 px-3 py-2 text-xs font-medium text-rose-200 hover:bg-rose-400/10">Delete ownership</button>;
  return <div className="w-full rounded-xl border border-rose-300/30 bg-rose-950/20 p-3 text-sm">
    <p className="font-semibold text-rose-100">Are you sure you want to delete this ownership?</p>
    <p className="mt-1 text-xs text-rose-200/80">The warehouse, device assignment, application, and System Admin account will be removed.</p>
    <form action={submit} className="mt-3 space-y-2">
      <input type="hidden" name="warehouseId" value={warehouseId} />
      <textarea name="reason" required minLength={3} maxLength={500} placeholder="Reason for deletion" className="w-full rounded-lg border border-rose-300/20 bg-[#0b1d34] px-3 py-2 text-xs text-white" />
      <div className="flex gap-2"><button type="button" onClick={() => setOpen(false)} disabled={pending} className="rounded-lg border border-white/15 px-3 py-2 text-xs text-slate-300">Cancel</button><button type="submit" disabled={pending} className="rounded-lg bg-rose-500/80 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{pending ? "Deleting..." : "OK, delete"}</button></div>
      {state.message && <p className="text-xs text-rose-200">{state.message}</p>}
    </form>
  </div>;
}
