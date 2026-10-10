"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { resolveAuthorizedWarehouseId } from "@/lib/warehouse-scope";

export type AreaMutationState = { success: boolean; message: string };
const initialState: AreaMutationState = { success: false, message: "" };

export async function saveRoomEnvironmentConfig(
  _previous: AreaMutationState = initialState,
  formData: FormData,
): Promise<AreaMutationState> {
  const areaId = String(formData.get("areaId") ?? "");
  if (!areaId) return { success: false, message: "Room configuration is missing its room." };
  const numberOrNull = (name: string) => {
    const value = String(formData.get(name) ?? "").trim();
    return value === "" ? null : Number(value);
  };
  const client = await createClient();
  const { data: area } = await client.from("warehouse_areas").select("id,warehouse_id,area_type_code").eq("id", areaId).maybeSingle();
  if (!area || area.area_type_code !== "room") return { success: false, message: "That room is not available in your warehouse." };
  const warehouseId = await resolveAuthorizedWarehouseId(client, area.warehouse_id);
  if (!warehouseId) return { success: false, message: "You are not authorized to change this room." };
  const values = {
    area_id: areaId,
    warehouse_id: warehouseId,
    temperature_min_c: numberOrNull("temperatureMinC"),
    temperature_max_c: numberOrNull("temperatureMaxC"),
    temperature_warning_low_c: numberOrNull("temperatureWarningLowC"),
    temperature_danger_low_c: numberOrNull("temperatureDangerLowC"),
    temperature_warning_high_c: numberOrNull("temperatureWarningHighC"),
    temperature_danger_high_c: numberOrNull("temperatureDangerHighC"),
    humidity_min_pct: numberOrNull("humidityMinPct"),
    humidity_max_pct: numberOrNull("humidityMaxPct"),
    humidity_warning_low_pct: numberOrNull("humidityWarningLowPct"),
    humidity_danger_low_pct: numberOrNull("humidityDangerLowPct"),
    humidity_warning_high_pct: numberOrNull("humidityWarningHighPct"),
    humidity_danger_high_pct: numberOrNull("humidityDangerHighPct"),
    smoke_max_value: numberOrNull("smokeMaxValue"),
    smoke_warning_value: numberOrNull("smokeWarningValue"),
    smoke_danger_value: numberOrNull("smokeDangerValue"),
    gas_exposure_seconds: numberOrNull("gasExposureSeconds"),
  };
  const numericValues = Object.values(values).filter((value): value is number => typeof value === "number");
  if (numericValues.some((value) => !Number.isFinite(value))) return { success: false, message: "Enter valid numeric threshold values." };
  if (numericValues.some((value) => value < 0)) return { success: false, message: "Threshold values cannot be negative." };
  const ordered = [
    [values.temperature_danger_low_c, values.temperature_warning_low_c, values.temperature_min_c, values.temperature_max_c, values.temperature_warning_high_c, values.temperature_danger_high_c],
    [values.humidity_danger_low_pct, values.humidity_warning_low_pct, values.humidity_min_pct, values.humidity_max_pct, values.humidity_warning_high_pct, values.humidity_danger_high_pct],
    [values.smoke_warning_value, values.smoke_danger_value],
  ];
  if (ordered.some((band) => band.filter((value): value is number => value !== null).some((value, index, list) => index > 0 && value < list[index - 1]))) return { success: false, message: "Keep each threshold band in low-to-high order." };
  const humidityValues = [values.humidity_danger_low_pct, values.humidity_warning_low_pct, values.humidity_min_pct, values.humidity_max_pct, values.humidity_warning_high_pct, values.humidity_danger_high_pct].filter((value): value is number => value !== null);
  if (humidityValues.some((value) => value > 100)) return { success: false, message: "Humidity thresholds must be between 0 and 100%." };
  if (values.gas_exposure_seconds !== null && values.gas_exposure_seconds <= 0) return { success: false, message: "Gas exposure duration must be greater than zero." };
  const { error } = await client.from("room_environment_configs").upsert(values, { onConflict: "area_id" });
  if (error) return { success: false, message: "The room threshold configuration could not be saved." };
  revalidatePath("/areas");
  revalidatePath("/room-settings");
  revalidatePath("/sensor-demo");
  revalidatePath("/sensor-readings");
  return { success: true, message: "Room threshold configuration saved." };
}
const allowedStates = ["locked", "unlocked", "emergency_release"] as const;

function safeAreaError(message: string | undefined, operation: "add" | "state" | "delete") {
  if (message?.includes("duplicate key") || message?.includes("warehouse_areas_warehouse_id_area_type_code_key")) return "That area is already configured for this warehouse.";
  if (message?.includes("row-level security") || message?.includes("not authorized")) return "You are not authorized to change this warehouse.";
  if (message?.includes("foreign key")) return "That area type is not available.";
  if (operation === "delete") return "The area could not be deleted. Remove its related assignments first.";
  return operation === "add" ? "The warehouse area could not be added." : "The area state could not be updated.";
}

