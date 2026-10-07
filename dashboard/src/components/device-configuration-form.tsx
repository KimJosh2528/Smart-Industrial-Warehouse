"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { saveDeviceConfiguration, type DeviceMutationState } from "@/app/devices/actions";
import type { DeviceConfig } from "@/lib/devices-data";

const initialState: DeviceMutationState = { success: false, message: "" };

function Range({ title, unit, prefix, values }: { title: string; unit: string; prefix: string; values: [number|null, number|null] }) {
  return <div className="rounded-lg border border-white/[0.06] bg-[#0b1d34] p-3"><p className="mb-2 text-xs font-medium text-slate-300">{title}</p><div className="flex items-center gap-2"><input type="number" step="any" name={`${prefix}Min`} defaultValue={values[0] ?? ""} required className="w-full rounded-md border border-white/10 bg-[#10233d] px-2.5 py-2 text-sm text-white" /><span className="text-slate-500">→</span><input type="number" step="any" name={`${prefix}Max`} defaultValue={values[1] ?? ""} required className="w-full rounded-md border border-white/10 bg-[#10233d] px-2.5 py-2 text-sm text-white" /><span className="text-xs text-slate-500">{unit}</span></div></div>;
}

export function DeviceConfigurationForm({ deviceId, areas, config }: { deviceId: string; areas: { id: string; name: string }[]; config: DeviceConfig }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(saveDeviceConfiguration, initialState);
  const [role, setRole] = useState<"doorlock"|"sensor">(config.iotRole ?? "sensor");

  useEffect(() => { if (state.success) router.refresh(); }, [state, router]);

  return <form action={action} className="mt-4 space-y-4 border-t border-white/[0.07] pt-4">
    <input type="hidden" name="deviceId" value={deviceId} />
    <div className="grid gap-3 md:grid-cols-2">
      <label className="text-xs text-slate-400">Target Area<select name="areaId" defaultValue={config.areaId ?? ""} required className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#10233d] px-3 py-2.5 text-sm text-white"><option value="">Select an area</option>{areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label>
      <label className="text-xs text-slate-400">Device Role<select name="iotRole" value={role} onChange={(e) => setRole(e.target.value as "doorlock"|"sensor")} className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#10233d] px-3 py-2.5 text-sm text-white"><option value="sensor">Sensor</option><option value="doorlock">Doorlock</option></select></label>
    </div>

    {role === "doorlock" ? <div className="rounded-xl border border-white/[0.07] bg-[#10233d] p-4">
      <p className="text-sm font-medium text-white">Doorlock type</p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-white/10 p-3 text-sm text-slate-300"><input type="radio" name="doorlockMode" value="staff" defaultChecked={config.doorlockMode !== "truck"} />Staff Doorlock<span className="ml-auto text-xs text-slate-500">Face + RFID</span></label>
        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-white/10 p-3 text-sm text-slate-300"><input type="radio" name="doorlockMode" value="truck" defaultChecked={config.doorlockMode === "truck"} />Truck Doorlock<span className="ml-auto text-xs text-slate-500">Plate + RFID</span></label>
      </div>
    </div> : <div className="space-y-4">
      <div className="rounded-xl border border-white/[0.07] bg-[#10233d] p-4"><h3 className="text-sm font-medium text-white">Temperature</h3><div className="mt-3 grid gap-2 md:grid-cols-3"><Range title="Normal" unit="°C" prefix="temperatureNormal" values={[config.temperature.normalMin, config.temperature.normalMax]} /><Range title="Warning" unit="°C" prefix="temperatureWarning" values={[config.temperature.warningMin, config.temperature.warningMax]} /><Range title="Danger" unit="°C" prefix="temperatureDanger" values={[config.temperature.dangerMin, config.temperature.dangerMax]} /></div></div>
      <div className="rounded-xl border border-white/[0.07] bg-[#10233d] p-4"><h3 className="text-sm font-medium text-white">Humidity</h3><div className="mt-3 grid gap-2 md:grid-cols-3"><Range title="Normal" unit="%" prefix="humidityNormal" values={[config.humidity.normalMin, config.humidity.normalMax]} /><Range title="Warning" unit="%" prefix="humidityWarning" values={[config.humidity.warningMin, config.humidity.warningMax]} /><Range title="Danger" unit="%" prefix="humidityDanger" values={[config.humidity.dangerMin, config.humidity.dangerMax]} /></div></div>
      <div className="rounded-xl border border-white/[0.07] bg-[#10233d] p-4"><h3 className="text-sm font-medium text-white">Smoke</h3><div className="mt-3 grid gap-2 md:grid-cols-3"><Range title="Normal" unit="value" prefix="smokeNormal" values={[config.smoke.normalMin, config.smoke.normalMax]} /><Range title="Warning" unit="value" prefix="smokeWarning" values={[config.smoke.warningMin, config.smoke.warningMax]} /><Range title="Danger" unit="value" prefix="smokeDanger" values={[config.smoke.dangerMin, config.smoke.dangerMax]} /></div></div>
      <div className="rounded-xl border border-amber-400/15 bg-amber-400/[0.04] p-4"><p className="text-sm font-medium text-white">Server alarm</p><p className="mt-1 text-xs text-slate-500">These alarms notify the server/dashboard only. They do not activate the physical hardware alarm.</p><div className="mt-3 grid gap-2 md:grid-cols-2"><label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" name="warningServerAlarm" defaultChecked={config.warningServerAlarm} />Alarm server on warning</label><label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" name="dangerServerAlarm" defaultChecked={config.dangerServerAlarm} />Alarm server on danger</label></div></div>
    </div>}

    <button type="submit" disabled={pending} className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{pending ? "Saving..." : "Save Configuration"}</button>
    {state.message && <p className={state.success ? "text-sm text-emerald-300" : "text-sm text-rose-300"}>{state.message}</p>}
  </form>;
}
