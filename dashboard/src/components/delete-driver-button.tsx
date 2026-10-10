"use client";

import { useActionState } from "react";
import { Trash2 } from "lucide-react";
import { deleteDriverRecord, type DeleteDriverState } from "@/app/drivers/actions";

const initial: DeleteDriverState = { success: false, message: "" };

export function DeleteDriverButton({ driverId }: { driverId: string }) {
  const [state, action, pending] = useActionState(deleteDriverRecord, initial);
  return <div><form action={action} onSubmit={(event) => { if (!window.confirm("Delete this driver record? The paired truck will remain registered and become unassigned.")) event.preventDefault(); }}><input type="hidden" name="driverId" value={driverId} /><button type="submit" disabled={pending} className="inline-flex items-center gap-1 rounded-md border border-rose-300/20 px-2 py-1.5 text-[11px] text-rose-200 hover:bg-rose-400/10 disabled:opacity-60"><Trash2 size={12} />{pending ? "Deleting..." : "Delete record"}</button></form>{state.message && <p className={`mt-2 text-[11px] ${state.success ? "text-emerald-300" : "text-rose-300"}`}>{state.message}</p>}</div>;
}
