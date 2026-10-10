import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { approveSystemAdminApplication, rejectSystemAdminApplication, regenerateSystemAdminClaimLink, reserveDeviceForApplication } from "@/app/admin/system-admins/actions";
import { SystemAdminApplicationReview } from "@/components/system-admin-application-review";

type Application = { id: string; applicant_name: string; applicant_email: string; valid_id_url: string; facebook_profile_url: string; status: string; rejection_reason: string | null; warehouse_id: string | null; created_at: string; assigned_device_id: string | null; assigned_device_name: string | null; device_assignment_status: string | null };
type Device = { id: string; name: string; device_type: string; serial_number: string | null; lifecycle_status: string };

export default async function ApplicationsPage() {
  const client = await createClient();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) redirect("/login");
  const { data: profile } = await client.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (profile?.role !== "father_admin") redirect("/");
  const [{ data: applications }, { data: devices }] = await Promise.all([
    client.rpc("list_system_admin_applications"),
    client.from("devices").select("id,name,device_type,serial_number,lifecycle_status").is("warehouse_id", null).eq("lifecycle_status", "vacant").order("name"),
  ]);
  const rows = (applications ?? []) as Application[];
  return <section className="mx-auto max-w-5xl"><p className="text-xs font-medium uppercase tracking-[0.18em] text-cyan-300/80">Father Admin · Platform Administration</p><h1 className="mt-2 text-3xl font-semibold text-white">System Admin Applications</h1><p className="mt-2 text-sm text-slate-400">Review applications, verify identity, approve ownership, and assign a device.</p><div className="mt-6 space-y-3">{rows.filter((application) => !(application.status === "approved" && application.warehouse_id)).map((application) => <SystemAdminApplicationReview key={application.id} application={application} devices={(devices ?? []) as Device[]} approve={approveSystemAdminApplication} reject={rejectSystemAdminApplication} reserveDevice={reserveDeviceForApplication} regenerateLink={regenerateSystemAdminClaimLink} />)}{!rows.some((application) => !(application.status === "approved" && application.warehouse_id)) && <p className="rounded-xl border border-white/10 bg-[#0b1d34] px-4 py-8 text-center text-sm text-slate-500">No pending applications.</p>}</div></section>;
}
