"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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

  return <main className="flex min-h-screen items-center justify-center bg-[#061223] px-5 text-slate-100"><section className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0b1d34] p-8 shadow-2xl shadow-black/30"><div className="mb-8"><p className="text-sm font-semibold text-cyan-300">Smart Industrial Warehouse</p><h1 className="mt-2 text-2xl font-semibold text-white">Administrator sign in</h1><p className="mt-2 text-sm text-slate-400">Sign in to view your warehouse operations.</p></div><form onSubmit={submit} className="space-y-5"><label className="block text-sm text-slate-300">Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required className="mt-2 w-full rounded-lg border border-white/10 bg-[#10233d] px-3 py-3 text-white outline-none focus:border-cyan-300" /></label><label className="block text-sm text-slate-300">Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required className="mt-2 w-full rounded-lg border border-white/10 bg-[#10233d] px-3 py-3 text-white outline-none focus:border-cyan-300" /></label>{error && <p role="alert" className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">{error}</p>}<button type="submit" disabled={loading} className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-wait disabled:opacity-60">{loading ? "Signing in..." : "Sign in"}</button></form></section></main>;
}
