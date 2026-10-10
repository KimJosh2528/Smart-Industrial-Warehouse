"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { saveRoomEnvironmentConfig, type AreaMutationState } from "@/app/areas/actions";
import type { RoomEnvironmentConfig } from "@/lib/areas-data";

const initialState: AreaMutationState = { success: false, message: "" };

export function RoomThresholdConfig({ areaId, config }: { areaId: string; config: RoomEnvironmentConfig | null }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [state, action, pending] = useActionState(saveRoomEnvironmentConfig, initialState);
  useEffect(() => { if (state.success) router.refresh(); }, [state.success, router]);
  const value = (key: keyof RoomEnvironmentConfig) => config?.[key] ?? "";

  return <div className="mt-3 rounded-xl border border-violet-300/10 bg-violet-400/[0.04] p-4">
    <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-200">Room threshold configuration</p><p className="mt-1 text-xs text-slate-500">Custom limits for this room. Actual values will come from the IoT sensor.</p></div><span className="rounded-full bg-violet-300/10 px-2.5 py-1 text-[11px] text-violet-200">Room only</span></div>
    <button type="button" onClick={() => setExpanded((current) => !current)} className="mt-4 rounded-lg border border-violet-300/20 bg-violet-300/[0.06] px-3 py-2 text-xs font-medium text-violet-200 hover:bg-violet-300/[0.12]">{expanded ? "See less" : "See more"}</button>
    {expanded && <form action={action} className="mt-4 space-y-4">
      <input type="hidden" name="areaId" value={areaId} />
      <ThresholdGroup title="Temperature" hint="Normal range, then warning and danger outside it." tone="cyan"><ThresholdInput name="temperatureDangerLowC" label="Danger low °C" defaultValue={value("temperature_danger_low_c")} /><ThresholdInput name="temperatureWarningLowC" label="Warning low °C" defaultValue={value("temperature_warning_low_c")} /><ThresholdInput name="temperatureMinC" label="Normal min °C" defaultValue={value("temperature_min_c")} /><ThresholdInput name="temperatureMaxC" label="Normal max °C" defaultValue={value("temperature_max_c")} /><ThresholdInput name="temperatureWarningHighC" label="Warning high °C" defaultValue={value("temperature_warning_high_c")} /><ThresholdInput name="temperatureDangerHighC" label="Danger high °C" defaultValue={value("temperature_danger_high_c")} /></ThresholdGroup>
      <ThresholdGroup title="Humidity" hint="Low and high extremes can both become dangerous." tone="blue"><ThresholdInput name="humidityDangerLowPct" label="Danger low %" defaultValue={value("humidity_danger_low_pct")} /><ThresholdInput name="humidityWarningLowPct" label="Warning low %" defaultValue={value("humidity_warning_low_pct")} /><ThresholdInput name="humidityMinPct" label="Normal min %" defaultValue={value("humidity_min_pct")} /><ThresholdInput name="humidityMaxPct" label="Normal max %" defaultValue={value("humidity_max_pct")} /><ThresholdInput name="humidityWarningHighPct" label="Warning high %" defaultValue={value("humidity_warning_high_pct")} /><ThresholdInput name="humidityDangerHighPct" label="Danger high %" defaultValue={value("humidity_danger_high_pct")} /></ThresholdGroup>
      <ThresholdGroup title="Smoke / gas" hint="Same pattern as temperature: normal, warning, danger." tone="amber"><ThresholdInput name="smokeMaxValue" label="Normal max" defaultValue={value("smoke_max_value")} /><ThresholdInput name="smokeWarningValue" label="Warning at" defaultValue={value("smoke_warning_value")} /><ThresholdInput name="smokeDangerValue" label="Danger at" defaultValue={value("smoke_danger_value")} /></ThresholdGroup>
      <div className="rounded-lg border border-rose-300/15 bg-[#10233d] p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-rose-200">Fire trigger settings</p><p className="mt-1 text-xs text-slate-500">The sensor decides the fire state. These are the trigger conditions.</p></div><span className="rounded-full bg-rose-300/10 px-2.5 py-1 text-[11px] text-rose-200">IoT controlled</span></div><div className="mt-3 grid gap-3 sm:grid-cols-3"><ThresholdInput name="gasExposureSeconds" label="Gas exposure seconds" defaultValue={value("gas_exposure_seconds")} /><p className="text-xs leading-5 text-slate-400 sm:col-span-2">Also monitored: rapid temperature rise, or high temperature together with high gas.</p></div></div>
      <div className="flex flex-wrap items-center justify-between gap-3"><p className={`text-xs ${state.success ? "text-emerald-300" : "text-rose-300"}`}>{state.message}</p><button type="submit" disabled={pending} className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"><Save size={15} />{pending ? "Saving..." : "Save room thresholds"}</button></div>
    </form>}
  </div>;
}

function ThresholdGroup({ title, hint, tone, children }: { title: string; hint: string; tone: "cyan" | "blue" | "amber"; children: React.ReactNode }) {
  const border = tone === "cyan" ? "border-cyan-300/10" : tone === "blue" ? "border-blue-300/10" : "border-amber-300/10";
  return <section className={`rounded-lg border ${border} bg-[#10233d] p-4`}><p className="text-sm font-semibold text-white">{title}</p><p className="mt-1 text-xs text-slate-500">{hint}</p><div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</div></section>;
}

function ThresholdInput({ name, label, defaultValue }: { name: string; label: string; defaultValue: number | string }) {
  return <label className="text-xs text-slate-400">{label}<input name={name} type="number" step="0.01" defaultValue={defaultValue} placeholder="Not set" className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#10233d] px-3 py-2.5 text-sm text-white outline-none focus:border-violet-300" /></label>;
}
