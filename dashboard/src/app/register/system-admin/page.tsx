import { submitSystemAdminApplication } from "@/app/register/actions";
import { SystemAdminApplicationForm } from "@/components/system-admin-application-form";

export default function SystemAdminApplicationPage() {
  return <main className="flex min-h-screen items-center justify-center bg-[#061223] px-5 text-slate-100">
    <section className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0b1d34] p-8 shadow-2xl shadow-black/30">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-cyan-300/80">WareGuard ownership registration</p>
      <h1 className="mt-3 text-2xl font-semibold text-white">Register as System Admin</h1>
      <p className="mt-2 mb-6 text-sm text-slate-400">Submit your application for Father Admin review. Account credentials are created only after approval.</p>
      <SystemAdminApplicationForm action={submitSystemAdminApplication} />
    </section>
  </main>;
}
