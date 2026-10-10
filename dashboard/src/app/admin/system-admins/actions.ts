"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { registrationOrigin } from "@/lib/account-claim-server";

export type PromoteSystemAdminState = { success: boolean; message: string };
export type CreateWarehouseState = { success: boolean; message: string };
export type SystemAdminApplicationActionState = { success: boolean; message: string; registrationLink?: string; expiresAt?: string };
export type DeleteOwnershipState = { success: boolean; message: string };
export type ProvisionDeviceState = { success: boolean; message: string; deviceUid?: string; deviceSecret?: string };

const profileIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function deleteSystemAdminOwnership(
  _previous: DeleteOwnershipState = { success: false, message: "" },
  formData: FormData,
): Promise<DeleteOwnershipState> {
  const warehouseId = String(formData.get("warehouseId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!profileIdPattern.test(warehouseId) || reason.length < 3) return { success: false, message: "Enter a valid deletion reason." };
  const { client, authorized } = await getFatherAdminClient();
  if (!authorized) return { success: false, message: "Only the Father Admin can delete ownership." };
  const { error } = await client.rpc("delete_system_admin_ownership", { p_warehouse_id: warehouseId, p_reason: reason });
  if (error) return { success: false, message: `Supabase rejected the deletion: ${error.message}` };
  revalidatePath("/admin/system-admins");
  redirect("/admin/system-admins?status=ownership-deleted");
}

async function requireFatherAdmin() {
  const { client, authorized } = await getFatherAdminClient();
  return authorized ? client : null;
}

export async function createDeviceInventory(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) redirect("/admin/system-admins?status=invalid");
  const client = await requireFatherAdmin();
  if (!client) redirect("/admin/system-admins?status=error");
  const { error } = await client.rpc("create_device_inventory", {
    p_name: name,
    p_device_type: "warehouse_device",
    p_iot_role: null,
    p_serial_number: null,
  });
  if (error) redirect("/admin/system-admins?status=error");
  revalidatePath("/admin/system-admins");
  redirect("/admin/system-admins?status=device-created");
}

export async function assignDeviceToWarehouse(formData: FormData) {
  const deviceId = String(formData.get("deviceId") ?? "");
  const warehouseId = String(formData.get("warehouseId") ?? "");
  if (!profileIdPattern.test(deviceId) || !profileIdPattern.test(warehouseId)) {
    redirect("/admin/system-admins/devices?status=invalid");
  }
  const client = await requireFatherAdmin();
  if (!client) redirect("/admin/system-admins/devices?status=error");
  const { error } = await client.rpc("assign_device_to_warehouse", {
    p_device_id: deviceId,
    p_warehouse_id: warehouseId,
  });
  if (error) redirect("/admin/system-admins/devices?status=error");
  revalidatePath("/admin/system-admins/devices");
  revalidatePath("/");
  redirect("/admin/system-admins/devices?status=device-assigned");
}

export async function provisionDevice(
  _previous: ProvisionDeviceState = { success: false, message: "" },
  formData: FormData,
): Promise<ProvisionDeviceState> {
  const deviceId = String(formData.get("deviceId") ?? "");
  const rotate = String(formData.get("rotate") ?? "") === "true";
  if (!profileIdPattern.test(deviceId)) return { success: false, message: "Select a valid device." };
  const client = await requireFatherAdmin();
  if (!client) return { success: false, message: "Only the Father Admin can provision devices." };
  const { data, error } = await client.functions.invoke("provision-device", { body: { device_id: deviceId, rotate } });
  if (error || !data?.device_uid || !data?.device_secret) return { success: false, message: data?.message ?? error?.message ?? "The device could not be provisioned." };
  revalidatePath("/admin/system-admins/devices");
  return { success: true, message: "Device provisioned. Save these credentials now; the secret will not be shown again.", deviceUid: data.device_uid, deviceSecret: data.device_secret };
}

export async function reserveDeviceForApplication(formData: FormData) {
  const deviceId = String(formData.get("deviceId") ?? "");
  const applicationId = String(formData.get("applicationId") ?? "");
  if (!profileIdPattern.test(deviceId) || !profileIdPattern.test(applicationId)) redirect("/admin/system-admins?status=invalid");
  const client = await requireFatherAdmin();
  if (!client) redirect("/admin/system-admins?status=error");
  const { error } = await client.rpc("reserve_device_for_application", {
    p_device_id: deviceId,
    p_application_id: applicationId,
  });
  if (error) redirect("/admin/system-admins?status=error");
  revalidatePath("/admin/system-admins");
  redirect("/admin/system-admins?status=device-assigned");
}

export async function regenerateSystemAdminClaimLink(
  _previous: SystemAdminApplicationActionState = { success: false, message: "" },
  formData: FormData,
): Promise<SystemAdminApplicationActionState> {
  const applicationId = String(formData.get("applicationId") ?? "");
  if (!profileIdPattern.test(applicationId)) return { success: false, message: "The application request was invalid." };
  const { client, authorized } = await getFatherAdminClient();
  if (!authorized) return { success: false, message: "Only the Father Admin can regenerate claim links." };
  const { data, error } = await client.rpc("regenerate_system_admin_claim_link", { p_application_id: applicationId });
  if (error) {
    const detail = error.message.toLowerCase();
    if (detail.includes("only_father_admin")) return { success: false, message: "The current session is not Father Admin. Log out and sign in as Father Admin." };
    if (detail.includes("not_eligible")) return { success: false, message: "This application is no longer eligible for a claim link." };
    return { success: false, message: `Supabase rejected the request: ${error.message}` };
  }
  if (!data?.[0]?.raw_token) return { success: false, message: "Supabase returned no claim link." };
  const result = data[0] as { raw_token: string; expires_at: string };
  revalidatePath("/admin/system-admins");
  return { success: true, message: "New one-time claim link created.", registrationLink: `${registrationOrigin()}/register/system-admin/${result.raw_token}`, expiresAt: result.expires_at };
}

async function getFatherAdminClient() {
  const client = await createClient();
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || !authData.user) return { client, authorized: false };
  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("role")
    .eq("id", authData.user.id)
    .maybeSingle<{ role: string | null }>();
  return { client, authorized: !profileError && profile?.role === "father_admin" };
}

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

