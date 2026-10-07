import { loadDevices } from "@/lib/devices-data";
import { DeviceConfigurationForm } from "@/components/device-configuration-form";

export default async function DevicesPage() {
  const data = await loadDevices();
  return <>
    <header className="mb-6">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-cyan-300/80">Warehouse Setup</p>
      <h1 className="mt-1 text-2xl font-semibold text-white">IoT Devices</h1>
      <p className="mt-2 text-sm text-slate-400">Assign each device to an area and configure it as a doorlock or sensor.</p>
    </header>
    {data.error && <p className="mb-5 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">{data.error}</p>}
    {process.env.VERCEL_ENV === "preview" && <p className="mb-5 rounded-xl border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-xs text-amber-100">Preview diagnostics: role={data.debug.role ?? "none"} · warehouses={data.debug.warehouseCount} · areas={data.debug.areaCount} · devices visible={data.debug.deviceCount}</p>}
    {!data.error && !data.rows.length && <section className="rounded-2xl border border-white/10 bg-[#0b1d34] px-5 py-16 text-center text-sm text-slate-400">No IoT devices are registered yet.</section>}
    <div className="space-y-4">{data.rows.map((device) => <section key={device.id} className="rounded-2xl border border-white/10 bg-[#0b1d34] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold text-white">{device.name}</h2><p className="mt-1 text-xs text-slate-500">{device.isActive ? "Active" : "Inactive"}{device.environmentalState ? ` · ${device.environmentalState}` : ""}</p></div><span className="rounded-full bg-cyan-400/10 px-2.5 py-1 text-[11px] text-cyan-200">{device.config.iotRole ? device.config.iotRole : "Not configured"}</span></div>
      <DeviceConfigurationForm deviceId={device.id} areas={data.areas} config={device.config} />
    </section>)}</div>
  </>;
}
