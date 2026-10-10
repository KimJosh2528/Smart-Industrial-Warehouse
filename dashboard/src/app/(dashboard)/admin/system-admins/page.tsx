import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { approveSystemAdminApplication, createDeviceInventory, deleteSystemAdminOwnership, regenerateSystemAdminClaimLink, rejectSystemAdminApplication, reserveDeviceForApplication } from "@/app/admin/system-admins/actions";
import { SystemAdminApplicationReview } from "@/components/system-admin-application-review";
import { DeleteOwnershipButton } from "@/components/delete-ownership-button";

type SearchParams = Promise<{ status?: string }>;
type SystemAdminApplication = { id: string; applicant_name: string; applicant_email: string; valid_id_url: string; facebook_profile_url: string; status: string; rejection_reason: string | null; warehouse_id: string | null; created_at: string };
type AvailableDevice = { id: string; name: string; device_type: string; serial_number: string | null; lifecycle_status: string };

export default async function SystemAdminsPage({ searchParams }: { searchParams: SearchParams }) {
  redirect("/admin/system-admins/applications");
  /* Legacy combined provisioning page retained only for compatibility. */
  /* istanbul ignore next */
  if (false) {
  const client = await createClient();
  const { data: authData } = await client.auth.getUser();
  if (!authData.user) redirect("/login");

  const { data: profile } = await client.from("profiles").select("role").eq("id", authData.user!.id).maybeSingle();
  if (profile?.role !== "father_admin") redirect("/");

  const [{ data: warehouses }, { data: applications }, { data: devices }] = await Promise.all([
    client.from("warehouses").select("id,name,system_admin_id").order("name"),
    client.rpc("list_system_admin_applications"),
    client.from("devices").select("id,name,device_type,serial_number,lifecycle_status").is("warehouse_id", null).eq("lifecycle_status", "vacant").order("name"),
  ]);
  const status = (await searchParams).status;
  const systemAdminApplications = (applications ?? []) as SystemAdminApplication[];

  return <section className="mx-auto max-w-5xl">
    <p className="text-xs font-medium uppercase tracking-[0.18em] text-cyan-300/80">Father Admin · Platform Administration</p>
    <h1 className="mt-2 text-3xl font-semibold text-white">System Admin Provisioning</h1>
    <p className="mt-2 text-sm text-slate-400">Review applications, approve ownership, and issue a one-time claim for exactly one warehouse.</p>
    {(status === "success" || status === "device-created" || status === "device-assigned" || status === "ownership-deleted") && <p className="mt-5 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">{status === "device-created" ? "Device inventory created." : status === "device-assigned" ? "Device assigned to the approved application." : status === "ownership-deleted" ? "Ownership deleted and resources are available again." : "Assignment saved."}</p>}
    {status === "error" && <p className="mt-5 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">The assignment was rejected by the server.</p>}
    <div className="mt-6 space-y-4">
      <div className="space-y-3"><h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-400">System Admin Applications</h2>{systemAdminApplications.filter((application) => !(application.status === "approved" && application.warehouse_id)).map((application) => <SystemAdminApplicationReview key={application.id} application={application} devices={(devices ?? []) as AvailableDevice[]} approve={approveSystemAdminApplication} reject={rejectSystemAdminApplication} reserveDevice={reserveDeviceForApplication} regenerateLink={regenerateSystemAdminClaimLink} />)}{!systemAdminApplications.some((application) => !(application.status === "approved" && application.warehouse_id)) && <p className="rounded-xl border border-white/10 bg-[#0b1d34] px-4 py-5 text-sm text-slate-400">No pending applications.</p>}</div>
      <section className="rounded-xl border border-cyan-300/20 bg-[#10233d] p-4"><h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-cyan-200">Device Inventory</h2><p className="mt-1 text-xs text-slate-400">Create vacant devices here. They can be assigned to an approved System Admin application above.</p><form action={createDeviceInventory} className="mt-4 flex flex-wrap gap-3"><input name="name" required placeholder="Device name (example: Device 1)" className="min-w-64 flex-1 rounded-lg border border-white/10 bg-[#0b1d34] px-3 py-2 text-sm text-white" /><button className="rounded-lg bg-cyan-400 px-3 py-2 text-sm font-semibold text-slate-950">Create vacant device</button></form><div className="mt-4 border-t border-white/10 pt-4"><h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Available devices</h3>{devices?.length ? <div className="mt-2 space-y-2">{(devices as AvailableDevice[]).map((device) => <div key={device.id} className="flex items-center justify-between rounded-lg bg-[#0b1d34] px-3 py-2 text-sm"><span className="font-medium text-white">{device.name}</span><span className="text-xs text-emerald-300">Vacant</span></div>)}</div> : <p className="mt-2 text-xs text-slate-500">No vacant devices available.</p>}</div></section>
      <h2 className="pt-3 text-sm font-semibold uppercase tracking-[0.14em] text-slate-400">Current one-to-one assignments</h2>
      {(warehouses ?? []).map((warehouse) => { const owner = systemAdminApplications.find((application) => application.warehouse_id === warehouse.id); return <div key={warehouse.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-[#10233d] p-4 text-sm text-slate-300"><div><span className="font-medium text-white">{warehouse.name}</span><span className="ml-2 text-slate-500">{warehouse.system_admin_id ? <>Assigned to <strong className="text-white">{owner?.applicant_name ?? "System Admin"}</strong></> : "Pending System Admin claim"}</span></div><DeleteOwnershipButton warehouseId={warehouse.id} action={deleteSystemAdminOwnership} /></div>; })}
      {!warehouses?.length && <p className="rounded-xl border border-white/10 bg-[#0b1d34] px-4 py-8 text-center text-sm text-slate-400">No warehouses are available.</p>}
    </div>
  </section>;
  }
}
