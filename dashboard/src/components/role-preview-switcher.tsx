"use client";

export type ViewAs = "father_admin" | "system_admin" | "staff" | "driver";

export function RolePreviewSwitcher({ viewAs, onChange, onExit }: { viewAs: ViewAs; onChange: (value: ViewAs) => void; onExit?: () => void }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.035] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[11px] text-slate-400">UI Preview / View As</p>
        {viewAs !== "father_admin" && <button type="button" onClick={onExit} className="text-[10px] text-cyan-300 hover:text-cyan-200">Exit Preview</button>}
      </div>
      <select aria-label="Preview application as" value={viewAs} onChange={(event) => onChange(event.target.value as ViewAs)} className="w-full rounded-lg border border-white/[0.06] bg-[#10233d] px-2 py-2 text-xs text-slate-200 outline-none focus:border-cyan-300">
        <option value="father_admin">Father Admin</option>
        <option value="system_admin">System Admin</option>
        <option value="staff">Staff</option>
        <option value="driver">Driver</option>
      </select>
      {viewAs !== "father_admin" && <p className="mt-2 text-[10px] leading-4 text-slate-500">Preview only. Your authenticated role and permissions remain Father Admin.</p>}
    </div>
  );
}
