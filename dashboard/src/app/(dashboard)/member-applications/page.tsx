import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { finalizeDriverApplication, finalizeMemberApplication, saveMemberApplicationAccess } from "@/app/member-applications/actions";

type Application = {
  id: string;
  requested_role: "staff" | "guard" | "driver";
  applicant_name: string;
  applicant_email: string;
  valid_id_url: string;
  facebook_profile_url: string;
  requested_warehouse_name: string;
  status: string;
  camera_opt_in: boolean;
  face_capture_status: "not_requested" | "pending" | "ready" | "deleted";
  face_photo_count: number;
  guard_placement: "staff_entrance_guard" | "truck_entrance_guard" | null;
  permission_area_ids: string[];
  rfid_pool_id: string | null;
  rfid_uid: string | null;
  created_at: string;
};

type Area = { id: string; name: string; area_type_code: "staff_entrance" | "truck_entrance" | "room" };
type Tab = "staff" | "drivers";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type VacantRfid = { id: string; uid_label: string; credential_scope: string };
type RegisteredTruck = { id: string; identity_label: string; plate_number: string; division: "IMPORT" | "EXPORT" | null };

function one(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }

export default async function MemberApplicationsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const requestedTab = one(params.tab);
  const tab: Tab = requestedTab === "drivers" ? requestedTab : "staff";
  const client = await createClient();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) redirect("/login");
  const { data: profile } = await client.from("profiles").select("role").eq("id", auth.user.id).maybeSingle<{ role: string | null }>();
  if (profile?.role !== "system_admin") redirect("/");

  const [{ data, error }, { data: areas }, { data: vacantRfids }] = await Promise.all([
    client.rpc("list_warehouse_member_applications"),
    client.from("warehouse_areas").select("id,name,area_type_code").order("name"),
    client.rpc("list_vacant_rfid_uids_for_scope", { p_scope: "staff" }),
  ]);
  const { data: registeredTruckRows } = tab === "drivers"
    ? await client.from("trucks").select("id,identity_label,plate_number,division").eq("is_active", true).is("current_driver_id", null).order("identity_label")
    : { data: [] as RegisteredTruck[] };
  const applications = ((data ?? []) as Application[]).filter((application) => application.status === "pending" && application.requested_role === requestedRole(tab));
  const entranceAreas = ((areas ?? []) as Area[]).filter((area) => area.area_type_code === "staff_entrance");
  const rfids = (vacantRfids ?? []) as VacantRfid[];
  const registeredTrucks = (registeredTruckRows ?? []) as RegisteredTruck[];
  const accessStatus = one(params.access);

  return <section className="mx-auto max-w-7xl">
    <p className="text-xs font-medium uppercase tracking-[0.2em] text-cyan-300/80">Warehouse Management</p>
    <h1 className="mt-2 text-3xl font-semibold text-white">Member Applications</h1>
    <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Review each applicant type in its own workspace. Doorlock permissions are limited to entrance areas.</p>
    {accessStatus === "saved" && <p className="mt-5 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">Access review saved successfully.</p>}
    {accessStatus === "error" && <p className="mt-5 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">Access review could not be saved. Check the selected entrance area and guard placement.</p>}
    {one(params.application) === "saved" && <p className="mt-5 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">Application approved. RFID and access permissions were saved.</p>}
    {one(params.application) === "error" && <p className="mt-5 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">Application could not be approved. Choose a vacant RFID and valid entrance permission.</p>}
    {one(params.rfid) === "saved" && <p className="mt-5 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">RFID reserved for this application.</p>}
    {one(params.rfid) === "error" && <p className="mt-5 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">RFID could not be assigned. Choose a vacant UID.</p>}
    {error && <p className="mt-5 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">Member applications could not be loaded.</p>}
    <nav className="mt-6 flex flex-wrap gap-2 rounded-2xl border border-white/10 bg-[#0b1d34] p-2" aria-label="Application roles">
      <TabLink active={tab === "staff"} href="/member-applications?tab=staff" label="Staff Applications" />
      <TabLink active={tab === "drivers"} href="/member-applications?tab=drivers" label="Driver Applications" />
    </nav>
    {tab === "staff" && <StaffTable applications={applications} areas={entranceAreas} rfids={rfids} />}
    {tab === "drivers" && <DriverTable applications={applications} trucks={registeredTrucks} />}
  </section>;
}

