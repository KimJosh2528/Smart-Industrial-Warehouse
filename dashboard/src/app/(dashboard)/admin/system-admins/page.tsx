import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { assignSystemAdmin, createWarehouse, promoteProfileToSystemAdmin } from "@/app/admin/system-admins/actions";
import { SystemAdminAssignmentForm } from "@/components/system-admin-assignment-form";
import { ProfilePromotionForm } from "@/components/profile-promotion-form";
import { WarehouseCreationForm } from "@/components/warehouse-creation-form";

type SearchParams = Promise<{ status?: string }>;

export default async function SystemAdminsPage({ searchParams }: { searchParams: SearchParams }) {
  const client = await createClient();
  const { data: authData } = await client.auth.getUser();
  if (!authData.user) redirect("/login");

  const { data: profile } = await client.from("profiles").select("role").eq("id", authData.user.id).maybeSingle();
  if (profile?.role !== "father_admin") redirect("/");

  const [{ data: warehouses }, { data: profiles }, { data: unassignedProfiles }] = await Promise.all([
    client.from("warehouses").select("id,name,system_admin_id").order("name"),
    client.from("profiles").select("id,display_name").eq("role", "system_admin").order("display_name"),
    client.from("profiles").select("id,display_name").is("role", null).order("display_name"),
  ]);
  const status = (await searchParams).status;

  return <section className="mx-auto max-w-5xl">
    <p className="text-xs font-medium uppercase tracking-[0.18em] text-cyan-300/80">Father Admin · Platform Administration</p>
    <h1 className="mt-2 text-3xl font-semibold text-white">System Admin Provisioning</h1>
    <p className="mt-2 text-sm text-slate-400">Promote eligible profiles to System Admin, then assign each administrator to at most one warehouse.</p>
    {status === "success" && <p className="mt-5 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">Assignment saved.</p>}
    {status === "error" && <p className="mt-5 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">The assignment was rejected by the server.</p>}
    {!profiles?.length && <p className="mt-5 rounded-xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">No System Admin profiles are currently eligible.</p>}
    <div className="mt-6 space-y-4">
      <div className="space-y-3"><h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-400">Create warehouse</h2><WarehouseCreationForm profiles={profiles ?? []} action={createWarehouse} /></div>
      <div className="space-y-3"><h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-400">Eligible profiles</h2>{(unassignedProfiles ?? []).map((candidate) => <ProfilePromotionForm key={candidate.id} profile={candidate} action={promoteProfileToSystemAdmin} />)}{!unassignedProfiles?.length && <p className="rounded-xl border border-white/10 bg-[#0b1d34] px-4 py-5 text-sm text-slate-400">No unassigned profiles are available.</p>}</div>
      <h2 className="pt-3 text-sm font-semibold uppercase tracking-[0.14em] text-slate-400">Warehouse assignments</h2>
      {(warehouses ?? []).map((warehouse) => <SystemAdminAssignmentForm key={warehouse.id} warehouse={warehouse} profiles={profiles ?? []} action={assignSystemAdmin} />)}
      {!warehouses?.length && <p className="rounded-xl border border-white/10 bg-[#0b1d34] px-4 py-8 text-center text-sm text-slate-400">No warehouses are available.</p>}
    </div>
  </section>;
}
