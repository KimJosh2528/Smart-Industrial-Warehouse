"use client";

import { useActionState, useEffect } from "react";
import { saveStaffAreaPermissions, type StaffPermissionSaveState } from "@/app/staff/actions";
import type { StaffListItem } from "@/lib/staff-data";

const initialState: StaffPermissionSaveState = { success: false, message: "" };

export function StaffPermissionInlineManager({ staff }: { staff: StaffListItem }) {
  const [state, action, pending] = useActionState(saveStaffAreaPermissions, initialState);
  useEffect(() => { if (state.success) window.location.reload(); }, [state.success]);

const staffEntrances = staff.areas.filter((area) => area.area_type_code === "staff_entrance" && area.entrance_category === "staff_main");
  const assigned = new Set(staff.permissions.map((permission) => permission.area_id));
  const selectedCount = staffEntrances.filter((area) => assigned.has(area.id)).length;

  return <form action={action} className="relative">
    <input type="hidden" name="staffMemberId" value={staff.id} />
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-1 rounded-full bg-cyan-500/15 px-2.5 py-1 text-cyan-200">
        <span>{selectedCount} permission{selectedCount === 1 ? "" : "s"}</span><span className="text-cyan-300/70">⌄</span>
      </summary>
      <div className="absolute right-0 top-full z-30 mt-2 w-72 rounded-lg border border-cyan-300/20 bg-[#08172b] p-3 shadow-2xl shadow-black/40">
        {staff.applicant_email && <p className="mb-2 text-[11px] text-slate-400">{staff.applicant_email}</p>}
        {staff.facebook_profile_url && <a href={staff.facebook_profile_url} target="_blank" rel="noreferrer" className="mb-2 block text-xs text-cyan-300 underline hover:text-cyan-200">Open Facebook profile</a>}
        <p className="mb-2 text-[10px] uppercase tracking-[0.12em] text-slate-500">Staff entrances</p>
        {staffEntrances.length ? <div className="max-h-48 space-y-1 overflow-y-auto">
          {staffEntrances.map((area) => <label key={area.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-slate-300 hover:bg-white/[0.05]">
            <input type="checkbox" name="areaIds" value={area.id} defaultChecked={assigned.has(area.id)} className="accent-cyan-400" />
            <span>{area.name ?? labelArea(area.area_type_code)}</span>
          </label>)}
        </div> : <p className="text-xs text-slate-500">No staff entrances configured.</p>}
        <button type="submit" disabled={pending || !staffEntrances.length} className="mt-3 rounded-md bg-blue-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-blue-500 disabled:opacity-50">{pending ? "Saving..." : "Save permissions"}</button>
        {state.message && <p className={`mt-2 text-[11px] ${state.success ? "text-emerald-300" : "text-rose-300"}`}>{state.message}</p>}
      </div>
    </details>
  </form>;
}

function labelArea(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
