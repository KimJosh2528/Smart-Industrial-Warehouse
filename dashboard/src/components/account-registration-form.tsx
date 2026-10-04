"use client";

import { useActionState } from "react";
import type { RegistrationState } from "@/lib/registration-state";
import { registrationInitial } from "@/lib/registration-state";
import { registerAndClaim, signInAndClaim } from "@/app/register/actions";

export function AccountRegistrationForm({ token, kind }: { token: string; kind: "staff" | "driver" }) {
  const [state, action, pending] = useActionState<RegistrationState, FormData>(registerAndClaim, registrationInitial);
  const [signInState, signInAction, signInPending] = useActionState<RegistrationState, FormData>(signInAndClaim, registrationInitial);
  const label = kind === "staff" ? "staff" : "driver";

  if (state.requiresConfirmation) return <div className="space-y-4">
    <p className="rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">{state.message}</p>
    <form action={signInAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <label className="block"><span className="mb-1 block text-xs text-slate-400">Confirmed account email</span><input name="email" type="email" required defaultValue={state.email} autoComplete="email" className="w-full rounded-lg border border-white/10 bg-[#08172b] px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60" /></label>
      <label className="block"><span className="mb-1 block text-xs text-slate-400">Password</span><input name="password" type="password" required autoComplete="current-password" className="w-full rounded-lg border border-white/10 bg-[#08172b] px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60" /></label>
      <button type="submit" disabled={signInPending} className="w-full rounded-lg bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-50">{signInPending ? "Signing in..." : "Confirm email and finish registration"}</button>
      {signInState.message && <p className={`text-sm ${signInState.success ? "text-emerald-300" : "text-rose-300"}`}>{signInState.message}</p>}
    </form>
  </div>;

  return <div className="space-y-6">
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="kind" value={kind} />
      <label className="block"><span className="mb-1 block text-xs text-slate-400">Email</span><input name="email" type="email" required autoComplete="email" className="w-full rounded-lg border border-white/10 bg-[#08172b] px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60" /></label>
      <label className="block"><span className="mb-1 block text-xs text-slate-400">Password</span><input name="password" type="password" required minLength={8} autoComplete="new-password" className="w-full rounded-lg border border-white/10 bg-[#08172b] px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60" /></label>
      <label className="block"><span className="mb-1 block text-xs text-slate-400">Confirm password</span><input name="confirmation" type="password" required minLength={8} autoComplete="new-password" className="w-full rounded-lg border border-white/10 bg-[#08172b] px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60" /></label>
      <button type="submit" disabled={pending} className="w-full rounded-lg bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-50">{pending ? "Creating account..." : `Create ${label} account`}</button>
      {state.message && <p className={`text-sm ${state.success ? "text-emerald-300" : "text-rose-300"}`}>{state.message}</p>}
      {state.diagnostic && <p className="rounded-lg border border-slate-500/30 bg-slate-950/30 px-3 py-2 text-xs text-slate-400">Diagnostic: name={state.diagnostic.name}; code={state.diagnostic.code}; status={state.diagnostic.status ?? "unknown"}; message={state.diagnostic.message}</p>}
    </form>

    <section className="border-t border-amber-400/20 pt-5">
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-amber-300">Temporary development test</p>
      <p className="mb-3 text-xs text-slate-500">For an existing confirmed Auth account only. This does not create an account or send a confirmation email.</p>
      <form action={signInAction} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <label className="block"><span className="mb-1 block text-xs text-slate-400">Existing account email</span><input name="email" type="email" required autoComplete="email" className="w-full rounded-lg border border-amber-400/20 bg-[#08172b] px-3 py-2 text-sm text-white outline-none focus:border-amber-300/60" /></label>
        <label className="block"><span className="mb-1 block text-xs text-slate-400">Existing account password</span><input name="password" type="password" required autoComplete="current-password" className="w-full rounded-lg border border-amber-400/20 bg-[#08172b] px-3 py-2 text-sm text-white outline-none focus:border-amber-300/60" /></label>
        <button type="submit" disabled={signInPending} className="w-full rounded-lg border border-amber-300/30 px-4 py-2.5 text-sm font-semibold text-amber-200 hover:bg-amber-300/10 disabled:opacity-50">{signInPending ? "Testing sign-in..." : "Test sign-in and claim"}</button>
        {signInState.message && <p className={`text-sm ${signInState.success ? "text-emerald-300" : "text-rose-300"}`}>{signInState.message}</p>}
        {signInState.diagnostic && <p className="rounded-lg border border-slate-500/30 bg-slate-950/30 px-3 py-2 text-xs text-slate-400">Diagnostic: name={signInState.diagnostic.name}; code={signInState.diagnostic.code}; status={signInState.diagnostic.status ?? "unknown"}; message={signInState.diagnostic.message}</p>}
      </form>
    </section>
  </div>;
}
