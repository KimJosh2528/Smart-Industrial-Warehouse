"use client";

import { useActionState, useEffect } from "react";
import { saveStaffAreaPermissions, type StaffPermissionSaveState } from "@/app/staff/actions";
import type { StaffListItem } from "@/lib/staff-data";

const initialState: StaffPermissionSaveState = { success: false, message: "" };

export function StaffPermissionManager({ staff }: { staff: StaffListItem }) {
  const [state, action, pending] = useActionState(saveStaffAreaPermissions, initialState);
  useEffect(() => { if (state.success) window.location.reload(); }, [state.success]);

  const assigned = new Set(staff.permissions.map((permission) => permission.area_id));
const staffEntrances = staff.areas.filter((area) => area.area_type_code === "staff_entrance" && area.entrance_category === "staff_main");

  return <form action={action} className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
    <div className="mb-3 flex items-center justify-between gap-2">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">Doorlock entrances</p>
      <span className="text-[11px] text-slate-500">{staff.permissions.filter((permission) => permission.area_type_code === "staff_entrance").length} selected</span>
    </div>
    <input type="hidden" name="staffMemberId" value={staff.id} />
    {staffEntrances.length === 0 ? <p className="text-[11px] text-slate-500">No staff entrances configured.</p> : <>
      <select name="areaIds" multiple defaultValue={staffEntrances.filter((area) => assigned.has(area.id)).map((area) => area.id)} disabled={pending} className="min-h-32 w-full rounded-md border border-white/10 bg-[#0b1d34] px-2 py-2 text-xs text-white outline-none focus:border-cyan-300 disabled:opacity-50">
        {staffEntrances.map((area) => <option key={area.id} value={area.id}>{labelArea(area.area_type_code)} — {labelArea(area.state)}</option>)}
      </select>
      <p className="mt-2 text-[10px] text-slate-500">Select one or more staff entrances, then press Save.</p>
      <button type="submit" disabled={pending} className="mt-3 rounded-md bg-blue-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-blue-500 disabled:opacity-50">{pending ? "Saving..." : "Save"}</button>
    </>}
    {state.message && <p className={`mt-2 text-[11px] ${state.success ? "text-emerald-300" : "text-rose-300"}`}>{state.message}</p>}
  </form>;
}

function labelArea(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
