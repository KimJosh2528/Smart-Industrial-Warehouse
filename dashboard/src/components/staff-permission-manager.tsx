"use client";

import { useActionState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Check, Minus } from "lucide-react";
import { grantStaffAreaPermission, revokeStaffAreaPermission, type StaffPermissionMutationState } from "@/app/staff/actions";
import type { StaffListItem, StaffPermission } from "@/lib/staff-data";

const initialState: StaffPermissionMutationState = { success: false, message: "" };

export function StaffPermissionManager({ staff }: { staff: StaffListItem }) {
  const router = useRouter();
  const [grantState, grantAction, grantPending] = useActionState(grantStaffAreaPermission, initialState);
  const [revokeState, revokeAction, revokePending] = useActionState(revokeStaffAreaPermission, initialState);
  const pending = grantPending || revokePending;

  useEffect(() => {
    if (grantState.success || revokeState.success) router.refresh();
  }, [grantState, revokeState, router]);

  const assignedAreaIds = useMemo(() => new Set(staff.permissions.map((permission) => permission.area_id)), [staff.permissions]);
  const availableAreas = staff.areas.filter((area) => !assignedAreaIds.has(area.id));
  const message = grantState.message || revokeState.message;
  const success = grantState.success || revokeState.success;

  return <div className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
    <div className="mb-3 flex items-center justify-between gap-2">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">Area permissions</p>
      <span className="text-[11px] text-slate-500">{staff.permissions.length} assigned</span>
    </div>

    {staff.areas.length === 0 ? <p className="text-[11px] text-slate-500">No warehouse areas configured.</p> : <>
      {staff.permissions.length > 0 && <div className="space-y-1.5">{staff.permissions.map((permission) => <AssignedPermission key={permission.id} staff={staff} permission={permission} action={revokeAction} pending={pending} />)}</div>}
      <form action={grantAction} className="mt-3 flex items-center gap-2">
        <input type="hidden" name="staffMemberId" value={staff.id} />
        <select name="areaId" required disabled={pending || availableAreas.length === 0} defaultValue="" className="min-w-0 flex-1 rounded-md border border-white/10 bg-[#0b1d34] px-2 py-1.5 text-[11px] text-white outline-none focus:border-cyan-300 disabled:opacity-50">
          <option value="">{availableAreas.length ? "Grant an area..." : "All areas assigned"}</option>
          {availableAreas.map((area) => <option key={area.id} value={area.id}>{labelArea(area.area_type_code)} ({labelArea(area.state)})</option>)}
        </select>
        <button type="submit" disabled={pending || availableAreas.length === 0} className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-blue-500 disabled:opacity-50"><Check size={12} />{grantPending ? "Granting..." : "Grant"}</button>
      </form>
    </>}
    {message && <p className={`mt-2 text-[11px] ${success ? "text-emerald-300" : "text-rose-300"}`}>{message}</p>}
  </div>;
}

function AssignedPermission({ staff, permission, action, pending }: { staff: StaffListItem; permission: StaffPermission; action: (payload: FormData) => void; pending: boolean }) {
  return <div className="flex items-center justify-between gap-2 rounded-md border border-white/[0.06] bg-[#10233d] px-2.5 py-2 text-[11px]">
    <span className="text-slate-300">{labelArea(permission.area_type_code)} <span className="text-slate-600">({labelArea(permission.area_state)})</span></span>
    <form action={action}>
      <input type="hidden" name="staffMemberId" value={staff.id} />
      <input type="hidden" name="areaId" value={permission.area_id} />
      <button type="submit" disabled={pending} className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-slate-400 hover:bg-white/5 disabled:opacity-50"><Minus size={11} />Revoke</button>
    </form>
  </div>;
}

function labelArea(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
