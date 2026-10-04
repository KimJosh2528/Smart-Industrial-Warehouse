"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Eye, KeyRound, Pencil, Plus, Power, Radio } from "lucide-react";
import { manageTruckCredential, setTruckCredentialActive, viewTruckCredential, type TruckCredentialMutationState, type TruckCredentialViewState } from "@/app/trucks/actions";
import type { TruckCredential, TruckListItem } from "@/lib/trucks-data";

const initial: TruckCredentialMutationState = { success: false, message: "" };
const viewInitial: TruckCredentialViewState = { success: false, message: "" };

export function TruckCredentialManager({ truck }: { truck: TruckListItem }) {
  const [visibleCredentialId, setVisibleCredentialId] = useState<string | null>(null);
  const [viewResetKey, setViewResetKey] = useState(0);
  const hideCredential = () => { setVisibleCredentialId(null); setViewResetKey((key) => key + 1); };
  const rfid = truck.credentials.find((credential) => credential.credential_type === "truck_rfid");
  const pin = truck.credentials.find((credential) => credential.credential_type === "truck_pin");
  return <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.025] p-3 sm:p-4"><div className="mb-3 flex items-center justify-between"><p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">Access credentials</p><span className="text-[11px] text-slate-500">{[rfid, pin].filter(Boolean).length} of 2 configured</span></div><div className="grid gap-2 sm:grid-cols-2">{rfid ? <CredentialItem truck={truck} credential={rfid} visibleCredentialId={visibleCredentialId} viewResetKey={viewResetKey} onViewed={setVisibleCredentialId} onHide={hideCredential} /> : <AddCredentialForm truck={truck} type="truck_rfid" />}{pin ? <CredentialItem truck={truck} credential={pin} visibleCredentialId={visibleCredentialId} viewResetKey={viewResetKey} onViewed={setVisibleCredentialId} onHide={hideCredential} /> : <AddCredentialForm truck={truck} type="truck_pin" />}</div></div>;
}

function AddCredentialForm({ truck, type }: { truck: TruckListItem; type: "truck_rfid" | "truck_pin" }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(manageTruckCredential, initial);
  useEffect(() => { if (state.success) formRef.current?.reset(); }, [state.success]);
  const label = type === "truck_rfid" ? "RFID" : "PIN";
  return <form ref={formRef} action={action} className="rounded-lg border border-white/[0.06] bg-[#10233d] p-3"><input type="hidden" name="truckId" value={truck.id} /><input type="hidden" name="credentialType" value={type} /><input type="hidden" name="operation" value="add" /><div className="flex items-center justify-between gap-2"><label className="text-xs font-medium text-white">{label}</label><span className="text-[11px] text-slate-500">Not configured</span></div><input name="rawCredential" type={type === "truck_pin" ? "password" : "text"} inputMode={type === "truck_pin" ? "numeric" : "text"} minLength={type === "truck_pin" ? 4 : undefined} maxLength={type === "truck_pin" ? 6 : undefined} pattern={type === "truck_pin" ? "[0-9]{4,6}" : undefined} autoComplete="off" required placeholder={type === "truck_rfid" ? "Enter RFID value" : "Enter 4–6 digit PIN"} className="mt-2 w-full rounded-md border border-white/10 bg-[#0b1d34] px-2.5 py-2 text-xs text-white outline-none focus:border-cyan-300" /><button disabled={pending} className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-cyan-400/30 px-2.5 py-1.5 text-[11px] font-medium text-cyan-200 hover:bg-cyan-400/10 disabled:opacity-50"><Plus size={13} />{pending ? "Saving..." : `Add ${label}`}</button>{state.message && <p className={`mt-2 text-[11px] ${state.success ? "text-emerald-300" : "text-rose-300"}`}>{state.message}</p>}</form>;
}

