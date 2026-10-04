"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { PromoteSystemAdminState } from "@/app/admin/system-admins/actions";

const initialState: PromoteSystemAdminState = { success: false, message: "" };

export function ProfilePromotionForm({
  profile,
  action,
}: {
  profile: { id: string; display_name: string | null };
  action: (formData: FormData) => Promise<PromoteSystemAdminState>;
}) {
  const router = useRouter();
  const [state, submit, pending] = useActionState(
    async (_previous: PromoteSystemAdminState, formData: FormData) => action(formData),
    initialState,
  );

  useEffect(() => {
    if (state.success) router.refresh();
  }, [router, state.success]);

  return (
    <form action={submit} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#10233d] p-4">
      <div>
        <p className="text-sm font-medium text-white">{profile.display_name ?? "Unnamed profile"}</p>
        <p className="mt-1 text-xs text-slate-500">Unassigned profile</p>
        {state.message && <p className={`mt-2 text-xs ${state.success ? "text-emerald-300" : "text-rose-300"}`}>{state.message}</p>}
      </div>
      <input type="hidden" name="profileId" value={profile.id} />
      <button type="submit" disabled={pending} className="rounded-lg bg-cyan-500/15 px-4 py-2.5 text-sm font-medium text-cyan-100 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-50">
        {pending ? "Promoting..." : "Promote to System Admin"}
      </button>
    </form>
  );
}
