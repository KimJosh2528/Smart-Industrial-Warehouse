import { Truck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAuthorizedWarehouses } from "@/lib/warehouse-scope";

export default async function MyTruckPage() {
  const client = await createClient();
  const scope = await getAuthorizedWarehouses(client);
  if (scope.role !== "driver") return <Message text="This page is available to driver accounts only." />;

  const { data: driver } = await client.from("drivers").select("id,display_name").eq("profile_id", scope.userId).maybeSingle<{ id: string; display_name: string }>();
  if (!driver) return <Message text="Your driver record could not be found." />;
  const { data: truck } = await client.from("trucks").select("identity_label,plate_number,division,current_driver_id").eq("current_driver_id", driver.id).maybeSingle<{ identity_label: string; plate_number: string; division: string | null; current_driver_id: string }>();

  return <>
    <header className="mb-7"><p className="text-xs font-medium uppercase tracking-[0.2em] text-cyan-300/80">Driver access</p><h1 className="mt-2 text-3xl font-semibold text-white">My Truck</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Your assigned truck identity, placement, plate number, and access details.</p></header>
    <section className="rounded-2xl border border-white/10 bg-[#0b1d34] p-6">{truck ? <div className="grid gap-4 sm:grid-cols-3"><Detail label="Truck" value={truck.identity_label} /><Detail label="Plate number" value={truck.plate_number} /><Detail label="Placement" value={truck.division ?? "Not assigned"} /></div> : <div className="flex items-center gap-3 text-sm text-slate-400"><Truck size={20} className="text-cyan-300" />No truck is currently assigned to your driver record.</div>}</section>
  </>;
}

function Detail({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 font-medium text-white">{value}</p></div>; }
function Message({ text }: { text: string }) { return <section className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.05] p-5 text-sm text-amber-200">{text}</section>; }
