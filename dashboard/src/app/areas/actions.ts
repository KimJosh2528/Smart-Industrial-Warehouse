"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type AreaMutationState = { success: boolean; message: string };
const initialState: AreaMutationState = { success: false, message: "" };
const allowedStates = ["locked", "unlocked", "emergency_release"] as const;

async function ownerClient() {
  const client = await createClient();
  const { data: authData } = await client.auth.getUser();
  if (!authData.user) return { client, error: "You must be signed in to manage warehouse areas." };
  return { client, error: null };
}

function safeAreaError(message: string | undefined, operation: "add" | "update" | "delete" | "state") {
  if (message?.includes("duplicate key")) return "An area with that name or identifier already exists.";
  if (message?.includes("foreign key") || message?.includes("violates")) return "This area is still being used by another warehouse record. Remove that assignment first.";
  if (message?.includes("row-level security") || message?.includes("not authorized")) return "You are not authorized to change this warehouse.";
  if (operation === "add") return "The warehouse area could not be added.";
  if (operation === "update") return "The warehouse area could not be updated.";
  if (operation === "delete") return "The warehouse area could not be deleted.";
  return "The area state could not be updated.";
}

export async function addWarehouseArea(_previous: AreaMutationState = initialState, formData: FormData): Promise<AreaMutationState> {
  const warehouseId = String(formData.get("warehouseId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!warehouseId || !name) return { ...initialState, message: "Enter an area name." };

  const { client, error: authError } = await ownerClient();
  if (authError) return { ...initialState, message: authError };

  const { data: warehouse } = await client.from("warehouses").select("id").eq("id", warehouseId).maybeSingle();
  if (!warehouse) return { ...initialState, message: "You are not authorized to change this warehouse." };

  const areaTypeCode = `custom_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "area"}_${crypto.randomUUID().slice(0, 8)}`;
  const { error } = await client.from("warehouse_areas").insert({ warehouse_id: warehouseId, area_type_code: areaTypeCode, name, state: "locked" });
  if (error) return { ...initialState, message: safeAreaError(error.message, "add") };

  revalidatePath("/areas");
  revalidatePath("/devices");
  revalidatePath("/");
  return { success: true, message: "Area added." };
}

export async function updateWarehouseArea(_previous: AreaMutationState = initialState, formData: FormData): Promise<AreaMutationState> {
  const areaId = String(formData.get("areaId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!areaId || !name) return { ...initialState, message: "Enter an area name." };

  const { client, error: authError } = await ownerClient();
  if (authError) return { ...initialState, message: authError };

  const { data: area } = await client.from("warehouse_areas").select("id").eq("id", areaId).maybeSingle();
  if (!area) return { ...initialState, message: "That area is no longer available." };

  const { error } = await client.from("warehouse_areas").update({ name }).eq("id", areaId);
  if (error) return { ...initialState, message: safeAreaError(error.message, "update") };

  revalidatePath("/areas");
  revalidatePath("/devices");
  revalidatePath("/");
  return { success: true, message: "Area updated." };
}

export async function deleteWarehouseArea(_previous: AreaMutationState = initialState, formData: FormData): Promise<AreaMutationState> {
  const areaId = String(formData.get("areaId") ?? "");
  if (!areaId) return { ...initialState, message: "The area deletion request was invalid." };

  const { client, error: authError } = await ownerClient();
  if (authError) return { ...initialState, message: authError };

  await client.from("demo_state").update({ active_area_id: null, updated_at: new Date().toISOString() }).eq("active_area_id", areaId);

  const { error } = await client.from("warehouse_areas").delete().eq("id", areaId);
  if (error) return { ...initialState, message: safeAreaError(error.message, "delete") };

  revalidatePath("/areas");
  revalidatePath("/devices");
  revalidatePath("/");
  return { success: true, message: "Area deleted." };
}

export async function setActiveDemoArea(_previous: AreaMutationState = initialState, formData: FormData): Promise<AreaMutationState> {
  const warehouseId = String(formData.get("warehouseId") ?? "");
  const areaId = String(formData.get("areaId") ?? "");
  if (!warehouseId || !areaId) return { ...initialState, message: "Select an area for the demo." };

  const { client, error: authError } = await ownerClient();
  if (authError) return { ...initialState, message: authError };

  const { data: area } = await client.from("warehouse_areas").select("id").eq("id", areaId).eq("warehouse_id", warehouseId).maybeSingle();
  if (!area) return { ...initialState, message: "That area is not available for this warehouse." };

  const { error } = await client.from("demo_state").upsert({ warehouse_id: warehouseId, active_area_id: areaId, updated_at: new Date().toISOString() }, { onConflict: "warehouse_id" });
  if (error) return { ...initialState, message: "The active demo area could not be changed." };

  revalidatePath("/areas");
  revalidatePath("/");
  return { success: true, message: "Active demo area changed." };
}

export async function updateWarehouseAreaState(_previous: AreaMutationState = initialState, formData: FormData): Promise<AreaMutationState> {
  const areaId = String(formData.get("areaId") ?? "");
  const state = String(formData.get("state") ?? "");
  if (!areaId || !allowedStates.includes(state as (typeof allowedStates)[number])) return { ...initialState, message: "The area state request was invalid." };

  const { client, error: authError } = await ownerClient();
  if (authError) return { ...initialState, message: authError };

  const { data: area } = await client.from("warehouse_areas").select("id").eq("id", areaId).maybeSingle();
  if (!area) return { ...initialState, message: "That area is no longer available." };

  const { error } = await client.from("warehouse_areas").update({ state }).eq("id", areaId);
  if (error) return { ...initialState, message: safeAreaError(error.message, "state") };

  revalidatePath("/areas");
  revalidatePath("/devices");
  revalidatePath("/");
  return { success: true, message: "Area state updated." };
}
