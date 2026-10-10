import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AccountRegistrationForm } from "@/components/account-registration-form";
import { hashClaimToken } from "@/lib/account-claim-server";

export default async function SystemAdminRegistrationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const client = await createClient();
  const { data: claim, error } = await client.rpc("get_system_admin_claim", {
    p_token_hash: hashClaimToken(token),
  });
  const record = (claim ?? [])[0] as { application_id?: string; applicant_name?: string; applicant_email?: string; expires_at?: string } | undefined;
  if (error || !record) notFound();

  return <main className="flex min-h-screen items-center justify-center bg-[#061223] px-5 text-slate-100">
    <section className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0b1d34] p-8 shadow-2xl shadow-black/30">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-cyan-300/80">WareGuard System Admin</p>
      <h1 className="mt-3 text-2xl font-semibold text-white">Finish your account setup</h1>
      <p className="mt-2 text-sm text-slate-400">{record.applicant_name} · {record.applicant_email}</p>
      <p className="mt-3 text-xs text-slate-500">Choose your unique warehouse name to finish your one-time claim.</p>
      <div className="mt-6"><AccountRegistrationForm token={token} kind="system_admin" applicantEmail={record.applicant_email} /></div>
    </section>
  </main>;
}