export async function approveSystemAdminApplication(
  _previous: SystemAdminApplicationActionState = { success: false, message: "" },
  formData: FormData,
): Promise<SystemAdminApplicationActionState> {
  const applicationId = String(formData.get("applicationId") ?? "");
  if (!profileIdPattern.test(applicationId)) return { success: false, message: "The application request was invalid." };
  const { client, authorized } = await getFatherAdminClient();
  if (!authorized) return { success: false, message: "Only the Father Admin can approve applications." };
  const { data, error } = await client.rpc("approve_system_admin_application", {
    p_application_id: applicationId,
  });
  if (error || !data?.[0]?.raw_token) return { success: false, message: "The application could not be approved." };
  const result = data[0] as { raw_token: string; expires_at: string };
  revalidatePath("/admin/system-admins");
  return { success: true, message: "Application approved. Send this one-time claim link to the applicant.", registrationLink: `${registrationOrigin()}/register/system-admin/${result.raw_token}`, expiresAt: result.expires_at };
}

export async function rejectSystemAdminApplication(
  _previous: SystemAdminApplicationActionState = { success: false, message: "" },
  formData: FormData,
): Promise<SystemAdminApplicationActionState> {
  const applicationId = String(formData.get("applicationId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!profileIdPattern.test(applicationId)) return { success: false, message: "The application request was invalid." };
  const { client, authorized } = await getFatherAdminClient();
  if (!authorized) return { success: false, message: "Only the Father Admin can reject applications." };
  const { error } = await client.rpc("reject_system_admin_application", { p_application_id: applicationId, p_rejection_reason: reason || null });
  if (error) return { success: false, message: "The application could not be rejected." };
  revalidatePath("/admin/system-admins");
  return { success: true, message: "Application rejected." };
}
