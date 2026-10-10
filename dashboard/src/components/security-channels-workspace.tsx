"use client";

import { useEffect, useState } from "react";
import { Camera, CircleAlert, Radio, Truck, Video } from "lucide-react";
import type { WarehouseArea } from "@/lib/areas-data";
import type { PlatformRole } from "@/lib/warehouse-scope";

type LastEvent = { eventType: string; result: string; occurredAt: string };

export function SecurityChannelsWorkspace({ areas, error, viewerRole, cameraTunnelUrl, lastEvents }: { areas: WarehouseArea[]; error: string | null; viewerRole: PlatformRole; accessibleAreaIds: string[] | null; cameraTunnelUrl: string | null; lastEvents: Record<string, LastEvent>; staffActors: unknown[]; truckActors: unknown[] }) {
  const truckEntrances = areas.filter((area) => area.area_type_code === "truck_entrance" && area.entrance_category === "truck_main");
  const [selectedAreaId, setSelectedAreaId] = useState(truckEntrances[0]?.id ?? "");
  const selectedArea = truckEntrances.find((area) => area.id === selectedAreaId);
  useEffect(() => { if (viewerRole !== "system_admin" || !cameraTunnelUrl) return; void fetch(`${cameraTunnelUrl.replace(/\/$/, "")}/mode?m=truck`).catch(() => undefined); }, [cameraTunnelUrl, viewerRole]);
  return <>
    <header className="mb-7"><p className="text-xs font-medium uppercase tracking-[0.2em] text-cyan-300/80">Security Operations</p><div className="mt-2 flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-3xl font-semibold text-white">Security Channels</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">One system-admin camera for the truck entrance. Plate authentication only.</p></div><span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs text-cyan-200">Live plate camera</span></div></header>
    {error && <p className="mb-5 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">{error}</p>}
    <section className="rounded-2xl border border-white/10 bg-[#0b1d34] p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold text-white">Truck Plate Authentication</h2><p className="mt-1 max-w-2xl text-sm leading-5 text-slate-400">The single Truck Main Entrance camera is active automatically. The ESP32-CAM reads the plate; RFID is not used for trucks.</p></div><span className="rounded-full bg-amber-300/10 px-3 py-1.5 text-xs text-amber-200">TRUCK PLATE</span></div><p className="mt-5 rounded-xl border border-cyan-300/15 bg-cyan-300/[0.04] p-4 text-xs text-slate-400">Mode: Truck Plate · Active gate: {selectedArea?.name ?? "None"}</p>{truckEntrances.length ? <div className="mt-5 grid gap-4 xl:grid-cols-2">{truckEntrances.map((area) => <ChannelCard key={area.id} area={area} live={area.id === selectedAreaId} cameraTunnelUrl={cameraTunnelUrl} onSelect={() => setSelectedAreaId(area.id)} lastEvent={lastEvents[area.id]} />)}</div> : <EmptyPanel text="No truck entrance configured yet." />}</section>
  </>;
}

function ChannelCard({ area, live, cameraTunnelUrl, onSelect, lastEvent }: { area: WarehouseArea; live: boolean; cameraTunnelUrl: string | null; onSelect: () => void; lastEvent?: LastEvent }) {
  return <article onClick={onSelect} className={`overflow-hidden rounded-2xl border ${live ? "border-cyan-300/60" : "border-white/[0.08]"} cursor-pointer bg-[#10233d]`}><div className="relative flex aspect-video items-center justify-center bg-[#07172b]">{live && cameraTunnelUrl ? <img src={`${cameraTunnelUrl.replace(/\/$/, "")}/live.mjpg`} alt={`${area.name} live camera`} className="h-full w-full object-cover" /> : <div className="text-center"><Video className="mx-auto text-slate-600" size={30} /><p className="mt-2 text-sm font-medium text-slate-400">Select this camera to connect</p></div>}<span className={`absolute right-3 top-3 rounded-full px-2.5 py-1 text-[11px] ${live ? "bg-emerald-500/80 text-white" : "bg-slate-800/90 text-slate-400"}`}>{live ? "Connected" : "No connection"}</span></div><div className="p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-[0.14em] text-cyan-300/70">Truck Entrance</p><h3 className="mt-1 font-semibold text-white">{area.name}</h3></div><CircleAlert size={17} className="text-slate-600" /></div><div className="mt-3 flex flex-wrap gap-2"><span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] text-slate-300"><Camera size={12} />Camera</span><span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] text-slate-300"><Radio size={12} />Plate</span><span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] text-slate-300"><Truck size={12} />Truck gate</span></div><p className="mt-3 text-xs text-slate-500">{lastEvent ? `Last plate auth: ${lastEvent.result} · ${new Date(lastEvent.occurredAt).toLocaleString()}` : "No plate auth events yet"}</p></div></article>;
}

function EmptyPanel({ text }: { text: string }) { return <div className="mt-5 rounded-xl border border-dashed border-white/10 px-5 py-10 text-center text-sm text-slate-500">{text}</div>; }
