"use client";

import { useActionState } from "react";
import type { SystemAdminApplicationState } from "@/app/register/actions";

const initial: SystemAdminApplicationState = { success: false, message: "" };

export function SystemAdminApplicationForm({ action }: { action: (previous: SystemAdminApplicationState, formData: FormData) => Promise<SystemAdminApplicationState> }) {
  const [state, submit, pending] = useActionState(action, initial);
  return <form action={submit} className="space-y-4">
    <label className="block text-sm text-slate-300">Full name<input name="applicantName" required className="mt-2 w-full rounded-lg border border-white/10 bg-[#10233d] px-3 py-3 text-white outline-none focus:border-cyan-300" /></label>
    <label className="block text-sm text-slate-300">Email<input name="email" type="email" required className="mt-2 w-full rounded-lg border border-white/10 bg-[#10233d] px-3 py-3 text-white outline-none focus:border-cyan-300" /></label>
    <label className="block text-sm text-slate-300">Valid ID link<input name="validIdUrl" type="url" pattern="https://.*" required placeholder="https://..." className="mt-2 w-full rounded-lg border border-white/10 bg-[#10233d] px-3 py-3 text-white outline-none focus:border-cyan-300" /></label>
    <label className="block text-sm text-slate-300">Facebook profile link<input name="facebookProfileUrl" type="url" pattern="https://(www\.)?facebook\.com/.*" required placeholder="https://facebook.com/..." className="mt-2 w-full rounded-lg border border-white/10 bg-[#10233d] px-3 py-3 text-white outline-none focus:border-cyan-300" /></label>
    <button type="submit" disabled={pending} className="w-full rounded-lg bg-cyan-400 px-4 py-3 text-sm font-semibold text-slate-950 disabled:opacity-50">{pending ? "Submitting..." : "Submit application"}</button>
    {state.message && <p role="status" className={`text-sm ${state.success ? "text-emerald-300" : "text-rose-300"}`}>{state.message}</p>}
  </form>;
}
