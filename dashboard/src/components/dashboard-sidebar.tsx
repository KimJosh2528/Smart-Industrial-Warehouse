"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Shield } from "lucide-react";
import { dashboardNavigation } from "@/lib/dashboard-navigation";
import { SignOutButton } from "./sign-out-button";

export function DashboardSidebar({ open, onClose, displayName, role }: { open: boolean; onClose: () => void; displayName: string; role: "father_admin" | "system_admin" | null }) {
  const pathname = usePathname();
  const roleLabel = role === "father_admin" ? "Father Admin" : role === "system_admin" ? "System Admin" : "Administrator";
  const visibleNavigation = dashboardNavigation.filter((item) => !item.fatherAdminOnly || role === "father_admin");
  const sections = visibleNavigation.reduce<Array<{ name: string; items: typeof visibleNavigation }>>((groups, item) => {
    const group = groups.find((candidate) => candidate.name === item.section);
    if (group) group.items.push(item);
    else groups.push({ name: item.section, items: [item] });
    return groups;
  }, []);
  return <>
    {open && <button aria-label="Close navigation" className="fixed inset-0 z-20 bg-black/50 lg:hidden" onClick={onClose} />}
    <aside className={`fixed inset-y-0 left-0 z-30 flex h-screen w-[250px] flex-col overflow-hidden border-r border-white/[0.07] bg-[#08172b] px-4 py-6 transition-transform lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="mb-8 shrink-0 flex items-center gap-3 px-2"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-400 to-indigo-600"><Shield size={22} /></span><div><p className="text-sm font-semibold leading-5 text-white">Smart Industrial<br />Warehouse</p><p className="text-[10px] text-slate-400">Access &amp; Safety System</p></div></div>
      <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">{sections.map((section) => <div key={section.name}><p className="mb-2 px-2 text-[10px] font-semibold tracking-[0.16em] text-slate-500">{section.name}</p>{section.items.map((item) => { const active = !item.pending && (item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`)); const Icon = item.icon; return item.pending ? <div key={item.href} aria-disabled="true" className="flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-3 text-[13px] text-slate-500"><Icon size={18} strokeWidth={1.8} /><span className="flex-1">{item.label}</span><span className="text-[9px] uppercase tracking-wider text-slate-600">Pending</span></div> : <Link key={item.href} href={item.href} onClick={onClose} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-[13px] ${active ? "bg-blue-600/35 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white"}`}><Icon size={18} strokeWidth={1.8} /><span>{item.label}</span></Link>; })}</div>)}</nav>
      <div className="mt-auto border-t border-white/[0.07] pt-5"><div className="flex items-center gap-3 px-2"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-slate-300 to-slate-500 text-sm font-semibold text-slate-900">{displayName.charAt(0).toUpperCase()}</span><div className="min-w-0"><p className="truncate text-xs font-medium text-white">{displayName}</p><p className="text-[10px] text-slate-500">{roleLabel}</p></div></div><SignOutButton /></div>
    </aside>
  </>;
}
