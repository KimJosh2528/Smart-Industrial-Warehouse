"use client";

import { useActionState } from "react";
import { assignStaffDepartment, type DepartmentAssignmentState } from "@/app/staff/actions";
import type { StaffListItem } from "@/lib/staff-data";

const initialState: DepartmentAssignmentState = { success: false, message: "" };

export function StaffDepartmentManager({ staff }: { staff: StaffListItem }) {
  const [state, action, pending] = useActionState(assignStaffDepartment, initialState);

  return <form action={action} className="space-y-2">
    <select name="departmentId" defaultValue={staff.department_id ?? ""} disabled={pending} className="w-full rounded-md border border-white/10 bg-[#0b1d34] px-2 py-1.5 text-[11px] text-white outline-none focus:border-cyan-300">
      <option value="">Unassigned</option>
      {staff.departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
    </select>
    <input type="hidden" name="staffMemberId" value={staff.id} />
    <button type="submit" disabled={pending} className="rounded-md border border-white/10 px-2 py-1.5 text-[11px] text-slate-300 hover:bg-white/5 disabled:opacity-50">
      {pending ? "Saving..." : "Save"}
    </button>
    {state.message && <p className={`text-[11px] ${state.success ? "text-emerald-300" : "text-rose-300"}`}>{state.message}</p>}
  </form>;
}
