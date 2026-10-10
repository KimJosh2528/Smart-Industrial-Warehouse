import { notFound } from "next/navigation";
import { MemberApplicationForm } from "@/components/member-application-form";

const roles = { staff: "Staff", guard: "Guard", driver: "Driver" } as const;

export default async function MemberApplicationPage({ params }: { params: Promise<{ role: string }> }) {
  const role = (await params).role as keyof typeof roles;
  if (!roles[role]) notFound();
  return <main className="flex min-h-screen items-center justify-center bg-[#061223] px-5 py-10 text-slate-100"><section className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0b1d34] p-8 shadow-2xl shadow-black/30"><p className="text-xs font-medium uppercase tracking-[0.18em] text-cyan-300/80">WareGuard applicant registration</p><h1 className="mt-3 text-2xl font-semibold text-white">Apply as {roles[role]}</h1><p className="mt-2 mb-6 text-sm text-slate-400">Your application will be sent only to the System Admin of the exact warehouse name you enter.</p><MemberApplicationForm role={role} label={roles[role]} /></section></main>;
}
