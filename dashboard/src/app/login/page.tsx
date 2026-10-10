"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { WareGuardLogo } from "@/components/wareguard-logo";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { error: signInError } = await createClient().auth.signInWithPassword({ email, password });
      if (signInError) {
        setError(signInError.status === 400 ? "Email or password is incorrect." : "Sign-in could not be completed. Please try again.");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("The authentication service could not be reached. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return <main className="flex min-h-screen items-center justify-center bg-[#061223] px-5 text-slate-100"><section className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0b1d34] p-8 shadow-2xl shadow-black/30"><div className="mb-8"><WareGuardLogo /><h1 className="mt-8 text-2xl font-semibold text-white">Sign in to WareGuard</h1><p className="mt-2 text-sm text-slate-400">Sign in to access your WareGuard account and workspace.</p></div><form onSubmit={submit} className="space-y-5"><label className="block text-sm text-slate-300">Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required className="mt-2 w-full rounded-lg border border-white/10 bg-[#10233d] px-3 py-3 text-white outline-none focus:border-cyan-300" /></label><label className="block text-sm text-slate-300">Password<span className="relative mt-2 block"><input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required className="w-full rounded-lg border border-white/10 bg-[#10233d] px-3 py-3 pr-11 text-white outline-none focus:border-cyan-300" /><button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Hide password" : "Show password"} title={showPassword ? "Hide password" : "Show password"} className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-white">{showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</button></span></label>{error && <p role="alert" className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">{error}</p>}<button type="submit" disabled={loading} className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-wait disabled:opacity-60">{loading ? "Signing in..." : "Sign in"}</button></form><div className="mt-8 border-t border-white/10 pt-5"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">New to WareGuard?</p><p className="mt-1 text-xs text-slate-500">Choose the account type you want to apply for.</p><div className="mt-3 grid gap-2 text-sm"><Link href="/register/system-admin" className="rounded-lg border border-white/10 px-3 py-2 text-slate-300 hover:bg-white/5">Apply as System Admin</Link><Link href="/register/staff" className="rounded-lg border border-white/10 px-3 py-2 text-slate-300 hover:bg-white/5">Apply as Staff</Link><Link href="/register/driver" className="rounded-lg border border-white/10 px-3 py-2 text-slate-300 hover:bg-white/5">Apply as Driver</Link></div></div></section></main>;
}
