import type { TruckListItem } from "@/lib/trucks-data";

export function TruckEditor({ truck }: { truck: TruckListItem }) {
  return <div className="mt-4 grid gap-3 rounded-xl border border-white/[0.06] bg-white/[0.025] p-4 sm:grid-cols-2">
    <div><p className="text-xs text-slate-400">Identity label</p><p className="mt-2 rounded-lg border border-white/10 bg-[#10233d] px-3 py-2 text-sm text-slate-200">{truck.identity_label}</p></div>
    <div><p className="text-xs text-slate-400">Plate number <span className="text-slate-600">(registered identity)</span></p><p className="mt-2 rounded-lg border border-white/10 bg-[#10233d]/60 px-3 py-2 text-sm text-slate-500">{truck.plate_number}</p></div>
    <div><p className="text-xs text-slate-400">Primary authentication</p><p className="mt-2 rounded-lg border border-cyan-300/20 bg-cyan-400/5 px-3 py-2 text-sm text-cyan-200">Truck plate</p></div>
  </div>;
}
