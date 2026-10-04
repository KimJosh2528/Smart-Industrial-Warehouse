"use client";

import { Menu } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DashboardSidebar } from "./dashboard-sidebar";
import { RolePreviewSwitcher, type ViewAs } from "./role-preview-switcher";
import { WareGuardLogo } from "./wareguard-logo";

export function DashboardShell({ children, displayName, role, warehouseContext }: { children: React.ReactNode; displayName: string; role: "father_admin" | "system_admin" | null; warehouseContext: string | null }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const router = useRouter();
  const [viewAs, setViewAs] = useState<ViewAs>(role === "father_admin" ? "father_admin" : role ?? "staff");
  const previewing = role === "father_admin" && viewAs !== "father_admin";

  function changeView(value: ViewAs) {
    setViewAs(value);
    if (value !== "father_admin") router.replace("/");
  }

  if (previewing && (viewAs === "staff" || viewAs === "driver")) {
    return <PreviewPlaceholder kind={viewAs} onExit={() => changeView("father_admin")} />;
  }

  const activeView = role === "father_admin" ? viewAs : role ?? "staff";
  const previewTitle = activeView === "system_admin" ? "System Admin UI Preview" : null;
  return <div className="min-h-screen bg-[#061223] text-slate-100"><DashboardSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} displayName={displayName} role={role} viewAs={activeView} onViewAsChange={changeView} warehouseContext={warehouseContext} /><main className="lg:pl-[250px]"><div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-3 sm:px-8 lg:hidden"><button aria-label="Open navigation" className="rounded-lg border border-white/10 p-2 text-slate-300" onClick={() => setSidebarOpen(true)}><Menu size={18} /></button>{role === "father_admin" && <RolePreviewSwitcher viewAs={activeView} onChange={changeView} onExit={() => changeView("father_admin")} />}</div>{previewTitle && <div className="border-b border-cyan-400/20 bg-cyan-400/[0.06] px-5 py-3 text-xs text-cyan-100 sm:px-8"><span className="font-semibold">{previewTitle}</span><span className="ml-2 text-cyan-200/70">Visible UI only; authenticated role remains Father Admin.</span></div>}<div className="mx-auto max-w-[1440px] p-5 sm:p-8">{children}</div></main></div>;
}

function PreviewPlaceholder({ kind, onExit }: { kind: "staff" | "driver"; onExit: () => void }) {
  const label = kind === "staff" ? "Staff UI — Coming Soon" : "Driver UI — Coming Soon";
  return <main className="flex min-h-screen items-center justify-center bg-[#061223] px-5 text-slate-100"><section className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0b1d34] p-8 text-center shadow-2xl shadow-black/30"><div className="flex justify-center"><WareGuardLogo /></div><p className="mt-10 text-xs font-medium uppercase tracking-[0.18em] text-cyan-300/80">UI Preview</p><h1 className="mt-3 text-2xl font-semibold text-white">{label}</h1><p className="mt-3 text-sm leading-6 text-slate-400">This role-specific interface has not been implemented yet. No staff or driver permissions are granted by this preview.</p><button type="button" onClick={onExit} className="mt-8 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500">Back to Father Admin</button></section></main>;
}
