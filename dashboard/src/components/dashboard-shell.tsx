"use client";

import { Menu } from "lucide-react";
import { useState } from "react";
import { DashboardSidebar } from "./dashboard-sidebar";
import type { PlatformRole } from "@/lib/warehouse-scope";

export function DashboardShell({ children, displayName, role, warehouseContext, assignmentContext }: { children: React.ReactNode; displayName: string; role: PlatformRole; warehouseContext: string | null; assignmentContext: string | null }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  return <div className="min-h-screen bg-[#061223] text-slate-100"><DashboardSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} displayName={displayName} role={role} warehouseContext={warehouseContext} assignmentContext={assignmentContext} /><main className="lg:pl-[250px]"><div className="flex items-center border-b border-white/[0.07] px-5 py-3 sm:px-8 lg:hidden"><button aria-label="Open navigation" className="rounded-lg border border-white/10 p-2 text-slate-300" onClick={() => setSidebarOpen(true)}><Menu size={18} /></button></div><div className="mx-auto max-w-[1440px] p-5 sm:p-8">{children}</div></main></div>;
}
