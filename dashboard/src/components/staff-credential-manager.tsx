import { Radio } from "lucide-react";
import type { StaffListItem } from "@/lib/staff-data";

export function StaffCredentialManager({ staff }: { staff: StaffListItem }) {
  const hasRfid = staff.credentials.some((credential) => credential.credential_type === "staff_rfid" && credential.is_active);
  const label = hasRfid ? "RFID only" : "No credentials";

  return <section className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
    <div className="mb-3 flex items-center justify-between">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">Credentials</p>
      <span className="rounded-full bg-cyan-400/10 px-2.5 py-1 text-[11px] text-cyan-200">{label}</span>
    </div>
    <div className="flex flex-wrap gap-2 text-xs text-slate-300">
      {hasRfid && <span className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-[#10233d] px-2.5 py-2"><Radio size={14} className="text-cyan-300" /> RFID assigned</span>}
      {!hasRfid && <span className="text-slate-500">No active RFID credential assigned.</span>}
    </div>
  </section>;
}
