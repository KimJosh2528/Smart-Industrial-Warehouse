"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Eye, KeyRound, Pencil, Plus, Power, Radio } from "lucide-react";
import { manageStaffCredential, setStaffCredentialActive, viewStaffCredential, type CredentialMutationState } from "@/app/staff/actions";
import type { StaffCredential, StaffListItem } from "@/lib/staff-data";

const initialState: CredentialMutationState = { success: false, message: "" };

export function StaffCredentialManager({ staff }: { staff: StaffListItem }) {
  const [visibleCredentialId, setVisibleCredentialId] = useState<string | null>(null);
  const [viewResetKey, setViewResetKey] = useState(0);
  const hideCredential = () => {
    setVisibleCredentialId(null);
    setViewResetKey((key) => key + 1);
  };
  const pin = staff.credentials.find((credential) => credential.credential_type === "staff_pin");
  const rfid = staff.credentials.find((credential) => credential.credential_type === "staff_rfid");

  return <div className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
    <div className="mb-3 flex items-center justify-between"><p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">Credentials</p><span className="text-[11px] text-slate-500">{[pin, rfid].filter(Boolean).length} registered</span></div>
    <div className="space-y-3">
      {rfid ? <CredentialItem staff={staff} credential={rfid} visibleCredentialId={visibleCredentialId} viewResetKey={viewResetKey} onViewed={setVisibleCredentialId} onHide={hideCredential} /> : <AddCredentialForm staff={staff} type="staff_rfid" />}
      {pin ? <CredentialItem staff={staff} credential={pin} visibleCredentialId={visibleCredentialId} viewResetKey={viewResetKey} onViewed={setVisibleCredentialId} onHide={hideCredential} /> : <AddCredentialForm staff={staff} type="staff_pin" />}
    </div>
  </div>;
}

function AddCredentialForm({ staff, type }: { staff: StaffListItem; type: "staff_rfid" | "staff_pin" }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(manageStaffCredential, initialState);
  useEffect(() => { if (state.success) formRef.current?.reset(); }, [state.success]);
  const label = type === "staff_rfid" ? "RFID" : "PIN";
  return <form ref={formRef} action={action} className="rounded-lg border border-white/[0.06] bg-[#10233d] p-2.5">
    <input type="hidden" name="staffMemberId" value={staff.id} /><input type="hidden" name="credentialType" value={type} /><input type="hidden" name="operation" value="add" />
    <label className="block text-[11px] text-slate-400">Add {label}<input name="rawCredential" type={type === "staff_pin" ? "password" : "text"} inputMode={type === "staff_pin" ? "numeric" : "text"} minLength={type === "staff_pin" ? 4 : undefined} maxLength={type === "staff_pin" ? 6 : undefined} pattern={type === "staff_pin" ? "[0-9]{4,6}" : undefined} autoComplete="off" required placeholder={type === "staff_rfid" ? "RFID value" : "4–6 digit PIN"} className="mt-1.5 w-full rounded-md border border-white/10 bg-[#0b1d34] px-2.5 py-2 text-xs text-white outline-none focus:border-cyan-300" /></label>
    <button disabled={pending} className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-blue-500 disabled:opacity-50"><Plus size={13} />{pending ? "Saving..." : `Add ${label}`}</button>
    {state.message && <p className={`mt-2 text-[11px] ${state.success ? "text-emerald-300" : "text-rose-300"}`}>{state.message}</p>}
  </form>;
}

