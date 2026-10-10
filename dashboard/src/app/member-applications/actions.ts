"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function saveMemberApplicationAccess(formData: FormData) {
  const applicationId = String(formData.get("applicationId") ?? "");
  const placement = String(formData.get("guardPlacement") ?? "").trim() || null;
  const areaIds = formData.getAll("areaIds").map(String).filter(Boolean);
  const client = await createClient();
  const { error } = await client.rpc("set_member_application_access", {
    p_application_id: applicationId,
    p_guard_placement: placement,
    p_area_ids: areaIds,
  });
  if (error) redirect("/member-applications?access=error");
  revalidatePath("/member-applications");
  redirect("/member-applications?access=saved");
}

export async function assignMemberApplicationRfid(formData: FormData) {
  const applicationId = String(formData.get("applicationId") ?? "");
  const rfidPoolId = String(formData.get("rfidPoolId") ?? "");
  if (!applicationId || !rfidPoolId) redirect("/member-applications?access=error");
  const client = await createClient();
  const { error } = await client.rpc("assign_member_application_rfid", {
    p_application_id: applicationId,
    p_rfid_pool_id: rfidPoolId,
  });
  if (error) redirect("/member-applications?rfid=error");
  revalidatePath("/member-applications");
  redirect("/member-applications?rfid=saved");
}

export async function finalizeMemberApplication(formData: FormData) {
  const applicationId = String(formData.get("applicationId") ?? "");
  const rfidPoolId = String(formData.get("rfidPoolId") ?? "");
  const placement = String(formData.get("guardPlacement") ?? "").trim() || null;
  const areaIds = formData.getAll("areaIds").map(String).filter(Boolean);
  if (!applicationId || !rfidPoolId) redirect("/member-applications?application=error");
  const client = await createClient();
  const { error } = await client.rpc("finalize_member_application", {
    p_application_id: applicationId,
    p_rfid_pool_id: rfidPoolId,
    p_guard_placement: placement,
    p_area_ids: areaIds,
  });
  if (error) redirect("/member-applications?application=error");
  revalidatePath("/member-applications");
  revalidatePath("/staff");
  revalidatePath("/guards");
  redirect("/member-applications?application=saved");
}

export async function finalizeDriverApplication(formData: FormData) {
  const applicationId = String(formData.get("applicationId") ?? "");
  const truckId = String(formData.get("truckId") ?? "");
  if (!applicationId || !truckId) redirect("/member-applications?tab=drivers&driver=missing-truck");
  const client = await createClient();
  const { error } = await client.rpc("finalize_driver_application", {
    p_application_id: applicationId,
    p_truck_id: truckId,
  });
  if (error?.message.includes("truck_not_available_for_assignment")) {
    redirect("/member-applications?tab=drivers&driver=truck-unavailable");
  }
  if (error) redirect("/member-applications?tab=drivers&driver=error");
  revalidatePath("/member-applications");
  revalidatePath("/fleet");
  redirect("/member-applications?tab=drivers&driver=saved");
}
