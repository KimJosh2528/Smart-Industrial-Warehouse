"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type DeviceMutationState = { success: boolean; message: string };
const initialState: DeviceMutationState = { success: false, message: "" };

function value(formData: FormData, key: string) {
  const raw = String(formData.get(key) ?? "").trim();
  return raw === "" ? null : Number(raw);
}

function validateBand(label: string, min: number | null, max: number | null) {
  if (min === null || max === null) return `${label}: complete all six range values.`;
  if (min > max) return `${label}: minimum cannot be greater than maximum.`;
  return null;
}

function validateSensorBand(label: string, b: { nmin: number | null; nmax: number | null; wmin: number | null; wmax: number | null; dmin: number | null; dmax: number | null }) {
  const first = validateBand(`${label} normal`, b.nmin, b.nmax);
  if (first) return first;
  const second = validateBand(`${label} warning`, b.wmin, b.wmax);
  if (second) return second;
  const third = validateBand(`${label} danger`, b.dmin, b.dmax);
  if (third) return third;
  if (b.nmax! >= b.wmin!) return `${label}: normal and warning ranges cannot overlap.`;
  if (b.wmax! >= b.dmin!) return `${label}: warning and danger ranges cannot overlap.`;
  return null;
}

export async function saveDeviceConfiguration(_previous: DeviceMutationState = initialState, formData: FormData): Promise<DeviceMutationState> {
  const deviceId = String(formData.get("deviceId") ?? "");
  const areaId = String(formData.get("areaId") ?? "") || null;
  const iotRole = String(formData.get("iotRole") ?? "");
  const doorlockMode = String(formData.get("doorlockMode") ?? "") || null;
  if (!deviceId || !["doorlock", "sensor"].includes(iotRole)) return { ...initialState, message: "Select a device role." };
  if (iotRole === "doorlock" && !["staff", "truck"].includes(doorlockMode ?? "")) return { ...initialState, message: "Select a doorlock type." };

  const client = await createClient();
  const { data: authData } = await client.auth.getUser();
  if (!authData.user) return { ...initialState, message: "You must be signed in to configure devices." };

  const { data: device } = await client.from("devices").select("id,warehouse_id").eq("id", deviceId).maybeSingle();
  if (!device) return { ...initialState, message: "That device is not available." };

  if (areaId) {
    const { data: area } = await client.from("warehouse_areas").select("id").eq("id", areaId).eq("warehouse_id", device.warehouse_id).maybeSingle();
    if (!area) return { ...initialState, message: "The selected target area is not available for this device." };
  }

  if (iotRole === "sensor") {
    const temp = { nmin: value(formData,"temperatureNormalMin"), nmax: value(formData,"temperatureNormalMax"), wmin: value(formData,"temperatureWarningMin"), wmax: value(formData,"temperatureWarningMax"), dmin: value(formData,"temperatureDangerMin"), dmax: value(formData,"temperatureDangerMax") };
    const humidity = { nmin: value(formData,"humidityNormalMin"), nmax: value(formData,"humidityNormalMax"), wmin: value(formData,"humidityWarningMin"), wmax: value(formData,"humidityWarningMax"), dmin: value(formData,"humidityDangerMin"), dmax: value(formData,"humidityDangerMax") };
    const smoke = { nmin: value(formData,"smokeNormalMin"), nmax: value(formData,"smokeNormalMax"), wmin: value(formData,"smokeWarningMin"), wmax: value(formData,"smokeWarningMax"), dmin: value(formData,"smokeDangerMin"), dmax: value(formData,"smokeDangerMax") };
    for (const result of [validateSensorBand("Temperature", temp), validateSensorBand("Humidity", humidity), validateSensorBand("Smoke", smoke)]) if (result) return { ...initialState, message: result };
    const { error } = await client.from("device_safety_config").upsert({
      device_id: deviceId,
      temperature_normal_min_c: temp.nmin, temperature_normal_max_c: temp.nmax,
      temperature_warning_min_c: temp.wmin, temperature_warning_max_c: temp.wmax,
      temperature_danger_min_c: temp.dmin, temperature_danger_max_c: temp.dmax,
      humidity_normal_min_pct: humidity.nmin, humidity_normal_max_pct: humidity.nmax,
      humidity_warning_min_pct: humidity.wmin, humidity_warning_max_pct: humidity.wmax,
      humidity_danger_min_pct: humidity.dmin, humidity_danger_max_pct: humidity.dmax,
      smoke_normal_min_value: smoke.nmin, smoke_normal_max_value: smoke.nmax,
      smoke_warning_min_value: smoke.wmin, smoke_warning_max_value: smoke.wmax,
      smoke_danger_min_value: smoke.dmin, smoke_danger_max_value: smoke.dmax,
      warning_server_alarm: formData.get("warningServerAlarm") === "on",
      danger_server_alarm: formData.get("dangerServerAlarm") === "on",
      updated_at: new Date().toISOString(),
    });
    if (error) return { ...initialState, message: "The sensor configuration could not be saved." };
  }

  const { error: deviceError } = await client.from("devices").update({
    area_id: areaId,
    iot_role: iotRole,
    doorlock_mode: iotRole === "doorlock" ? doorlockMode : null,
    updated_at: new Date().toISOString(),
  }).eq("id", deviceId);
  if (deviceError) return { ...initialState, message: "The device target/configuration could not be saved." };

  revalidatePath("/devices");
  revalidatePath("/areas");
  revalidatePath("/");
  return { success: true, message: "Device configuration saved." };
}
