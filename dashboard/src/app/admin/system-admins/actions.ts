"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type PromoteSystemAdminState = { success: boolean; message: string };
export type CreateWarehouseState = { success: boolean; message: string };

const profileIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function assignSystemAdmin(formData: FormData) {
  const warehouseId = String(formData.get("warehouseId") ?? "");
  const systemAdminId = String(formData.get("systemAdminId") ?? "");

  if (!warehouseId) redirect("/admin/system-admins?status=invalid");

  const client = await createClient();
  const { error } = await client.rpc("assign_system_admin", {
    target_warehouse_id: warehouseId,
    target_system_admin_id: systemAdminId || null,
  });

  if (error) redirect("/admin/system-admins?status=error");

  revalidatePath("/admin/system-admins");
  revalidatePath("/");
  redirect("/admin/system-admins?status=success");
}

export async function promoteProfileToSystemAdmin(
  formData: FormData,
): Promise<PromoteSystemAdminState> {
  const profileId = String(formData.get("profileId") ?? "").trim();
  if (!profileIdPattern.test(profileId)) {
    return { success: false, message: "The profile request was invalid." };
  }

  const client = await createClient();
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || !authData.user) {
    return { success: false, message: "You must be signed in to manage profiles." };
  }

  const { data: caller, error: callerError } = await client
    .from("profiles")
    .select("role")
    .eq("id", authData.user.id)
    .maybeSingle<{ role: string | null }>();
  if (callerError || caller?.role !== "father_admin") {
    return { success: false, message: "Only the Father Admin can promote profiles." };
  }

  const { data: target, error: targetError } = await client
    .from("profiles")
    .select("id,role")
    .eq("id", profileId)
    .maybeSingle<{ id: string; role: string | null }>();
  if (targetError || !target) {
    return { success: false, message: "The profile could not be found." };
  }
  if (target.role !== null) {
    return { success: false, message: "Only an unassigned profile can be promoted." };
  }

  const { error: updateError } = await client
    .from("profiles")
    .update({ role: "system_admin" })
    .eq("id", profileId)
    .is("role", null);
  if (updateError) {
    return { success: false, message: "The profile promotion was rejected by the server." };
  }

  revalidatePath("/admin/system-admins");
  return { success: true, message: "Profile promoted to System Admin." };
}

export async function createWarehouse(
  formData: FormData,
): Promise<CreateWarehouseState> {
  const name = String(formData.get("name") ?? "").trim();
  const systemAdminId = String(formData.get("systemAdminId") ?? "").trim();
  if (!name || !systemAdminId || !profileIdPattern.test(systemAdminId)) {
    return { success: false, message: "Enter a warehouse name and select a System Admin." };
  }

  const client = await createClient();
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || !authData.user) {
    return { success: false, message: "You must be signed in to create a warehouse." };
  }

  const { data: caller, error: callerError } = await client
    .from("profiles")
    .select("role")
    .eq("id", authData.user.id)
    .maybeSingle<{ role: string | null }>();
  if (callerError || caller?.role !== "father_admin") {
    return { success: false, message: "Only the Father Admin can create warehouses." };
  }

  const { data: target, error: targetError } = await client
    .from("profiles")
    .select("id")
    .eq("id", systemAdminId)
    .eq("role", "system_admin")
    .maybeSingle<{ id: string }>();
  if (targetError || !target) {
    return { success: false, message: "Select an eligible System Admin." };
  }

  const { error: insertError } = await client.from("warehouses").insert({
    owner_id: authData.user.id,
    system_admin_id: systemAdminId,
    name,
  });
  if (insertError) {
    return { success: false, message: "The warehouse could not be created." };
  }

  revalidatePath("/admin/system-admins");
  revalidatePath("/");
  return { success: true, message: "Warehouse created." };
}
