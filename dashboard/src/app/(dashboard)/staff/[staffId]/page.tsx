import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, CircleUserRound, XCircle } from "lucide-react";
import { loadStaffData } from "@/lib/staff-data";
import { StaffCredentialManager } from "@/components/staff-credential-manager";
import { StaffPermissionManager } from "@/components/staff-permission-manager";
import { AccountClaimManager } from "@/components/account-claim-manager";
import { invokeStaffAccountRequest, revokeStaffAccountRequest } from "@/app/staff/actions";

export default async function StaffDetailPage({ params }: { params: Promise<{ staffId: string }> }) {
  const { staffId } = await params;
  const [staffData, guardData] = await Promise.all([loadStaffData("staff"), loadStaffData("guard")]);
  const staff = [...staffData.rows, ...guardData.rows].find((row) => row.id === staffId);
  if (!staff) notFound();

  return <>
    <header className="mb-6 flex items-center justify-between gap-4">
      <div><Link href="/staff" className="mb-3 inline-flex items-center gap-2 text-xs text-cyan-300 hover:text-cyan-200"><ArrowLeft size={14} /> Back to Staff Management</Link><h1 className="mt-1 text-2xl font-semibold text-white">{staff.display_name}</h1><p className="mt-2 text-sm text-slate-400">{staff.employee_code ?? "No employee code"} · {staff.warehouse_name}</p></div>
      <CircleUserRound className="hidden text-slate-400 sm:block" />
    </header>
    <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
      <section className="space-y-5">
        <Panel title="Account"><div className="flex items-center gap-2"><Badge active={staff.profile_id !== null} yes="CLAIMED" no="UNCLAIMED" /><span className="text-xs text-slate-500">Claimed after the user completes first login.</span></div><div className="mt-4"><AccountClaimManager kind="staff" targetId={staff.id} profileId={staff.profile_id} claim={staff.account_claim} invokeAction={invokeStaffAccountRequest} revokeAction={revokeStaffAccountRequest} /></div></Panel>
      </section>
      <section className="space-y-5"><StaffCredentialManager staff={staff} /><StaffPermissionManager staff={staff} /></section>
    </div>
  </>;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) { return <section className="rounded-2xl border border-white/10 bg-[#0b1d34] p-5"><h2 className="mb-4 font-semibold text-white">{title}</h2>{children}</section>; }
function Badge({ active, yes, no }: { active: boolean; yes: string; no: string }) { return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] ${active ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-500/20 text-slate-400"}`}>{active ? <CheckCircle2 size={13} /> : <XCircle size={13} />}{active ? yes : no}</span>; }