function CredentialItem({ truck, credential, visibleCredentialId, viewResetKey, onViewed, onHide }: { truck: TruckListItem; credential: TruckCredential; visibleCredentialId: string | null; viewResetKey: number; onViewed: (id: string) => void; onHide: () => void }) {
  const replaceRef = useRef<HTMLFormElement>(null);
  const [replaceState, replaceAction, replacePending] = useActionState(manageTruckCredential, initial);
  const [activeState, activeAction, activePending] = useActionState(setTruckCredentialActive, initial);
  useEffect(() => { if (replaceState.success) replaceRef.current?.reset(); }, [replaceState.success]);
  const isPin = credential.credential_type === "truck_pin";
  const label = isPin ? "PIN" : "RFID";
  const icon = isPin ? <KeyRound size={14} /> : <Radio size={14} />;
  const operation = credential.is_active ? "deactivate" : "activate";
  return <div className="rounded-lg border border-white/[0.06] bg-[#10233d] p-3"><div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2 text-xs font-medium text-slate-200"><span className="text-indigo-300">{icon}</span>{label}</div><span className={credential.is_active ? "text-[11px] text-emerald-300" : "text-[11px] text-slate-500"}>Configured · {credential.is_active ? "Active" : "Inactive"}</span></div><form ref={replaceRef} action={replaceAction} className="mt-3 flex flex-wrap gap-2"><input type="hidden" name="truckId" value={truck.id} /><input type="hidden" name="credentialType" value={credential.credential_type} /><input type="hidden" name="credentialId" value={credential.id} /><input type="hidden" name="operation" value="replace" /><input name="rawCredential" type={isPin ? "password" : "text"} inputMode={isPin ? "numeric" : "text"} minLength={isPin ? 4 : undefined} maxLength={isPin ? 6 : undefined} pattern={isPin ? "[0-9]{4,6}" : undefined} autoComplete="off" required placeholder={`New ${label}`} className="min-w-0 flex-1 rounded-md border border-white/10 bg-[#0b1d34] px-2.5 py-1.5 text-[11px] text-white outline-none focus:border-cyan-300" /><button type="submit" disabled={replacePending} className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2.5 py-1.5 text-[11px] text-slate-300 hover:bg-white/5 disabled:opacity-50"><Pencil size={12} />Replace</button></form><div className="mt-2 flex flex-wrap gap-2"><form action={activeAction} className="inline"><input type="hidden" name="truckId" value={truck.id} /><input type="hidden" name="credentialId" value={credential.id} /><input type="hidden" name="credentialType" value={credential.credential_type} /><input type="hidden" name="operation" value={operation} /><button type="submit" disabled={activePending} className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1.5 text-[11px] text-slate-300 hover:bg-white/5 disabled:opacity-50"><Power size={12} />{activePending ? "Saving..." : credential.is_active ? "Deactivate" : "Reactivate"}</button></form><CredentialView key={`${credential.id}-${viewResetKey}`} credential={credential} visibleCredentialId={visibleCredentialId} onViewed={onViewed} onHide={onHide} /></div>{(replaceState.message || activeState.message) && <p className={`mt-2 text-[11px] ${(replaceState.success || activeState.success) ? "text-emerald-300" : "text-rose-300"}`}>{replaceState.message || activeState.message}</p>}</div>;
}

function CredentialView({ credential, visibleCredentialId, onViewed, onHide }: { credential: TruckCredential; visibleCredentialId: string | null; onViewed: (id: string) => void; onHide: () => void }) {
  const [viewState, viewAction, viewPending] = useActionState(viewTruckCredential, viewInitial);
  useEffect(() => { if (viewState.success && viewState.credentialId) onViewed(viewState.credentialId); }, [viewState.success, viewState.credentialId, onViewed]);
  const label = credential.credential_type === "truck_pin" ? "PIN" : "RFID";
  const isVisible = visibleCredentialId === credential.id && Boolean(viewState.credentialValue);
  return <>{!isVisible && <form action={viewAction} className="inline"><input type="hidden" name="credentialId" value={credential.id} /><input type="hidden" name="credentialType" value={credential.credential_type} /><button type="submit" disabled={viewPending} className="inline-flex items-center gap-1 rounded-md border border-cyan-400/30 px-2 py-1.5 text-[11px] text-cyan-200 hover:bg-cyan-400/10 disabled:opacity-50"><Eye size={12} />{viewPending ? "Loading..." : `View ${label}`}</button></form>}{isVisible && <div className="basis-full flex items-center justify-between gap-2 rounded-md border border-cyan-400/20 bg-cyan-400/5 px-2.5 py-2 text-xs text-cyan-100"><code className="break-all">{viewState.credentialValue}</code><button type="button" onClick={onHide} className="shrink-0 rounded border border-white/10 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/5">Hide</button></div>}{viewState.message && !viewState.success && <p className="basis-full text-[11px] text-rose-300">{viewState.message}</p>}</>;
}
