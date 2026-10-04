import Link from "next/link";
import {
  loadSafetyEmergencyData,
  safetyEventTypes,
  safetySeverities,
  safetyStatuses,
} from "@/lib/safety-emergency-data";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function filterQuery(filters: Record<string, string>, page: number) {
  const query = new URLSearchParams({ ...filters, page: String(page) });
  return `?${query.toString()}`;
}

function value(value: number | null) {
  return value === null ? "—" : String(value);
}

export default async function SafetyEmergencyPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const filters = {
    page: Math.max(1, Number(one(params.page)) || 1),
    pageSize: 20,
    severity: one(params.severity),
    status: one(params.status),
    eventType: one(params.eventType),
    deviceId: one(params.deviceId),
    areaId: one(params.areaId),
    dateFrom: one(params.dateFrom),
    dateTo: one(params.dateTo),
  };
  const data = await loadSafetyEmergencyData(filters);
  const pageCount = Math.max(1, Math.ceil(data.total / data.pageSize));
  const queryFilters = {
    severity: filters.severity,
    status: filters.status,
    eventType: filters.eventType,
    deviceId: filters.deviceId,
    areaId: filters.areaId,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
  };

  return (
    <>
      <header className="mb-6">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-cyan-300/80">Activity &amp; Events</p>
        <h1 className="mt-1 text-2xl font-semibold text-white">Safety &amp; Emergency Logs</h1>
        <p className="mt-2 text-sm text-slate-400">Review environmental state changes, safety events, and warehouse emergency status.</p>
      </header>

      <section className="mb-5 rounded-2xl border border-white/10 bg-[#0b1d34] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Warehouse emergency state</p>
            <p className={`mt-1 text-lg font-semibold ${data.emergency?.state === "emergency_release" ? "text-rose-300" : "text-emerald-300"}`}>
              {data.emergency ? label(data.emergency.state) : "No emergency state recorded"}
            </p>
          </div>
          {data.emergency?.reason && <p className="max-w-xl text-sm text-slate-400">{data.emergency.reason}</p>}
        </div>
      </section>

      <form method="get" className="mb-5 grid gap-3 rounded-2xl border border-white/10 bg-[#0b1d34] p-4 md:grid-cols-4">
        <select name="severity" defaultValue={filters.severity} className="rounded-lg border border-white/10 bg-[#10233d] px-3 py-2.5 text-sm text-white"><option value="">All severities</option>{safetySeverities.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select>
        <select name="status" defaultValue={filters.status} className="rounded-lg border border-white/10 bg-[#10233d] px-3 py-2.5 text-sm text-white"><option value="">All statuses</option>{safetyStatuses.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select>
        <select name="eventType" defaultValue={filters.eventType} className="rounded-lg border border-white/10 bg-[#10233d] px-3 py-2.5 text-sm text-white"><option value="">All event types</option>{safetyEventTypes.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select>
        <select name="deviceId" defaultValue={filters.deviceId} className="rounded-lg border border-white/10 bg-[#10233d] px-3 py-2.5 text-sm text-white"><option value="">All devices</option>{data.devices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}</select>
        <select name="areaId" defaultValue={filters.areaId} className="rounded-lg border border-white/10 bg-[#10233d] px-3 py-2.5 text-sm text-white"><option value="">All areas</option>{data.areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select>
        <label className="text-xs text-slate-400">From<input type="date" name="dateFrom" defaultValue={filters.dateFrom} className="mt-2 w-full rounded-lg border border-white/10 bg-[#10233d] px-3 py-2.5 text-sm text-white" /></label>
        <label className="text-xs text-slate-400">To<input type="date" name="dateTo" defaultValue={filters.dateTo} className="mt-2 w-full rounded-lg border border-white/10 bg-[#10233d] px-3 py-2.5 text-sm text-white" /></label>
        <button className="self-end rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white">Apply filters</button>
      </form>

      {data.error && <p className="mb-5 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">{data.error}</p>}

      <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#0b1d34]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-xs">
            <thead className="bg-white/[0.02] text-slate-500"><tr><th className="px-5 py-3">Time</th><th className="px-5 py-3">Event</th><th className="px-5 py-3">Severity</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Area / Device</th><th className="px-5 py-3">State</th><th className="px-5 py-3">Reading</th></tr></thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.id} className="border-t border-white/[0.06] text-slate-300 align-top">
                  <td className="whitespace-nowrap px-5 py-4">{new Date(row.occurredAt).toLocaleString()}</td>
                  <td className="px-5 py-4 text-white"><span>{label(row.eventType)}</span><details className="mt-2 text-slate-400"><summary className="cursor-pointer text-cyan-300">View details</summary><dl className="mt-2 space-y-1 text-xs"><div><dt className="inline text-slate-500">Area: </dt><dd className="inline">{row.areaName ?? "—"}</dd></div><div><dt className="inline text-slate-500">Device: </dt><dd className="inline">{row.deviceName ?? "—"}</dd></div><div><dt className="inline text-slate-500">State: </dt><dd className="inline">{row.previousEnvironmentalState ? `${row.previousEnvironmentalState} → ` : ""}{row.environmentalState ?? "—"}</dd></div><div><dt className="inline text-slate-500">Metadata: </dt><dd className="inline break-words">{Object.keys(row.metadata).length ? JSON.stringify(row.metadata) : "—"}</dd></div></dl></details></td>
                  <td className="px-5 py-4">{label(row.severity)}</td>
                  <td className="px-5 py-4">{label(row.status)}</td>
                  <td className="px-5 py-4">{row.areaName ?? "—"}<br /><span className="text-slate-500">{row.deviceName ?? "No device"}</span></td>
                  <td className="px-5 py-4">{row.environmentalState ?? "—"}{row.previousEnvironmentalState && <span className="block text-slate-500">from {row.previousEnvironmentalState}</span>}</td>
                  <td className="px-5 py-4">{row.temperature === null && row.humidity === null && row.smoke === null ? "—" : `T ${value(row.temperature)}°C · H ${value(row.humidity)}% · S ${value(row.smoke)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.rows.length && <p className="px-5 py-16 text-center text-sm text-slate-400">No safety or emergency events found.</p>}
        </div>
        <div className="flex items-center justify-between border-t border-white/[0.07] px-5 py-4 text-xs text-slate-400"><span>Page {data.page} of {pageCount}</span><div className="flex gap-2"><Link aria-disabled={data.page <= 1} className={`rounded-lg border border-white/10 px-3 py-2 ${data.page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-white/5"}`} href={`/safety-emergency${filterQuery(queryFilters, data.page - 1)}`}>Previous</Link><Link aria-disabled={data.page >= pageCount} className={`rounded-lg border border-white/10 px-3 py-2 ${data.page >= pageCount ? "pointer-events-none opacity-40" : "hover:bg-white/5"}`} href={`/safety-emergency${filterQuery(queryFilters, data.page + 1)}`}>Next</Link></div></div>
      </section>

      <p className="mt-4 text-xs text-slate-500">Event details are available in each read-only row. No acknowledgement, resolution, threshold, or emergency controls are available here.</p>
    </>
  );
}
