import { Thermometer } from "lucide-react";
import { loadAreasData } from "@/lib/areas-data";
import { RoomThresholdConfig } from "@/components/room-threshold-config";

export default async function RoomSensorSettingsPage() {
  const data = await loadAreasData();
  const rooms = data.areas.filter((area) => area.area_type_code === "room");
  return <>
    <header className="mb-8"><p className="text-xs font-medium uppercase tracking-[0.2em] text-violet-300/80">Warehouse Setup</p><div className="mt-2 flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-3xl font-semibold text-white">Room Sensor Settings</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Configure the safe operating ranges for each room. Actual readings come from the IoT device; these values define the room limits.</p></div><div className="rounded-xl border border-violet-300/15 bg-violet-300/[0.06] px-4 py-3 text-right"><p className="text-xs uppercase tracking-wider text-slate-500">Configured rooms</p><p className="mt-1 text-xl font-semibold text-white">{rooms.length}</p></div></div></header>
    {data.error && <p className="mb-5 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">{data.error}</p>}
    {!rooms.length && !data.error && <section className="rounded-2xl border border-dashed border-white/10 bg-[#0b1d34] px-6 py-16 text-center"><Thermometer className="mx-auto text-violet-300" size={28} /><h2 className="mt-4 text-lg font-semibold text-white">No rooms configured</h2><p className="mt-2 text-sm text-slate-500">Create a Room first in Warehouse Areas, then configure its sensor limits here.</p></section>}
    {!!rooms.length && <div className="space-y-5">{rooms.map((room) => <section key={room.id} className="rounded-2xl border border-violet-300/15 bg-[#0b1d34] p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-[0.16em] text-violet-300/80">Room</p><h2 className="mt-1 text-xl font-semibold text-white">{room.name}</h2><p className="mt-1 text-xs text-slate-500">Sensor readings for this room only</p></div><span className="rounded-full bg-violet-300/10 px-3 py-1.5 text-xs text-violet-200">IoT controlled</span></div><RoomThresholdConfig areaId={room.id} config={room.environment_config} /></section>)}</div>}
  </>;
}
