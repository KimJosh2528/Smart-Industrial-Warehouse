import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { approveSystemAdminApplication, rejectSystemAdminApplication } from "@/app/admin/system-admins/actions";
import { SystemAdminApplicationReview } from "@/components/system-admin-application-review";

type SearchParams = Promise<{ status?: string }>;
type SystemAdminApplication = { id: string; applicant_name: string; applicant_email: string; valid_id_url: string; facebook_profile_url: string; requested_warehouse_name: string; status: string; created_at: string };

export default async function SystemAdminsPage({ searchParams }: { searchParams: SearchParams }) {
  const client = await createClient();
  const { data: authData } = await client.auth.getUser();
  if (!authData.user) redirect("/login");

  const { data: profile } = await client.from("profiles").select("role").eq("id", authData.user.id).maybeSingle();
  if (profile?.role !== "father_admin") redirect("/");

  const [{ data: warehouses }, { data: applications }] = await Promise.all([
    client.from("warehouses").select("id,name,system_admin_id").order("name"),
    client.rpc("list_system_admin_applications"),
  ]);
  const status = (await searchParams).status;
  const systemAdminApplications = (applications ?? []) as SystemAdminApplication[];

  return <section className="mx-auto max-w-5xl">
    <p className="text-xs font-medium uppercase tracking-[0.18em] text-cyan-300/80">Father Admin · Platform Administration</p>
    <h1 className="mt-2 text-3xl font-semibold text-white">System Admin Provisioning</h1>
    <p className="mt-2 text-sm text-slate-400">Review applications, approve ownership, and issue a one-time claim for exactly one warehouse.</p>
    {status === "success" && <p className="mt-5 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">Assignment saved.</p>}
    {status === "error" && <p className="mt-5 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">The assignment was rejected by the server.</p>}
    <div className="mt-6 space-y-4">
      <div className="space-y-3"><h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-400">Pending applications</h2>{systemAdminApplications.filter((application) => application.status === "pending").map((application) => <SystemAdminApplicationReview key={application.id} application={application} approve={approveSystemAdminApplication} reject={rejectSystemAdminApplication} />)}{!systemAdminApplications.some((application) => application.status === "pending") && <p className="rounded-xl border border-white/10 bg-[#0b1d34] px-4 py-5 text-sm text-slate-400">No pending applications.</p>}</div>
      <h2 className="pt-3 text-sm font-semibold uppercase tracking-[0.14em] text-slate-400">Current one-to-one assignments</h2>
      {(warehouses ?? []).map((warehouse) => <div key={warehouse.id} className="rounded-xl border border-white/10 bg-[#10233d] p-4 text-sm text-slate-300"><span className="font-medium text-white">{warehouse.name}</span><span className="ml-2 text-slate-500">{warehouse.system_admin_id ? "Assigned to a System Admin" : "Pending System Admin claim"}</span></div>)}
      {!warehouses?.length && <p className="rounded-xl border border-white/10 bg-[#0b1d34] px-4 py-8 text-center text-sm text-slate-400">No warehouses are available.</p>}
    </div>
  </section>;
}
