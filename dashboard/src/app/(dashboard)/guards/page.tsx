import Link from "next/link";
import { ArrowRight, CircleUserRound, Shield } from "lucide-react";
import { AccountClaimManager } from "@/components/account-claim-manager";
import { StaffPermissionInlineManager } from "@/components/staff-permission-inline-manager";
import { invokeStaffAccountRequest, revokeStaffAccountRequest } from "@/app/staff/actions";
import { loadStaffData } from "@/lib/staff-data";

export default async function GuardsPage() {
  const data = await loadStaffData("guard");
  return <>
    <header className="mb-6 flex items-center justify-between gap-4"><div><p className="text-xs font-medium uppercase tracking-[0.18em] text-amber-300/80">People</p><h1 className="mt-1 text-2xl font-semibold text-white">Guard Management</h1><p className="mt-2 text-sm text-slate-400">Guard records are created from approved applications. Save credentials and doorlock entrances from each record.</p></div><Shield className="hidden text-amber-300 sm:block" /></header>
    {data.error && <p className="mb-5 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">{data.error}</p>}
    <p className="mb-5 rounded-xl border border-amber-300/15 bg-amber-300/[0.04] px-4 py-3 text-sm text-slate-300">No manual guard creation here. Review applicants under Member Applications.</p>
    <section className="overflow-visible rounded-2xl border border-white/10 bg-[#0b1d34]"><div className="border-b border-white/[0.07] p-4 sm:p-5"><div className="flex items-center justify-between"><div><h2 className="font-semibold text-white">Guard members</h2><p className="mt-1 text-xs text-slate-500">{data.rows.length} matching guard{data.rows.length === 1 ? "" : "s"}</p></div><CircleUserRound className="text-slate-500" /></div></div>
      {data.rows.length ? <div className="divide-y divide-white/[0.06]">{data.rows.map((row) => { const hasRfid = row.credentials.some((credential) => credential.credential_type === "staff_rfid" && credential.is_active); const credentialLabel = hasRfid && row.camera_enabled ? "RFID + Camera" : hasRfid ? "RFID only" : row.camera_enabled ? "Camera only" : "No credentials"; return <div key={row.id} className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-5"><div className="min-w-[220px] flex-1"><p className="font-medium text-white">{row.display_name}</p><p className="mt-1 text-xs text-slate-500">{row.employee_code ?? "No guard code"} · {row.warehouse_name}</p></div><div className="flex flex-wrap items-center gap-2 text-[11px]"><span className={`rounded-full px-2.5 py-1 ${row.profile_id ? "bg-cyan-500/15 text-cyan-200" : "bg-slate-500/20 text-slate-400"}`}>{row.profile_id ? "CLAIMED" : "UNCLAIMED"}</span><span className="rounded-full bg-indigo-500/15 px-2.5 py-1 text-indigo-200">{credentialLabel}</span><StaffPermissionInlineManager staff={row} /><AccountClaimManager kind="guard" targetId={row.id} profileId={row.profile_id} claim={row.account_claim} invokeAction={invokeStaffAccountRequest} revokeAction={revokeStaffAccountRequest} applicantEmail={row.applicant_email} facebookProfileUrl={row.facebook_profile_url} /><Link href={`/staff/${row.id}`} className="inline-flex items-center gap-1 rounded-lg border border-amber-400/30 px-3 py-2 text-amber-200 hover:bg-amber-400/10">Manage <ArrowRight size={13} /></Link></div></div>; })}</div> : <div className="px-5 py-16 text-center text-sm text-slate-400">No matching guard members.</div>}
    </section>
  </>;
}
