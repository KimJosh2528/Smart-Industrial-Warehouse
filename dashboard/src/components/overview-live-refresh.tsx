"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";

export function OverviewLiveRefresh() {
  const router = useRouter();
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    const timer = window.setInterval(refresh, 2000);
    setOnline(navigator.onLine);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => { window.clearInterval(timer); window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
  }, [router]);
  return <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs ${online ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-200" : "border-rose-300/20 bg-rose-400/10 text-rose-200"}`}><span className={`h-2 w-2 rounded-full ${online ? "bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.8)]" : "bg-rose-300"}`} />{online ? "System online" : "Offline"}<RefreshCw size={13} className="opacity-70" /> <span className="hidden sm:inline">Auto refresh 2s</span></span>;
}
