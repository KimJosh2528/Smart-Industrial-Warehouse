"use client";

import { useEffect, useState } from "react";
import { Flame, Siren } from "lucide-react";
import type { DashboardData } from "@/lib/dashboard-data";

export function SafetyStatusCard({ environment }: { environment: DashboardData["environment"] }) {
  const [remaining, setRemaining] = useState(environment.smokeExposureSeconds);
  const exposureReached = remaining != null && remaining <= 0;
  const fireOn = String(environment.fireState ?? "").toUpperCase() === "ON" || exposureReached;

  useEffect(() => {
    setRemaining(environment.smokeExposureSeconds);
    if (environment.smokeExposureSeconds == null) return;
    const timer = window.setInterval(() => setRemaining((value) => value == null ? null : Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [environment.smokeExposureSeconds]);

  const exposureText = remaining == null ? "No active smoke exposure" : remaining > 0 ? `${remaining}s remaining before exposure limit` : "Exposure limit reached";
  return <section className={`rounded-2xl border p-4 sm:p-5 ${fireOn ? "border-rose-300/60 bg-rose-950/35" : "border-white/[0.07] bg-[#10233d]"}`}>
    {fireOn && <div className="mb-4 flex items-center gap-3 rounded-xl border border-rose-300/50 bg-rose-500/20 px-4 py-3 text-rose-100 animate-[pulse_1s_ease-in-out_infinite]"><Siren size={24} className="shrink-0" /><div><p className="text-sm font-black tracking-wide">FIRE ALERT — EVACUATE NOW!!!</p><p className="mt-0.5 text-xs text-rose-200/80">Immediate attention required in the Roll Yard.</p></div></div>}
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><span className={`flex h-11 w-11 items-center justify-center rounded-xl ${fireOn ? "bg-rose-500/20 text-rose-200" : "bg-emerald-400/10 text-emerald-200"}`}><Flame size={23} /></span><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Fire alarm</p><h3 className={`mt-1 text-xl font-semibold ${fireOn ? "text-rose-100" : "text-emerald-100"}`}>{fireOn ? "ON" : "OFF"}</h3></div></div><span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${fireOn ? "bg-rose-500/20 text-rose-200" : "bg-emerald-400/10 text-emerald-200"}`}>{fireOn ? "ACTIVE" : "NORMAL"}</span></div>
    <div className="mt-4 grid gap-3 md:grid-cols-3"><div className="rounded-xl bg-black/10 p-3"><p className="text-xs text-slate-500">Smoke exposure meter</p><p className={`mt-1 text-lg font-semibold ${remaining != null && remaining <= 0 ? "text-rose-200" : "text-white"}`}>{exposureText}</p><p className="mt-1 text-[11px] text-slate-500">Configured limit: {environment.gasExposureSeconds ?? "—"}s</p></div><div className="rounded-xl bg-black/10 p-3"><p className="text-xs text-slate-500">Trigger reason</p><p className={`mt-1 text-sm font-medium ${environment.triggerReason || fireOn ? "text-rose-100" : "text-slate-200"}`}>{environment.triggerReason || (exposureReached ? "Long smoke exposure" : fireOn ? "Fire condition detected" : "No active event")}</p></div><div className="rounded-xl bg-black/10 p-3"><p className="text-xs text-slate-500">Current smoke / gas</p><p className="mt-1 text-lg font-semibold text-white">{environment.smoke ?? "—"}</p><p className="mt-1 text-[11px] text-slate-500">Latest sensor reading</p></div></div>
  </section>;
}
