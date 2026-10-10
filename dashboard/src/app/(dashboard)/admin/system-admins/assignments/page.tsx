import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { deleteSystemAdminOwnership } from "@/app/admin/system-admins/actions";
import { DeleteOwnershipButton } from "@/components/delete-ownership-button";

export default async function AssignmentsPage() {
  const client = await createClient();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) redirect("/login");
  const { data: profile } = await client.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (profile?.role !== "father_admin") redirect("/");
  const [{ data: warehouses }, { data: applications }] = await Promise.all([
    client.from("warehouses").select("id,name,system_admin_id").order("name"),
    client.rpc("list_system_admin_applications"),
  ]);
  return <section className="mx-auto max-w-5xl"><p className="text-xs font-medium uppercase tracking-[0.18em] text-cyan-300/80">Father Admin · Platform Administration</p><h1 className="mt-2 text-3xl font-semibold text-white">Current Assignments</h1><p className="mt-2 text-sm text-slate-400">View one warehouse ownership assignment per System Admin.</p><div className="mt-6 space-y-3">{warehouses?.map((warehouse) => { const owner = (applications ?? []).find((application: { warehouse_id: string | null; applicant_name: string }) => application.warehouse_id === warehouse.id); return <div key={warehouse.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-[#10233d] p-5"><div><p className="font-medium text-white">{warehouse.name}</p><p className="mt-1 text-sm text-slate-400">Assigned to <strong className="text-white">{owner?.applicant_name ?? "System Admin"}</strong></p></div><DeleteOwnershipButton warehouseId={warehouse.id} action={deleteSystemAdminOwnership} /></div>; })}{!warehouses?.length && <p className="rounded-xl border border-white/10 bg-[#0b1d34] px-4 py-8 text-center text-sm text-slate-500">No current assignments.</p>}</div></section>;
}
