import {
  deviceActivityStates,
  deviceConnectivityStates,
  deviceTypes,
  environmentalStates,
  loadDevices,
} from "@/lib/devices-data";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Never";
}

function capabilityText(capabilities: Record<string, unknown>) {
  const entries = Object.entries(capabilities);
  return entries.length ? entries.map(([key, value]) => `${key}: ${String(value)}`).join(", ") : "No capabilities reported";
}

export default async function DevicesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const filters = {
    search: one(params.search),
    deviceType: one(params.deviceType),
    activity: one(params.activity),
    connectivity: one(params.connectivity),
    environmentalState: one(params.environmentalState),
  };
  const data = await loadDevices(filters);

  return (
    <>
      <header className="mb-6">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-cyan-300/80">Warehouse Setup</p>
        <h1 className="mt-1 text-2xl font-semibold text-white">IoT Devices</h1>
        <p className="mt-2 text-sm text-slate-400">View registered warehouse devices and their current reported status.</p>
      </header>

      <form method="get" className="mb-5 grid gap-3 rounded-2xl border border-white/10 bg-[#0b1d34] p-4 md:grid-cols-5">
        <input name="search" defaultValue={filters.search} placeholder="Search name, serial, or UID" className="rounded-lg border border-white/10 bg-[#10233d] px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300" />
        <select name="deviceType" defaultValue={filters.deviceType} className="rounded-lg border border-white/10 bg-[#10233d] px-3 py-2.5 text-sm text-white"><option value="">All types</option>{deviceTypes.map((type) => <option key={type} value={type}>{label(type)}</option>)}</select>
        <select name="activity" defaultValue={filters.activity} className="rounded-lg border border-white/10 bg-[#10233d] px-3 py-2.5 text-sm text-white"><option value="">All activity states</option>{deviceActivityStates.map((state) => <option key={state} value={state}>{label(state)}</option>)}</select>
        <select name="connectivity" defaultValue={filters.connectivity} className="rounded-lg border border-white/10 bg-[#10233d] px-3 py-2.5 text-sm text-white"><option value="">All connectivity</option>{deviceConnectivityStates.map((state) => <option key={state} value={state}>{state === "never" ? "Never connected" : label(state)}</option>)}</select>
        <select name="environmentalState" defaultValue={filters.environmentalState} className="rounded-lg border border-white/10 bg-[#10233d] px-3 py-2.5 text-sm text-white"><option value="">All environmental states</option>{environmentalStates.map((state) => <option key={state} value={state}>{label(state)}</option>)}</select>
        <button className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white md:col-span-5 md:justify-self-end">Apply filters</button>
      </form>

      {data.error && <p className="mb-5 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">{data.error}</p>}
      {!data.error && !data.rows.length && <section className="rounded-2xl border border-white/10 bg-[#0b1d34] px-5 py-16 text-center"><h2 className="text-lg font-semibold text-white">No devices registered</h2><p className="mt-2 text-sm text-slate-400">No device rows are currently visible for this warehouse.</p></section>}
      {!!data.rows.length && <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#0b1d34]"><div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-xs"><thead className="bg-white/[0.02] text-slate-500"><tr><th className="px-5 py-3">Device</th><th className="px-5 py-3">Type</th><th className="px-5 py-3">Identity</th><th className="px-5 py-3">Activity</th><th className="px-5 py-3">Connectivity</th><th className="px-5 py-3">Environment</th><th className="px-5 py-3">Last seen</th><th className="px-5 py-3">Details</th></tr></thead><tbody>{data.rows.map((device) => <tr key={device.id} className="border-t border-white/[0.06] align-top text-slate-300"><td className="px-5 py-4 font-medium text-white">{device.name}</td><td className="px-5 py-4">{label(device.deviceType)}</td><td className="px-5 py-4">UID: {device.deviceUid ?? "Not provisioned"}<br /><span className="text-slate-500">Serial: {device.serialNumber ?? "—"}</span></td><td className="px-5 py-4"><span className={device.isActive ? "text-emerald-300" : "text-slate-400"}>{device.isActive ? "Active" : "Inactive"}</span></td><td className="px-5 py-4">{device.connectivity === "online" ? <span className="text-emerald-300">Online</span> : device.connectivity === "offline" ? <span className="text-amber-300">Offline</span> : <span className="text-slate-400">Never connected</span>}</td><td className="px-5 py-4">{device.environmentalState ?? "Not reported"}</td><td className="whitespace-nowrap px-5 py-4">{formatDate(device.lastSeenAt)}</td><td className="px-5 py-4"><details><summary className="cursor-pointer text-cyan-300">View details</summary><dl className="mt-2 space-y-1 text-slate-400"><div><dt className="inline text-slate-500">Capabilities: </dt><dd className="inline">{capabilityText(device.capabilities)}</dd></div><div><dt className="inline text-slate-500">Created: </dt><dd className="inline">{formatDate(device.createdAt)}</dd></div><div><dt className="inline text-slate-500">Updated: </dt><dd className="inline">{formatDate(device.updatedAt)}</dd></div></dl></details></td></tr>)}</tbody></table></div></section>}
    </>
  );
}
