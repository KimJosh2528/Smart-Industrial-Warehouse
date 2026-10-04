"use client";

import { Menu } from "lucide-react";
import { useState } from "react";
import { DashboardSidebar } from "./dashboard-sidebar";

export function DashboardShell({ children, displayName, role }: { children: React.ReactNode; displayName: string; role: "father_admin" | "system_admin" | null }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  return <div className="min-h-screen bg-[#061223] text-slate-100"><DashboardSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} displayName={displayName} role={role} /><main className="lg:pl-[250px]"><div className="flex items-center border-b border-white/[0.07] px-5 py-3 sm:px-8 lg:hidden"><button aria-label="Open navigation" className="rounded-lg border border-white/10 p-2 text-slate-300" onClick={() => setSidebarOpen(true)}><Menu size={18} /></button></div><div className="mx-auto max-w-[1440px] p-5 sm:p-8">{children}</div></main></div>;
}