function requestedRole(tab: Tab): Application["requested_role"] { return tab === "drivers" ? "driver" : "staff"; }
function TabLink({ active, href, label }: { active: boolean; href: string; label: string }) { return <a href={href} className={`rounded-xl px-4 py-2.5 text-sm font-medium transition ${active ? "bg-cyan-400/15 text-cyan-100" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}>{label}</a>; }

function StaffTable({ applications, areas, rfids }: { applications: Application[]; areas: Area[]; rfids: VacantRfid[] }) {
  return <ApplicationTable title="Staff requests" description="Staff access uses the Staff Main Entrance and RFID only." applications={applications} headers={["Applicant", "Application", "Credential", "RFID", "Documents", "Doorlock access", "Submitted"]} renderCells={(application) => <><ApplicantCell application={application} /><ApplicationCell application={application} /><td className="px-5 py-4"><span className="text-slate-400">RFID only</span></td><td className="px-5 py-4"><RfidSelect application={application} rfids={rfids} formId={`finalize-${application.id}`} /></td><DocumentCell application={application} /><td className="px-5 py-4"><UnifiedReviewForm application={application} areas={areas} rfids={rfids} formId={`finalize-${application.id}`} /></td><SubmittedCell application={application} rfids={rfids} formId={`finalize-${application.id}`} /></>} />;
}

function GuardTable({ applications, areas, rfids }: { applications: Application[]; areas: Area[]; rfids: VacantRfid[] }) {
  return <ApplicationTable title="Guard requests" description="Choose the guard placement, RFID, and matching doorlock entrances before saving." applications={applications} headers={["Applicant", "Application", "Credential", "RFID", "Placement", "Documents", "Doorlock access", "Submitted"]} renderCells={(application) => { const formId = `finalize-${application.id}`; return <><ApplicantCell application={application} /><ApplicationCell application={application} /><td className="px-5 py-4">{application.camera_opt_in ? <span className="text-cyan-200">RFID + Face</span> : <span className="text-slate-400">RFID only</span>}</td><td className="px-5 py-4"><RfidSelect application={application} rfids={rfids} formId={formId} /></td><td className="px-5 py-4"><GuardPlacementSelect application={application} formId={formId} /></td><DocumentCell application={application} /><td className="px-5 py-4"><UnifiedReviewForm application={application} areas={areas} rfids={rfids} formId={formId} /></td><SubmittedCell application={application} rfids={rfids} formId={formId} /></>; }} />;
}

function DriverTable({ applications, trucks }: { applications: Application[]; trucks: RegisteredTruck[] }) {
  return <ApplicationTable title="Driver requests" description="Assign an existing registered truck. Truck name, plate, placement, and RFID are managed in the Trucks workspace." applications={applications} headers={["Applicant", "Application", "Assign registered truck", "Documents", "Submitted"]} renderCells={(application) => <><ApplicantCell application={application} /><ApplicationCell application={application} /><td className="px-5 py-4"><DriverFinalizeForm application={application} trucks={trucks} /></td><DocumentCell application={application} /><SubmittedCell application={application} /></>} />;
}

function ApplicationTable({ title, description, applications, headers, renderCells }: { title: string; description: string; applications: Application[]; headers: string[]; renderCells: (application: Application) => React.ReactNode }) {
  return <section className="relative mt-5 overflow-visible rounded-2xl border border-white/10 bg-[#0b1d34]"><div className="border-b border-white/[0.07] p-5"><h2 className="font-semibold text-white">{title}</h2><p className="mt-1 text-sm text-slate-400">{description}</p></div><div className="overflow-visible"><table className="w-full table-fixed text-left text-xs"><colgroup>{headers.map((header) => <col key={header} style={{ width: columnWidth(header, headers.includes("Placement")) }} />)}</colgroup><thead className="bg-white/[0.03] text-slate-500"><tr>{headers.map((header) => <th key={header} className="break-words px-3 py-3 font-medium md:px-4">{header}</th>)}</tr></thead><tbody>{applications.map((application) => <tr key={application.id} className="border-t border-white/[0.06] text-slate-300">{renderCells(application)}</tr>)}</tbody></table></div>{!applications.length && <p className="px-5 py-14 text-center text-sm text-slate-500">No {title.toLowerCase()} yet.</p>}</section>;
}

function columnWidth(header: string, hasPlacement: boolean): string {
  if (hasPlacement) return ({ Applicant: "15%", Application: "12%", Credential: "9%", RFID: "12%", Placement: "11%", Documents: "12%", "Doorlock access": "19%", Submitted: "10%" } as Record<string, string>)[header] ?? "10%";
  return ({ Applicant: "16%", Application: "13%", Credential: "10%", RFID: "13%", Documents: "14%", "Doorlock access": "22%", Submitted: "12%" } as Record<string, string>)[header] ?? "10%";
}

function ApplicantCell({ application }: { application: Application }) { return <td className="px-5 py-4"><p className="font-medium text-white">{application.applicant_name}</p><p className="mt-1 text-slate-500">{application.applicant_email}</p></td>; }
function ApplicationCell({ application }: { application: Application }) { return <td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 capitalize ${application.status === "approved" ? "bg-emerald-400/10 text-emerald-300" : application.status === "rejected" ? "bg-rose-400/10 text-rose-300" : "bg-amber-400/10 text-amber-200"}`}>{application.status}</span><p className="mt-2 text-slate-500">{application.requested_warehouse_name}</p></td>; }
function DocumentCell({ application }: { application: Application }) { return <td className="px-5 py-4"><details className="group"><summary className="cursor-pointer text-cyan-200 hover:text-cyan-100">Review documents <span className="text-slate-500 transition group-open:rotate-180">⌄</span></summary><div className="mt-2 grid gap-1.5"><a href={application.valid_id_url} target="_blank" rel="noreferrer" className="text-xs text-slate-300 underline decoration-cyan-400/40 underline-offset-2 hover:text-white">View Valid ID</a><a href={application.facebook_profile_url} target="_blank" rel="noreferrer" className="text-xs text-slate-300 underline decoration-cyan-400/40 underline-offset-2 hover:text-white">View Facebook profile</a></div></details></td>; }
function DriverFinalizeForm({ application, trucks }: { application: Application; trucks: RegisteredTruck[] }) { return <form action={finalizeDriverApplication} className="min-w-[220px] space-y-1.5"><input type="hidden" name="applicationId" value={application.id} /><select name="truckId" defaultValue="" required className="w-full rounded-lg border border-white/10 bg-[#10233d] px-2 py-2 text-xs text-white"><option value="">Select registered truck</option>{trucks.map((truck) => <option key={truck.id} value={truck.id}>{truck.identity_label} · {truck.plate_number} · {truck.division ?? "No placement"}</option>)}</select><button type="submit" disabled={!trucks.length} className="rounded-lg bg-cyan-500/15 px-3 py-1.5 text-xs text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40">Approve + assign truck</button>{!trucks.length && <p className="text-[11px] text-amber-200">Register an unassigned truck first in Fleet → Trucks.</p>}</form>; }
function SubmittedCell({ application, rfids, formId }: { application: Application; rfids?: VacantRfid[]; formId?: string }) { return <td className="break-words px-3 py-4 text-slate-500 md:px-4"><div>{new Date(application.created_at).toLocaleString()}</div>{rfids && formId && <button type="submit" form={formId} disabled={!rfids.length} className="mt-3 rounded-lg bg-cyan-500/15 px-3 py-2 text-xs text-cyan-200 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-40">Save all</button>}</td>; }

