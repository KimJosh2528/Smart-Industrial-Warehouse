import { loadAreasData } from "@/lib/areas-data";
import { WarehouseAreaManager } from "@/components/warehouse-area-manager";
import { DepartmentAreaDefaultManager } from "@/components/department-area-default-manager";
import { DepartmentManager } from "@/components/department-manager";

export default async function AreasPage() {
  const data = await loadAreasData();
  return <><header className="mb-6"><p className="text-xs font-medium uppercase tracking-[0.18em] text-cyan-300/80">Warehouse configuration</p><h1 className="mt-1 text-2xl font-semibold text-white">Warehouse Areas</h1><p className="mt-2 text-sm text-slate-400">Configure predefined areas and their operational state. State is not activation status.</p></header>{data.error && <p className="mb-5 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">{data.error}</p>}{data.warehouses.length ? <><WarehouseAreaManager warehouses={data.warehouses} types={data.types} areas={data.areas} activeAreaByWarehouse={data.activeAreaByWarehouse} /><DepartmentManager departments={data.departments} warehouses={data.warehouses} /><DepartmentAreaDefaultManager departments={data.departments} areas={data.areas} defaults={data.departmentDefaults} /></> : <section className="rounded-2xl border border-white/10 bg-[#0b1d34] px-5 py-16 text-center text-sm text-slate-400">{data.configured ? "No authorized warehouses available." : "Connect Supabase to load warehouse areas."}</section>}</>;
}
