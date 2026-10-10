"use client";

import { useEffect, useState } from "react";
import { Camera, CircleAlert, Video } from "lucide-react";

type ConnectionState = "checking" | "online" | "offline";
type VerificationState = "ready" | "checking" | "authorized" | "unauthorized" | "error";
type CameraLastResponse = { busy?: boolean; text?: string };

function resultLabel(text: string) {
  if (text.startsWith("OK")) return { state: "authorized" as const, detail: text.replace(/^OK\s*/, "") };
  if (text.startsWith("DENY")) return { state: "unauthorized" as const, detail: text.replace(/^DENY\s*/, "") };
  if (text.startsWith("ERR")) return { state: "error" as const, detail: text };
  return { state: "ready" as const, detail: text };
}

export function OverviewCameraCard({ cameraUrl }: { cameraUrl: string }) {
  const [online, setOnline] = useState<ConnectionState>("checking");
  const [verification, setVerification] = useState<VerificationState>("ready");
  const [verificationDetail, setVerificationDetail] = useState("");
  const base = cameraUrl.replace(/\/$/, "");

  useEffect(() => {
    let cancelled = false;
    const pollResult = async () => {
      try {
        const response = await fetch(`${base}/last`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as CameraLastResponse;
        if (cancelled) return;
        if (payload.busy) {
          setVerification("checking");
          setVerificationDetail("ESP button received; reading plate...");
          return;
        }
        const text = String(payload.text ?? "");
        if (!text) {
          setVerification("ready");
          setVerificationDetail("");
          return;
        }
        const result = resultLabel(text);
        setVerification(result.state);
        setVerificationDetail(result.detail);
      } catch {
        // The image stream owns the camera connection indicator.
      }
    };
    void pollResult();
    const timer = window.setInterval(pollResult, 500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [base]);

  const verificationStyle = {
    ready: "border-slate-500/30 bg-slate-400/10 text-slate-300",
    checking: "border-amber-300/30 bg-amber-400/10 text-amber-200",
    authorized: "border-emerald-300/30 bg-emerald-400/10 text-emerald-200",
    unauthorized: "border-rose-300/30 bg-rose-400/10 text-rose-200",
    error: "border-rose-300/30 bg-rose-400/10 text-rose-200",
  }[verification];
  const verificationTitle = {
    ready: "READY — press GPIO35",
    checking: "CHECKING PLATE...",
    authorized: "AUTHORIZED",
    unauthorized: "UNAUTHORIZED",
    error: "CHECK ERROR",
  }[verification];

  return (
    <section className="overflow-hidden rounded-2xl border border-cyan-300/15 bg-[#0b1d34] shadow-xl shadow-black/10">
      <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
        <div className="flex items-center gap-2"><Camera size={17} className="text-cyan-300" /><div><h2 className="text-sm font-semibold text-white">Truck Entrance · Camera</h2><p className="text-[11px] text-slate-500">Plate recognition preview</p></div></div>
        <span className={`rounded-full px-2.5 py-1 text-[11px] ${online === "online" ? "bg-emerald-500/15 text-emerald-300" : online === "offline" ? "bg-rose-500/15 text-rose-300" : "bg-amber-400/10 text-amber-200"}`}>{online === "online" ? "Online" : online === "offline" ? "Offline" : "Checking"}</span>
      </div>
      <div className="relative aspect-video bg-[#07172b]">
        <img src={`${base}/live.mjpg`} alt="Truck entrance camera preview" className="h-full w-full object-cover" onLoad={() => setOnline("online")} onError={() => setOnline("offline")} />
        {online === "offline" && <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#07172b] text-center"><CircleAlert size={28} className="text-rose-300" /><p className="mt-2 text-sm font-medium text-slate-300">Camera offline</p><p className="mt-1 text-xs text-slate-500">Check the camera server connection</p></div>}
      </div>
      <div className={`mx-4 mt-3 rounded-xl border px-3 py-2.5 ${verificationStyle}`}><div className="flex items-center justify-between gap-3"><span className="text-xs font-semibold tracking-wide">{verificationTitle}</span>{verification === "checking" && <span className="h-2 w-2 animate-pulse rounded-full bg-amber-200" />}</div>{verificationDetail && <p className="mt-1 truncate text-[11px] opacity-80">{verificationDetail}</p>}</div>
      <div className="flex items-center justify-between px-4 py-3 text-xs text-slate-500"><span className="inline-flex items-center gap-1.5"><Video size={13} />Truck plate mode</span><span>Live stream · local server</span></div>
    </section>
  );
}
