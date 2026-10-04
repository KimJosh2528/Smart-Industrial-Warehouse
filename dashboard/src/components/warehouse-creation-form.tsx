"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { CreateWarehouseState } from "@/app/admin/system-admins/actions";

const initialState: CreateWarehouseState = { success: false, message: "" };

export function WarehouseCreationForm({
  profiles,
  action,
}: {
  profiles: { id: string; display_name: string | null }[];
  action: (formData: FormData) => Promise<CreateWarehouseState>;
}) {
  const router = useRouter();
  const [state, submit, pending] = useActionState(
    async (_previous: CreateWarehouseState, formData: FormData) => action(formData),
    initialState,
  );

  useEffect(() => {
    if (state.success) router.refresh();
  }, [router, state.success]);

  return (
    <form action={submit} className="grid gap-3 rounded-xl border border-white/10 bg-[#10233d] p-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
      <label className="block text-xs text-slate-400">
        Warehouse name
        <input name="name" required className="mt-2 w-full rounded-lg border border-white/10 bg-[#0b1d34] px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300" />
      </label>
      <label className="block text-xs text-slate-400">
        System Admin
        <select name="systemAdminId" required defaultValue="" className="mt-2 w-full rounded-lg border border-white/10 bg-[#0b1d34] px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300">
          <option value="" disabled>Select a System Admin</option>
          {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.display_name ?? "Unnamed profile"}</option>)}
        </select>
      </label>
      <button type="submit" disabled={pending || !profiles.length} className="rounded-lg bg-cyan-500/15 px-4 py-2.5 text-sm font-medium text-cyan-100 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-50">
        {pending ? "Creating..." : "Create warehouse"}
      </button>
      {state.message && <p className={`text-xs md:col-span-3 ${state.success ? "text-emerald-300" : "text-rose-300"}`}>{state.message}</p>}
    </form>
  );
}
