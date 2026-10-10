import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { assignDeviceToWarehouse, createDeviceInventory } from "@/app/admin/system-admins/actions";
import { ProvisionDeviceForm } from "@/components/provision-device-form";

type SearchParams = Promise<{ status?: string }>;

export default async function DeviceInventoryPage({ searchParams }: { searchParams: SearchParams }) {
  const client = await createClient();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) redirect("/login");
  const { data: profile } = await client.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (profile?.role !== "father_admin") redirect("/");
  const [{ data: devices }, { data: warehouses }] = await Promise.all([
    client.from("devices").select("id,name,lifecycle_status,warehouse_id,device_uid").order("name"),
    client.from("warehouses").select("id,name").order("name"),
  ]);
  const status = (await searchParams).status;
  return <section className="mx-auto max-w-5xl"><p className="text-xs font-medium uppercase tracking-[0.18em] text-cyan-300/80">Father Admin · Platform Administration</p><h1 className="mt-2 text-3xl font-semibold text-white">Device Inventory</h1><p className="mt-2 text-sm text-slate-400">Create and track devices. Assign a vacant device to a warehouse, then provision it for the camera or controller.</p>{status === "device-assigned" && <p className="mt-5 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">Device assigned to the warehouse. You can provision it now.</p>}{status === "error" && <p className="mt-5 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">The device assignment was rejected by the server.</p>}<section className="mt-6 rounded-xl border border-cyan-300/20 bg-[#10233d] p-5"><form action={createDeviceInventory} className="flex flex-wrap gap-3"><input name="name" required placeholder="Device name (example: Device 1)" className="min-w-64 flex-1 rounded-lg border border-white/10 bg-[#0b1d34] px-3 py-2 text-sm text-white" /><button className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950">Create vacant device</button></form><div className="mt-6 border-t border-white/10 pt-5"><h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-400">All devices</h2><div className="mt-3 space-y-2">{devices?.map((device) => { const acquired = device.lifecycle_status !== "vacant" || Boolean(device.warehouse_id); const warehouse = warehouses?.find((item) => item.id === device.warehouse_id); return <div key={device.id} className="rounded-lg bg-[#0b1d34] px-4 py-3 text-sm"><div className="flex items-center justify-between gap-3"><div><span className="font-medium text-white">{device.name}</span>{warehouse && <p className="mt-1 text-xs text-slate-400">Warehouse: {warehouse.name}</p>}</div><span className={device.device_uid ? "text-cyan-300" : acquired ? "text-amber-200" : "text-emerald-300"}>{device.device_uid ? "Provisioned" : acquired ? "Acquired · not provisioned" : "Vacant"}</span></div>{!acquired && <form action={assignDeviceToWarehouse} className="mt-3 flex flex-wrap items-center gap-2"><input type="hidden" name="deviceId" value={device.id} /><select name="warehouseId" required defaultValue="" className="min-w-56 rounded-lg border border-white/10 bg-[#10233d] px-3 py-2 text-sm text-white"><option value="" disabled>Assign to warehouse</option>{warehouses?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button className="rounded-lg border border-cyan-300/30 bg-cyan-400/10 px-3 py-2 text-sm font-medium text-cyan-100">Assign device</button></form>}{acquired && <ProvisionDeviceForm deviceId={device.id} rotate={Boolean(device.device_uid)} />}</div>; })}{!devices?.length && <p className="text-sm text-slate-500">No devices available.</p>}</div></div></section></section>;
}
