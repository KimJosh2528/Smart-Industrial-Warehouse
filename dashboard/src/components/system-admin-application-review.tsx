"use client";

import { useActionState, useState } from "react";
import type { SystemAdminApplicationActionState } from "@/app/admin/system-admins/actions";

type Application = { id: string; applicant_name: string; applicant_email: string; valid_id_url: string; facebook_profile_url: string; requested_warehouse_name: string; status: string; created_at: string };
const initial: SystemAdminApplicationActionState = { success: false, message: "" };

export function SystemAdminApplicationReview({ application, approve, reject }: { application: Application; approve: (previous: SystemAdminApplicationActionState, formData: FormData) => Promise<SystemAdminApplicationActionState>; reject: (previous: SystemAdminApplicationActionState, formData: FormData) => Promise<SystemAdminApplicationActionState> }) {
  const [approveState, approveAction, approving] = useActionState(approve, initial);
  const [rejectState, rejectAction, rejecting] = useActionState(reject, initial);
  const [copied, setCopied] = useState(false);
  const link = approveState.registrationLink;
  return <article className="rounded-xl border border-white/10 bg-[#10233d] p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-medium text-white">{application.applicant_name}</h3><p className="text-xs text-slate-400">{application.applicant_email} · Requested: {application.requested_warehouse_name}</p></div><span className="rounded-full bg-amber-400/10 px-2 py-1 text-[11px] text-amber-200">{application.status}</span></div>
    <div className="mt-3 flex flex-wrap gap-3 text-xs"><a className="text-cyan-300 hover:text-cyan-200" href={application.valid_id_url} target="_blank" rel="noreferrer">View valid ID link</a><a className="text-cyan-300 hover:text-cyan-200" href={application.facebook_profile_url} target="_blank" rel="noreferrer">View Facebook profile</a></div>
    <div className="mt-4 flex flex-wrap gap-2"><form action={approveAction}><input type="hidden" name="applicationId" value={application.id} /><input type="hidden" name="warehouseName" value={application.requested_warehouse_name} /><button disabled={approving} className="rounded-lg bg-emerald-500/15 px-3 py-2 text-xs font-medium text-emerald-200 disabled:opacity-50">{approving ? "Approving..." : "Approve and create claim"}</button></form><form action={rejectAction}><input type="hidden" name="applicationId" value={application.id} /><button disabled={rejecting} className="rounded-lg bg-rose-500/15 px-3 py-2 text-xs font-medium text-rose-200 disabled:opacity-50">{rejecting ? "Rejecting..." : "Reject"}</button></form></div>
    {(approveState.message || rejectState.message) && <p className="mt-3 text-xs text-slate-300">{approveState.message || rejectState.message}</p>}
    {link && <button type="button" onClick={async () => { await navigator.clipboard.writeText(link); setCopied(true); }} className="mt-2 rounded border border-cyan-300/30 px-2 py-1 text-xs text-cyan-200">{copied ? "Claim link copied" : "Copy one-time claim link"}</button>}
  </article>;
}
