"use client";

import { useActionState, useEffect, useState } from "react";
import { Clipboard, Link2, RotateCcw, ShieldCheck, XCircle } from "lucide-react";
import type { AccountClaim } from "@/lib/account-claims";

type ClaimState = { success: boolean; message: string; registrationLink?: string; expiresAt?: string };
type ClaimAction = (previous: ClaimState, formData: FormData) => Promise<ClaimState>;
const initial: ClaimState = { success: false, message: "" };

export function AccountClaimManager({ kind, targetId, profileId, claim, invokeAction, revokeAction, applicantEmail, facebookProfileUrl }: { kind: "staff" | "guard" | "driver"; targetId: string; profileId: string | null; claim: AccountClaim | null; invokeAction: ClaimAction; revokeAction: ClaimAction; applicantEmail?: string | null; facebookProfileUrl?: string | null }) {
  const [state, action, pending] = useActionState(invokeAction, initial);
  const [revokeState, revoke, revokePending] = useActionState(revokeAction, initial);
  const [copied, setCopied] = useState(false);
  const label = kind === "staff" ? "staff" : "driver";
  const link = state.success ? state.registrationLink : undefined;

  const copyLink = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copiedWithFallback = document.execCommand("copy");
      textarea.remove();
      setCopied(copiedWithFallback);
    }
  };

  useEffect(() => {
    if (link) void copyLink(link);
  }, [link]);

  if (profileId) return <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-emerald-300"><ShieldCheck size={13} />Account: Claimed</div>;

  return <div className="mt-2 space-y-2">
    {applicantEmail && <p className="text-[11px] text-slate-400">{applicantEmail}</p>}
    {facebookProfileUrl && <a href={facebookProfileUrl} target="_blank" rel="noreferrer" className="inline-block text-[11px] text-cyan-300 underline hover:text-cyan-200">Open Facebook profile</a>}
    {claim && <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-2.5 text-[11px] text-amber-200">
      <p className="flex items-center gap-1.5 font-medium"><Link2 size={13} />Account Request: Invited</p>
      <p className="mt-1 text-amber-200/70">Expires {new Date(claim.expires_at).toLocaleString()}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {link && <>
          <p className="w-full break-all rounded border border-white/10 bg-black/10 px-2 py-1 text-[10px] text-slate-300">{link}</p>
          <button type="button" onClick={() => void copyLink(link)} className="inline-flex items-center gap-1 rounded border border-amber-300/30 px-2 py-1 text-[11px] hover:bg-amber-300/10"><Clipboard size={12} />{copied ? "Copied" : "Copy Registration Link"}</button>
        </>}
        <form action={revoke}><input type="hidden" name="requestId" value={claim.request_id} /><button type="submit" disabled={revokePending} className="inline-flex items-center gap-1 rounded border border-white/10 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/5"><XCircle size={12} />Revoke Request</button></form>
      </div>
    </div>}
    {!claim && <form action={action}><input type="hidden" name={kind === "driver" ? "driverId" : "staffMemberId"} value={targetId} /><input type="hidden" name="registrationRole" value={kind} /><button type="submit" disabled={pending} className="inline-flex items-center gap-1 rounded border border-cyan-400/30 px-2 py-1 text-[11px] text-cyan-200 hover:bg-cyan-400/10 disabled:opacity-50"><Link2 size={12} />{pending ? "Creating..." : "Send Magic Link"}</button></form>}
    {claim && <form action={action}><input type="hidden" name={kind === "driver" ? "driverId" : "staffMemberId"} value={targetId} /><input type="hidden" name="registrationRole" value={kind} /><button type="submit" disabled={pending} className="inline-flex items-center gap-1 rounded border border-cyan-400/30 px-2 py-1 text-[11px] text-cyan-200 hover:bg-cyan-400/10 disabled:opacity-50"><RotateCcw size={12} />{pending ? "Creating..." : "Send New Magic Link"}</button></form>}
    {(state.message || revokeState.message) && <p className={`text-[11px] ${(state.success || revokeState.success) ? "text-emerald-300" : "text-rose-300"}`}>{state.message || revokeState.message}</p>}
  </div>;
}
