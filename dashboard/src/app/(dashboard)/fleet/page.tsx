import { AddDriverForm } from "@/components/add-driver-form";
import { AddTruckForm } from "@/components/add-truck-form";
import { AccountClaimManager } from "@/components/account-claim-manager";
import { DriverAssignmentManager } from "@/components/driver-assignment-manager";
import { TruckCredentialManager } from "@/components/truck-credential-manager";
import { TruckEditor } from "@/components/truck-editor";
import { loadDriverData } from "@/lib/drivers-data";
import { loadTruckData } from "@/lib/trucks-data";
import { invokeDriverAccountRequest, revokeDriverAccountRequest } from "@/app/drivers/actions";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }

export default async function FleetPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const tab = one(params.tab) === "trucks" ? "trucks" : "drivers";
  const q = one(params.q).toLowerCase().trim();
  const [drivers, trucks] = await Promise.all([loadDriverData(), loadTruckData()]);
  return <><header className="mb-7"><p className="text-xs font-medium uppercase tracking-[0.18em] text-cyan-300/80">People &amp; fleet</p><h1 className="mt-1 text-2xl font-semibold text-white">Driver &amp; Truck Management</h1><p className="mt-2 max-w-2xl text-sm text-slate-400">Manage human drivers, truck identity, assignment, division, and access credentials in one workspace.</p></header><nav className="mb-7 flex gap-1 rounded-xl border border-white/10 bg-[#0b1d34] p-1.5" aria-label="Fleet sections"><a href="/fleet?tab=drivers" className={`rounded-lg px-4 py-2.5 text-sm font-medium transition ${tab === "drivers" ? "bg-cyan-400/15 text-cyan-100" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}>Drivers</a><a href="/fleet?tab=trucks" className={`rounded-lg px-4 py-2.5 text-sm font-medium transition ${tab === "trucks" ? "bg-orange-400/15 text-orange-100" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}>Trucks</a></nav>{tab === "drivers" ? <DriversPanel data={drivers} q={q} /> : <TrucksPanel data={trucks} q={q} />}</>;
}

function DriversPanel({ data, q }: { data: Awaited<ReturnType<typeof loadDriverData>>; q: string }) {
  const rows = data.rows.filter((row) => !q || row.display_name.toLowerCase().includes(q) || (row.driver_code ?? "").toLowerCase().includes(q));
  return <><div className="mb-5"><AddDriverForm warehouses={data.warehouses} /></div><ListHeader label="Drivers" q={q} /><section className="space-y-3" aria-label="Drivers">{rows.map((row) => <article key={row.id} className="rounded-2xl border border-white/10 bg-[#0b1d34] p-4 sm:p-5"><div className="grid gap-5 lg:grid-cols-[1.1fr_0.8fr_1.2fr_auto] lg:items-start"><div><p className="text-base font-semibold text-white">{row.display_name}</p><p className="mt-1 text-xs text-slate-500">{row.driver_code ?? "No driver code"}</p><p className="mt-1 text-xs text-slate-500">{row.warehouse_name}</p></div><div className="flex flex-wrap gap-2 text-[11px]"><StatusBadge active={row.is_active} yes="Active" no="Inactive" /><StatusBadge active={Boolean(row.profile_id)} yes="Claimed" no="Unclaimed" /></div><div><p className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">Truck assignment</p><DriverAssignmentManager driver={row} /></div><div className="lg:text-right"><AccountClaimManager kind="driver" targetId={row.id} profileId={row.profile_id} claim={row.account_claim} invokeAction={invokeDriverAccountRequest} revokeAction={revokeDriverAccountRequest} /></div></div></article>)}{!rows.length && <EmptyState text="No matching drivers." />}</section></>;
}

function TrucksPanel({ data, q }: { data: Awaited<ReturnType<typeof loadTruckData>>; q: string }) {
  const rows = data.rows.filter((row) => !q || row.identity_label.toLowerCase().includes(q) || row.plate_number.toLowerCase().includes(q));
  return <><div className="mb-5"><AddTruckForm warehouses={data.warehouses} /></div><ListHeader label="Trucks" q={q} /><section className="space-y-3" aria-label="Trucks">{rows.map((row) => <article key={row.id} className="rounded-2xl border border-white/10 bg-[#0b1d34] p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-base font-semibold text-white">{row.identity_label}</p><p className="mt-1 text-sm text-slate-300">{row.plate_number}</p><p className="mt-1 text-xs text-slate-500">{row.warehouse_name} · {row.division ?? "Division not assigned"}</p></div><div className="flex flex-wrap items-center gap-2 text-[11px]"><StatusBadge active={row.is_active} yes="Active" no="Inactive" /><span className="rounded-full border border-white/10 px-2.5 py-1 text-slate-400">Driver: {row.assigned_driver_name ?? "Unassigned"}</span></div></div><div className="mt-4 border-t border-white/[0.06] pt-4"><TruckEditor truck={row} /></div><TruckCredentialManager truck={row} /></article>)}{!rows.length && <EmptyState text="No matching trucks." />}</section></>;
}

function ListHeader({ label, q }: { label: string; q: string }) { return <form method="get" className="mb-3 flex flex-wrap items-center justify-between gap-3"><input type="hidden" name="tab" value={label === "Trucks" ? "trucks" : "drivers"} /><div><h2 className="text-sm font-semibold text-white">{label}</h2><p className="mt-1 text-xs text-slate-500">Search by {label === "Trucks" ? "identity label or plate number" : "name or driver code"}.</p></div><div className="flex w-full gap-2 sm:w-auto"><input name="q" defaultValue={q} placeholder={`Search ${label.toLowerCase()}`} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#10233d] px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300 sm:w-64" /><button className="rounded-lg border border-white/10 px-4 py-2.5 text-sm text-slate-200 hover:bg-white/5">Search</button></div></form>; }
function StatusBadge({ active, yes, no }: { active: boolean; yes: string; no: string }) { return <span className={`rounded-full px-2.5 py-1 ${active ? "bg-emerald-400/10 text-emerald-300" : "bg-white/[0.06] text-slate-400"}`}>{active ? yes : no}</span>; }
function EmptyState({ text }: { text: string }) { return <div className="rounded-2xl border border-dashed border-white/10 bg-[#0b1d34]/60 px-5 py-14 text-center text-sm text-slate-400">{text}</div>; }