function RfidSelect({ application, rfids, formId }: { application: Application; rfids: VacantRfid[]; formId: string }) {
  return <select name="rfidPoolId" form={formId} defaultValue={application.rfid_pool_id ?? ""} required className="w-full rounded-lg border border-white/10 bg-[#10233d] px-2 py-2 text-xs text-white"><option value="">Select vacant RFID</option>{rfids.map((rfid) => <option key={rfid.id} value={rfid.id}>{rfid.uid_label}</option>)}</select>;
}

function GuardPlacementSelect({ application, formId }: { application: Application; formId: string }) {
  return <select name="guardPlacement" form={formId} defaultValue={application.guard_placement ?? "staff_entrance_guard"} required className="w-full rounded-lg border border-white/10 bg-[#10233d] px-2 py-2 text-xs text-white"><option value="staff_entrance_guard">Staff Entrance only</option></select>;
}

function UnifiedReviewForm({ application, areas, rfids, formId }: { application: Application; areas: Area[]; rfids: VacantRfid[]; formId: string }) {
  const filteredAreas = areas.filter((area) => area.area_type_code === "staff_entrance");
  return <form id={formId} action={finalizeMemberApplication} className="w-full min-w-0"><input type="hidden" name="applicationId" value={application.id} /><details className="group relative w-full rounded-lg border border-white/10 bg-[#08172b]"><summary className="cursor-pointer list-none whitespace-nowrap px-2 py-2.5 text-xs text-slate-200"><span className="flex items-center justify-between gap-1"><span>Permission areas</span><span className="text-slate-500">⌄</span></span></summary><div className="absolute left-0 top-full z-30 mt-1 max-h-48 w-64 space-y-1 overflow-y-auto rounded-lg border border-cyan-300/20 bg-[#08172b] p-2 shadow-2xl shadow-black/40">{filteredAreas.map((area) => <label key={area.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-slate-300 hover:bg-white/[0.04]"><input type="checkbox" name="areaIds" value={area.id} defaultChecked={application.permission_area_ids.includes(area.id)} className="accent-cyan-400" /><span>{area.name}</span></label>)}{!filteredAreas.length && <span className="block px-2 py-1 text-slate-500">No matching entrance areas.</span>}</div></details></form>;
}

function AccessReviewForm({ application, areas }: { application: Application; areas: Area[] }) {
  const filteredAreas = areas.filter((area) => application.requested_role === "driver" ? area.area_type_code === "truck_entrance" : area.area_type_code === "staff_entrance");
  return <form action={saveMemberApplicationAccess} className="min-w-[240px] space-y-2"><input type="hidden" name="applicationId" value={application.id} />{application.requested_role === "guard" && <><input type="hidden" name="guardPlacement" value="staff_entrance_guard" /><span className="block rounded-lg border border-white/10 bg-[#10233d] px-2.5 py-2 text-xs text-slate-200">Staff Entrance only</span></>}<details className="group rounded-lg border border-white/10 bg-[#08172b]"><summary className="cursor-pointer list-none px-3 py-2.5 text-xs text-slate-200"><span className="flex items-center justify-between gap-3"><span>Select permission areas</span><span className="text-slate-500 transition group-open:rotate-180">⌄</span></span></summary><div className="max-h-36 space-y-1 overflow-y-auto border-t border-white/10 p-2">{filteredAreas.map((area) => <label key={area.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-slate-300 hover:bg-white/[0.04]"><input type="checkbox" name="areaIds" value={area.id} defaultChecked={application.permission_area_ids.includes(area.id)} className="accent-cyan-400" /><span>{area.name}</span></label>)}{!filteredAreas.length && <span className="block px-2 py-1 text-slate-500">No matching entrance areas.</span>}</div></details><button type="submit" className="rounded-lg bg-cyan-500/15 px-3 py-2 text-cyan-200 hover:bg-cyan-500/25">Save access review</button></form>;
}