function CredentialItem({ staff, credential, visibleCredentialId, viewResetKey, onViewed, onHide }: { staff: StaffListItem; credential: StaffCredential; visibleCredentialId: string | null; viewResetKey: number; onViewed: (id: string) => void; onHide: () => void }) {
  const replaceRef = useRef<HTMLFormElement>(null);
  const [replaceState, replaceAction, replacePending] = useActionState(manageStaffCredential, initialState);
  const [activeState, activeAction, activePending] = useActionState(setStaffCredentialActive, initialState);
  useEffect(() => { if (replaceState.success) replaceRef.current?.reset(); }, [replaceState.success]);
  const type = credential.credential_type === "staff_pin" ? "PIN" : "RFID";
  const icon = credential.credential_type === "staff_pin" ? <KeyRound size={14} /> : <Radio size={14} />;
  const operation = credential.is_active ? "deactivate" : "activate";

  return <div className="rounded-lg border border-white/[0.06] bg-[#10233d] p-2.5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2 text-xs text-slate-200"><span className="text-indigo-300">{icon}</span><span>{type}</span><span className={credential.is_active ? "text-emerald-300" : "text-slate-500"}>{credential.is_active ? "Active" : "Inactive"}</span></div>
      <form ref={replaceRef} action={replaceAction} className="flex items-center gap-2"><input type="hidden" name="staffMemberId" value={staff.id} /><input type="hidden" name="credentialType" value={credential.credential_type} /><input type="hidden" name="credentialId" value={credential.id} /><input type="hidden" name="operation" value="replace" /><input name="rawCredential" type={credential.credential_type === "staff_pin" ? "password" : "text"} inputMode={credential.credential_type === "staff_pin" ? "numeric" : "text"} minLength={credential.credential_type === "staff_pin" ? 4 : undefined} maxLength={credential.credential_type === "staff_pin" ? 6 : undefined} pattern={credential.credential_type === "staff_pin" ? "[0-9]{4,6}" : undefined} autoComplete="off" required placeholder={`New ${type}`} className="w-28 rounded-md border border-white/10 bg-[#0b1d34] px-2 py-1.5 text-[11px] text-white outline-none focus:border-cyan-300" /><button type="submit" disabled={replacePending} className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1.5 text-[11px] text-slate-300 hover:bg-white/5 disabled:opacity-50"><Pencil size={12} />Replace {type}</button></form>
      <form action={activeAction} className="inline"><input type="hidden" name="staffMemberId" value={staff.id} /><input type="hidden" name="credentialId" value={credential.id} /><input type="hidden" name="credentialType" value={credential.credential_type} /><input type="hidden" name="operation" value={operation} /><button type="submit" disabled={activePending} className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1.5 text-[11px] text-slate-300 hover:bg-white/5 disabled:opacity-50"><Power size={12} />{credential.is_active ? "Deactivate" : "Reactivate"}</button></form>
      <CredentialView key={`${credential.id}-${viewResetKey}`} credential={credential} visibleCredentialId={visibleCredentialId} onViewed={onViewed} onHide={onHide} />
    </div>
    {(replaceState.message || activeState.message) && <p className={`mt-2 text-[11px] ${(replaceState.success || activeState.success) ? "text-emerald-300" : "text-rose-300"}`}>{replaceState.message || activeState.message}</p>}
  </div>;
}

function CredentialView({ credential, visibleCredentialId, onViewed, onHide }: { credential: StaffCredential; visibleCredentialId: string | null; onViewed: (id: string) => void; onHide: () => void }) {
  const [viewState, viewAction, viewPending] = useActionState(viewStaffCredential, initialState);
  useEffect(() => { if (viewState.success && viewState.credentialId) onViewed(viewState.credentialId); }, [viewState.success, viewState.credentialId, onViewed]);
  const type = credential.credential_type === "staff_pin" ? "PIN" : "RFID";
  const isVisible = visibleCredentialId === credential.id && Boolean(viewState.credentialValue);

  return <>
    {!isVisible && <form action={viewAction} className="inline"><input type="hidden" name="credentialId" value={credential.id} /><input type="hidden" name="credentialType" value={credential.credential_type} /><button type="submit" disabled={viewPending} className="inline-flex items-center gap-1 rounded-md border border-cyan-400/30 px-2 py-1.5 text-[11px] text-cyan-200 hover:bg-cyan-400/10 disabled:opacity-50"><Eye size={12} />{viewPending ? "Loading..." : `View ${type}`}</button></form>}
    {isVisible && <div className="mt-2 basis-full flex items-center justify-between gap-2 rounded-md border border-cyan-400/20 bg-cyan-400/5 px-2.5 py-2 text-xs text-cyan-100"><code className="break-all">{viewState.credentialValue}</code><button type="button" onClick={onHide} className="shrink-0 rounded border border-white/10 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/5">Hide</button></div>}
    {viewState.message && !viewState.success && <p className="basis-full text-[11px] text-rose-300">{viewState.message}</p>}
  </>;
}