export async function addWarehouseArea(
  _previous: AreaMutationState = initialState,
  formData: FormData,
): Promise<AreaMutationState> {
  const warehouseId = String(formData.get("warehouseId") ?? "");
  const areaTypeCode = String(formData.get("areaTypeCode") ?? "");
  const requestedName = String(formData.get("name") ?? "").trim();
  const name = areaTypeCode === "staff_entrance" ? "Staff Main Entrance" : areaTypeCode === "truck_entrance" ? "Truck Entrance" : requestedName;
  const entranceCategory = areaTypeCode === "staff_entrance" ? "staff_main" : areaTypeCode === "truck_entrance" ? "truck_main" : null;
  if (!warehouseId || !areaTypeCode || !name) return { ...initialState, message: "Area type and name are required." };

  const client = await createClient();
  const authorizedWarehouseId = await resolveAuthorizedWarehouseId(client, warehouseId);
  if (!authorizedWarehouseId) return { ...initialState, message: "You are not authorized to change this warehouse." };

  const { data: knownType, error: typeError } = await client.from("warehouse_area_types").select("code").eq("code", areaTypeCode).maybeSingle();
  if (typeError || !knownType) return { ...initialState, message: "That area type is not available." };

  const { error } = await client.from("warehouse_areas").insert({ warehouse_id: authorizedWarehouseId, name, area_type_code: areaTypeCode, entrance_category: entranceCategory || null, state: "locked" });
  if (error) return { ...initialState, message: safeAreaError(error.message, "add") };

  revalidatePath("/areas");
  revalidatePath("/staff");
  return { success: true, message: "Warehouse area added." };
}

export async function updateWarehouseAreaState(
  _previous: AreaMutationState = initialState,
  formData: FormData,
): Promise<AreaMutationState> {
  const areaId = String(formData.get("areaId") ?? "");
  const state = String(formData.get("state") ?? "");
  if (!areaId || !allowedStates.includes(state as (typeof allowedStates)[number])) return { ...initialState, message: "The area state request was invalid." };

  const client = await createClient();
  const { data: authData } = await client.auth.getUser();
  if (!authData.user) return { ...initialState, message: "You must be signed in to manage warehouse areas." };

  const { data: area, error: areaError } = await client.from("warehouse_areas").select("id").eq("id", areaId).maybeSingle();
  if (areaError || !area) return { ...initialState, message: "You are not authorized to change this area." };

  const { error } = await client.from("warehouse_areas").update({ state }).eq("id", areaId);
  if (error) return { ...initialState, message: safeAreaError(error.message, "state") };

  revalidatePath("/areas");
  revalidatePath("/staff");
  return { success: true, message: "Area state updated." };
}

export async function deleteWarehouseArea(
  _previous: AreaMutationState = initialState,
  formData: FormData,
): Promise<AreaMutationState> {
  const areaId = String(formData.get("areaId") ?? "");
  if (!areaId) return { ...initialState, message: "The area deletion request was invalid." };

  const client = await createClient();
  const { data: area, error: areaError } = await client.from("warehouse_areas").select("id,warehouse_id").eq("id", areaId).maybeSingle<{ id: string; warehouse_id: string }>();
  if (areaError || !area) return { ...initialState, message: "You are not authorized to delete this area." };
  const authorizedWarehouseId = await resolveAuthorizedWarehouseId(client, area.warehouse_id);
  if (!authorizedWarehouseId) return { ...initialState, message: "You are not authorized to delete this area." };

  const { error } = await client.from("warehouse_areas").delete().eq("id", areaId).eq("warehouse_id", authorizedWarehouseId);
  if (error) return { ...initialState, message: safeAreaError(error.message, "delete") };

  revalidatePath("/areas");
  revalidatePath("/staff");
  return { success: true, message: "Warehouse area deleted." };
}

export type DepartmentAreaMutationState = { success: boolean; message: string };
const departmentAreaInitial: DepartmentAreaMutationState = { success: false, message: "" };

function departmentAreaError(message: string | undefined) {
  if (message?.includes("department_not_owned") || message?.includes("cross_warehouse_department_area")) return "The department and area must belong to the same authorized warehouse.";
  if (message?.includes("area_not_found")) return "That warehouse area is no longer available.";
  if (message?.includes("department_area_default_exists")) return "That area is already associated with this department.";
  if (message?.includes("not_authenticated")) return "You must be signed in to manage department areas.";
  return "The department area association could not be changed.";
}

