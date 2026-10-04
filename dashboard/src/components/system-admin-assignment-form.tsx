"use client";

type Warehouse = { id: string; name: string; system_admin_id: string | null };
type Profile = { id: string; display_name: string | null };

export function SystemAdminAssignmentForm({
  warehouse,
  profiles,
  action,
}: {
  warehouse: Warehouse;
  profiles: Profile[];
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <form
      action={action}
      className="grid gap-3 rounded-xl border border-white/10 bg-[#10233d] p-4 md:grid-cols-[1fr_1fr_auto] md:items-end"
      onSubmit={(event) => {
        const form = event.currentTarget;
        const select = form.elements.namedItem("systemAdminId") as HTMLSelectElement;
        const selected = select.options[select.selectedIndex]?.text ?? "Unassigned";
        if (!window.confirm(`Assign ${selected} to ${warehouse.name}?`)) event.preventDefault();
      }}
    >
      <input type="hidden" name="warehouseId" value={warehouse.id} />
      <label className="block text-xs text-slate-400">
        Warehouse
        <input value={warehouse.name} readOnly className="mt-2 w-full rounded-lg border border-white/10 bg-[#0b1d34] px-3 py-2.5 text-sm text-slate-300" />
      </label>
      <label className="block text-xs text-slate-400">
        System Admin
        <select name="systemAdminId" defaultValue={warehouse.system_admin_id ?? ""} className="mt-2 w-full rounded-lg border border-white/10 bg-[#0b1d34] px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300">
          <option value="">Unassigned</option>
          {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.display_name ?? "Unnamed profile"}</option>)}
        </select>
      </label>
      <button className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500">Save assignment</button>
    </form>
  );
}
