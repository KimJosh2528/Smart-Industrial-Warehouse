"use client";

import { useActionState, useState } from "react";
import type { SystemAdminApplicationActionState } from "@/app/admin/system-admins/actions";

type Application = {
  id: string;
  applicant_name: string;
  applicant_email: string;
  valid_id_url: string;
  facebook_profile_url: string;
  status: string;
  rejection_reason: string | null;
  created_at: string;
  warehouse_id: string | null;
  assigned_device_id?: string | null;
  assigned_device_name?: string | null;
  device_assignment_status?: string | null;
};
type AvailableDevice = { id: string; name: string; device_type: string; serial_number: string | null; lifecycle_status: string };

const initial: SystemAdminApplicationActionState = { success: false, message: "" };

export function SystemAdminApplicationReview({
  application,
  devices,
  approve,
  reject,
  reserveDevice,
  regenerateLink,
}: {
  application: Application;
  devices: AvailableDevice[];
  approve: (previous: SystemAdminApplicationActionState, formData: FormData) => Promise<SystemAdminApplicationActionState>;
  reject: (previous: SystemAdminApplicationActionState, formData: FormData) => Promise<SystemAdminApplicationActionState>;
  reserveDevice: (formData: FormData) => void;
  regenerateLink: (previous: SystemAdminApplicationActionState, formData: FormData) => Promise<SystemAdminApplicationActionState>;
}) {
  const [approveState, approveAction, approving] = useActionState(approve, initial);
  const [rejectState, rejectAction, rejecting] = useActionState(reject, initial);
  const [regenerateState, regenerateAction, regenerating] = useActionState(regenerateLink, initial);
  const [copied, setCopied] = useState(false);
  const link = regenerateState.registrationLink ?? approveState.registrationLink;
  const hasAssignedDevice = Boolean(application.assigned_device_id && ["reserved", "linked"].includes(application.device_assignment_status ?? ""));

  return <article className="rounded-xl border border-white/10 bg-[#10233d] p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="font-medium text-white">{application.applicant_name}</h3>
        <p className="text-xs text-slate-400">{application.applicant_email}</p>
        <p className="mt-1 text-xs text-slate-500">Submitted: <time dateTime={application.created_at}>{application.created_at}</time></p>
      </div>
      <span className="rounded-full bg-amber-400/10 px-2 py-1 text-[11px] text-amber-200">{application.status}</span>
    </div>
    <div className="mt-3 flex flex-wrap gap-3 text-xs">
      <a className="text-cyan-300 hover:text-cyan-200" href={application.valid_id_url} target="_blank" rel="noreferrer">View valid ID link</a>
      <a className="text-cyan-300 hover:text-cyan-200" href={application.facebook_profile_url} target="_blank" rel="noreferrer">View Facebook profile</a>
    </div>
    {application.status === "pending" && <div className="mt-4 flex flex-wrap items-end gap-2">
      <form action={approveAction}>
        <input type="hidden" name="applicationId" value={application.id} />
        <button disabled={approving || rejecting} className="rounded-lg bg-emerald-500/15 px-3 py-2 text-xs font-medium text-emerald-200 disabled:opacity-50">{approving ? "Approving..." : "Approve and create claim"}</button>
      </form>
      <form action={rejectAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="applicationId" value={application.id} />
        <label className="text-xs text-slate-400">Rejection reason<input name="reason" maxLength={500} placeholder="Optional reason" className="mt-1 block w-56 rounded-lg border border-white/10 bg-[#0b1d34] px-3 py-2 text-xs text-white outline-none focus:border-cyan-300" /></label>
        <button disabled={approving || rejecting} className="rounded-lg bg-rose-500/15 px-3 py-2 text-xs font-medium text-rose-200 disabled:opacity-50">{rejecting ? "Rejecting..." : "Reject"}</button>
      </form>
    </div>}
    {application.rejection_reason && <p className="mt-3 text-xs text-rose-200">Rejection reason: {application.rejection_reason}</p>}
    {(approveState.message || rejectState.message) && <p className="mt-3 text-xs text-slate-300">{approveState.message || rejectState.message}</p>}
    {application.status === "approved" && !application.warehouse_id && !hasAssignedDevice && <p className="mt-4 rounded-lg border border-amber-300/10 bg-amber-400/5 px-3 py-2 text-xs text-amber-200/80">Assign a device first. The claim link will appear here after assignment.</p>}
    {application.status === "approved" && !application.warehouse_id && hasAssignedDevice && <div className="mt-4 rounded-lg border border-cyan-300/10 bg-cyan-400/5 p-3"><p className="text-xs text-slate-300">Assigned device: <strong className="text-white">{application.assigned_device_name ?? "Device"}</strong></p><div className="mt-3 flex flex-wrap items-center gap-2">{link && <button type="button" onClick={async () => { await navigator.clipboard.writeText(link); setCopied(true); }} className="rounded border border-cyan-300/30 px-2.5 py-1.5 text-xs text-cyan-200">{copied ? "Copied" : "Copy claim link"}</button>}<form action={regenerateAction}><input type="hidden" name="applicationId" value={application.id} /><button disabled={regenerating} className="rounded border border-amber-300/30 px-2.5 py-1.5 text-xs text-amber-200 disabled:opacity-50">{regenerating ? "Generating..." : link ? "Regenerate link" : "Generate claim link"}</button></form></div>{regenerateState.message && <p className="mt-2 text-xs text-slate-300">{regenerateState.message}</p>}</div>}
    {application.status === "approved" && !application.warehouse_id && <form action={reserveDevice} className="mt-4 flex flex-wrap items-end gap-2"><input type="hidden" name="applicationId" value={application.id} /><label className="text-xs text-slate-400">Assign device to <strong className="text-white">{application.applicant_name}</strong><select name="deviceId" required className="mt-1 block min-w-64 rounded-lg border border-white/10 bg-[#0b1d34] px-3 py-2 text-xs text-white"><option value="">Select vacant device</option>{devices.map((device) => <option key={device.id} value={device.id}>{device.name} · {device.device_type}{device.serial_number ? ` · ${device.serial_number}` : ""}</option>)}</select></label><button className="rounded-lg bg-cyan-500/20 px-3 py-2 text-xs font-medium text-cyan-100 disabled:opacity-50">Assign device</button></form>}
    {application.status === "approved" && application.warehouse_id && <p className="mt-4 rounded-lg bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200">Ownership confirmed for <strong>{application.applicant_name}</strong>.</p>}
  </article>;
}
