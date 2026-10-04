import Link from "next/link";
import { WareGuardLogo } from "@/components/wareguard-logo";

export default function MaintenancePage() {
  return (
    <main className="flex min-h-screen items-center justify-center overflow-hidden bg-[#061223] px-5 py-10 text-slate-100">
      <section className="relative w-full max-w-xl rounded-2xl border border-blue-400/60 bg-[#08172b] px-6 py-12 text-center shadow-2xl shadow-blue-950/40 sm:px-14">
        <div className="pointer-events-none absolute inset-0 rounded-2xl bg-[radial-gradient(circle_at_50%_0%,rgba(37,99,235,0.18),transparent_55%)]" />
        <div className="relative flex flex-col items-center">
          <WareGuardLogo />
          <div className="my-9 h-px w-full bg-gradient-to-r from-transparent via-blue-400/30 to-transparent" />
          <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full border border-blue-400/25 bg-blue-400/10 text-2xl text-blue-300" aria-hidden="true">⚙</div>
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">System Under Maintenance</h1>
          <p className="mt-4 max-w-md text-sm leading-6 text-slate-400">We&apos;re currently performing scheduled maintenance. The system will be back online shortly.</p>
          <Link href="/login" className="mt-8 rounded-lg border border-blue-400/40 px-4 py-2.5 text-sm font-semibold text-blue-200 transition hover:border-blue-300 hover:bg-blue-400/10">Back to Login</Link>
          <div className="mt-10 flex items-center gap-3 text-xs text-slate-500"><span className="h-2 w-2 animate-pulse rounded-full bg-blue-400" />We&apos;ll be back soon</div>
        </div>
      </section>
    </main>
  );
}