export async function addDepartmentAreaDefault(
  _previous: DepartmentAreaMutationState = departmentAreaInitial,
  formData: FormData,
): Promise<DepartmentAreaMutationState> {
  const departmentId = String(formData.get("departmentId") ?? "");
  const areaId = String(formData.get("areaId") ?? "");
  if (!departmentId || !areaId) return { ...departmentAreaInitial, message: "Select a warehouse area." };

  const client = await createClient();
  const { data: authData } = await client.auth.getUser();
  if (!authData.user) return { ...departmentAreaInitial, message: "You must be signed in to manage department areas." };

  const { error } = await client.rpc("add_department_area_default", {
    p_department_id: departmentId,
    p_area_id: areaId,
  });
  if (error) return { ...departmentAreaInitial, message: departmentAreaError(error.message) };

  revalidatePath("/areas");
  return { success: true, message: "Default area associated." };
}

export async function removeDepartmentAreaDefault(
  _previous: DepartmentAreaMutationState = departmentAreaInitial,
  formData: FormData,
): Promise<DepartmentAreaMutationState> {
  const departmentId = String(formData.get("departmentId") ?? "");
  const areaId = String(formData.get("areaId") ?? "");
  if (!departmentId || !areaId) return { ...departmentAreaInitial, message: "The department area request was invalid." };

  const client = await createClient();
  const { data: authData } = await client.auth.getUser();
  if (!authData.user) return { ...departmentAreaInitial, message: "You must be signed in to manage department areas." };

  const { error } = await client.rpc("remove_department_area_default", {
    p_department_id: departmentId,
    p_area_id: areaId,
  });
  if (error) return { ...departmentAreaInitial, message: departmentAreaError(error.message) };

  revalidatePath("/areas");
  return { success: true, message: "Default area association removed." };
}

export type DepartmentMutationState = { success: boolean; message: string };
const departmentInitial: DepartmentMutationState = { success: false, message: "" };

function departmentError(message: string | undefined, operation: "save" | "active") {
  if (message?.includes("department_name_required")) return "Department name is required.";
  if (message?.includes("department_code_required")) return "Department code is required.";
  if (message?.includes("duplicate key") || message?.includes("departments_warehouse_id_name_key") || message?.includes("departments_warehouse_id_code_key")) return "That department name or code is already in use.";
  if (message?.includes("department_not_owned") || message?.includes("warehouse_not_owned") || message?.includes("row-level security")) return "You are not authorized to manage this department.";
  if (message?.includes("not_authenticated")) return "You must be signed in to manage departments.";
  return operation === "save" ? "The department could not be saved." : "The department status could not be updated.";
}

export async function createDepartment(
  _previous: DepartmentMutationState = departmentInitial,
  formData: FormData,
): Promise<DepartmentMutationState> {
  const warehouseId = String(formData.get("warehouseId") ?? "");
  const name = String(formData.get("name") ?? "");
  const code = String(formData.get("code") ?? "");
  if (!warehouseId || !name.trim() || !code.trim()) return { ...departmentInitial, message: "Department name and code are required." };

  const client = await createClient();
  const authorizedWarehouseId = await resolveAuthorizedWarehouseId(client, warehouseId);
  if (!authorizedWarehouseId) return { ...departmentInitial, message: "You are not authorized to manage this warehouse." };

  const { error } = await client.rpc("create_department", {
    p_warehouse_id: authorizedWarehouseId,
    p_name: name,
    p_code: code,
  });
  if (error) return { ...departmentInitial, message: departmentError(error.message, "save") };

  revalidatePath("/areas");
  return { success: true, message: "Department created." };
}

export async function updateDepartment(
  _previous: DepartmentMutationState = departmentInitial,
  formData: FormData,
): Promise<DepartmentMutationState> {
  const departmentId = String(formData.get("departmentId") ?? "");
  const name = String(formData.get("name") ?? "");
  const code = String(formData.get("code") ?? "");
  if (!departmentId || !name.trim() || !code.trim()) return { ...departmentInitial, message: "Department name and code are required." };

  const client = await createClient();
  const { data: authData } = await client.auth.getUser();
  if (!authData.user) return { ...departmentInitial, message: "You must be signed in to manage departments." };

  const { error } = await client.rpc("update_department", {
    p_department_id: departmentId,
    p_name: name,
    p_code: code,
  });
  if (error) return { ...departmentInitial, message: departmentError(error.message, "save") };

  revalidatePath("/areas");
  return { success: true, message: "Department updated." };
}

export async function setDepartmentActive(
  _previous: DepartmentMutationState = departmentInitial,
  formData: FormData,
): Promise<DepartmentMutationState> {
  const departmentId = String(formData.get("departmentId") ?? "");
  const isActive = String(formData.get("isActive") ?? "") === "true";
  if (!departmentId) return { ...departmentInitial, message: "The department status request was invalid." };

  const client = await createClient();
  const { data: authData } = await client.auth.getUser();
  if (!authData.user) return { ...departmentInitial, message: "You must be signed in to manage departments." };

  const { error } = await client.rpc("set_department_active", {
    p_department_id: departmentId,
    p_is_active: isActive,
  });
  if (error) return { ...departmentInitial, message: departmentError(error.message, "active") };

  revalidatePath("/areas");
  return { success: true, message: isActive ? "Department activated." : "Department deactivated." };
}
