"use client";

import { ShieldCheck } from "lucide-react";
import { createRfidPoolUid } from "@/app/credentials/actions";

export type CredentialPerson = { id: string; display_name: string };
export type CredentialTruck = { id: string; identity_label: string; plate_number: string };
export type CredentialWarehouse = { id: string; name: string };
export type RfidPoolRow = { id: string; warehouse_id: string; uid_label: string; credential_scope: "staff" | "guard" | "truck"; status: "vacant" | "reserved" | "assigned" };
export function CredentialManagementWorkspace({ staff, trucks, warehouses, rfidPool }: { staff: CredentialPerson[]; trucks: CredentialTruck[]; warehouses: CredentialWarehouse[]; rfidPool: RfidPoolRow[] }) {
  void staff; void trucks;
  const scopedPool = rfidPool.filter((row) => row.credential_scope === "staff");

  return <>
    <header className="mb-8"><p className="text-xs font-medium uppercase tracking-[0.2em] text-cyan-300/80">Warehouse Management</p><div className="mt-2"><h1 className="text-3xl font-semibold text-white">Credential Management</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Manage RFID UID pools by credential type. Assignment is handled in Member Applications.</p></div></header>
    <div className="rounded-2xl border border-white/10 bg-[#0b1d34] p-4"><div className="flex items-center gap-3 rounded-xl bg-blue-600 px-4 py-3 text-white"><span className="rounded-lg bg-white/15 p-2"><ShieldCheck size={18} /></span><span><span className="block text-sm font-semibold">Staff RFID</span><span className="block text-xs text-blue-100">One staff credential for the Staff Main Entrance</span></span></div></div>
    <div className="mt-5"><RfidPoolPanel warehouse={warehouses[0]} scope="staff" rows={scopedPool} /><CredentialRecords title="Staff RFID records" rfidRows={scopedPool} empty="No staff RFID records available yet" /></div>
  </>;
}

function RfidPoolPanel({ warehouse, scope, rows }: { warehouse?: CredentialWarehouse; scope: "staff" | "guard" | "truck"; rows: RfidPoolRow[] }) {
  const label = "Staff";
  const vacant = rows.filter((row) => row.status === "vacant").length;
  const acquired = rows.filter((row) => row.status !== "vacant").length;
  return <section className="rounded-2xl border border-cyan-300/15 bg-[#0b1d34] p-5"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300/80">{label} RFID</p><h2 className="mt-1 text-lg font-semibold text-white">Create RFID UID</h2><p className="mt-1 text-sm text-slate-400">Create pre-built {label.toLowerCase()} UIDs. Assignment happens in Member Applications.</p></div><div className="flex gap-2 text-xs"><span className="rounded-full bg-emerald-400/10 px-3 py-1.5 text-emerald-200">{vacant} vacant</span><span className="rounded-full bg-amber-400/10 px-3 py-1.5 text-amber-200">{acquired} acquired</span></div></div><form action={createRfidPoolUid} className="mt-4 grid gap-3 sm:grid-cols-[1.5fr_auto]"><input type="hidden" name="warehouseId" value={warehouse?.id ?? ""} /><input type="hidden" name="scope" value={scope} /><input name="uidLabel" required pattern="[0-9A-Fa-f]{8}|[0-9A-Fa-f]{14}" title="Use an 8- or 14-character hexadecimal RFID UID." placeholder="RFID UID (example: A1B2C3D4)" className="rounded-lg border border-white/10 bg-[#10233d] px-3 py-2.5 text-sm text-white" /><button disabled={!warehouse} className="rounded-lg bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50">Create {label} RFID</button></form></section>;
}

function CredentialRecords({ title, rfidRows, empty }: { title: string; rfidRows: RfidPoolRow[]; empty: string }) {
  const vacant = rfidRows.filter((row) => row.status === "vacant");
  const acquired = rfidRows.filter((row) => row.status !== "vacant");
  const list = (rows: RfidPoolRow[], tone: string) => rows.length ? <div className="flex flex-wrap gap-2">{rows.map((row) => <span key={row.id} className={`rounded-full px-3 py-1 text-xs ${tone}`}>{row.uid_label}</span>)}</div> : <p className="text-xs text-slate-500">None</p>;
  return <section className="mt-5 overflow-hidden rounded-2xl border border-cyan-300/15 bg-[#0b1d34]"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-4"><div><h2 className="text-xl font-semibold text-white">{title}</h2><p className="mt-1 text-sm text-slate-400">RFID pool status for this credential type.</p></div><span className="rounded-full bg-cyan-300/10 px-3 py-1.5 text-xs text-cyan-200">{acquired.length} acquired records</span></div><div className="grid gap-5 p-5 md:grid-cols-2"><div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-emerald-300">Vacant ({vacant.length})</p>{list(vacant, "bg-emerald-400/10 text-emerald-200")}</div><div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-amber-300">Acquired ({acquired.length})</p>{list(acquired, "bg-amber-400/10 text-amber-200")}</div></div>{!rfidRows.length && <div className="px-5 pb-5 text-center text-sm text-slate-500">{empty}</div>}</section>;
}
