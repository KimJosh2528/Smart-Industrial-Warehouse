"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { registrationOrigin } from "@/lib/account-claim-server";
import { resolveAuthorizedWarehouseId } from "@/lib/warehouse-scope";
import { syncCameraPlateRecord } from "@/lib/camera-plates";

export type CreateDriverState = { success: boolean; message: string };
export type DriverAssignmentState = { success: boolean; message: string };
export type AccountClaimState = { success: boolean; message: string; registrationLink?: string; expiresAt?: string };
export type DeleteDriverState = { success: boolean; message: string };
const initial: CreateDriverState = { success: false, message: "" };
const assignmentInitial: DriverAssignmentState = { success: false, message: "" };
const accountClaimInitial: AccountClaimState = { success: false, message: "" };
const deleteDriverInitial: DeleteDriverState = { success: false, message: "" };

function creationError(message: string | undefined) {
  if (message?.includes("warehouse_not_owned")) return "You are not authorized to create drivers in that warehouse.";
  if (message?.includes("driver_name_required")) return "Enter a driver display name.";
  if (message?.includes("driver_code_invalid")) return "Driver code cannot be blank.";
  if (message?.includes("drivers_warehouse_id_driver_code_key")) return "That driver code is already used in this warehouse.";
  if (message?.includes("not_authenticated")) return "You must be signed in to create drivers.";
  return "The driver could not be created.";
}

function assignmentError(message: string | undefined) {
  if (message?.includes("driver_not_owned") || message?.includes("truck_not_owned")) return "That driver or truck is outside your authorized warehouse scope.";
  if (message?.includes("cross_warehouse_assignment")) return "The driver and truck must belong to the same warehouse.";
  if (message?.includes("driver_inactive")) return "An inactive driver cannot be assigned to a truck.";
  if (message?.includes("truck_inactive")) return "An inactive truck cannot be assigned.";
  if (message?.includes("driver_already_assigned")) return "This driver already has a current truck assignment.";
  if (message?.includes("truck_already_assigned")) return "This truck is already assigned to another driver.";
  if (message?.includes("driver_truck_assignment_not_found")) return "That driver is not assigned to this truck.";
  if (message?.includes("not_authenticated")) return "You must be signed in to manage assignments.";
  return "The truck assignment could not be completed.";
}

export async function createDriver(_previous: CreateDriverState = initial, formData: FormData): Promise<CreateDriverState> {
  const warehouseId = String(formData.get("warehouseId") ?? "");
  const displayName = String(formData.get("displayName") ?? "");
  const driverCode = String(formData.get("driverCode") ?? "");
  const isActive = formData.get("isActive") === "on";
  if (!warehouseId || !displayName.trim()) return { ...initial, message: "Enter a driver display name." };

  const client = await createClient();
  const authorizedWarehouseId = await resolveAuthorizedWarehouseId(client, warehouseId);
  if (!authorizedWarehouseId) return { ...initial, message: "You are not authorized to create drivers in that warehouse." };

  const { error } = await client.rpc("create_driver", {
    p_warehouse_id: authorizedWarehouseId,
    p_display_name: displayName,
    p_driver_code: driverCode || null,
    p_is_active: isActive,
  });
  if (error) return { ...initial, message: creationError(error.message) };

  revalidatePath("/drivers");
  revalidatePath("/fleet");
  revalidatePath("/");
  return { success: true, message: "Driver created." };
}

export async function assignDriverToTruck(_previous: DriverAssignmentState = assignmentInitial, formData: FormData): Promise<DriverAssignmentState> {
  const driverId = String(formData.get("driverId") ?? "");
  const truckId = String(formData.get("truckId") ?? "");
  if (!driverId || !truckId) return { ...assignmentInitial, message: "Select a truck to assign." };

  const client = await createClient();
  const { data: authData } = await client.auth.getUser();
  if (!authData.user) return { ...assignmentInitial, message: "You must be signed in to manage assignments." };

  const { error } = await client.rpc("assign_driver_to_truck", {
    p_driver_id: driverId,
    p_truck_id: truckId,
  });
  if (error) return { ...assignmentInitial, message: assignmentError(error.message) };

  const [{ data: truck }, { data: driver }] = await Promise.all([
    client.from("trucks").select("plate_number,identity_label").eq("id", truckId).single(),
    client.from("drivers").select("display_name").eq("id", driverId).single(),
  ]);
  let syncWarning = "";
  if (truck && driver) {
    try {
      await syncCameraPlateRecord({ plate: truck.plate_number, truckName: truck.identity_label, driverName: driver.display_name });
    } catch {
      syncWarning = " Camera server sync is unavailable; the database assignment is still saved.";
    }
  }

  revalidatePath("/drivers");
  revalidatePath("/fleet");
  return { success: true, message: `Truck assigned.${syncWarning}` };
}

export async function unassignDriverFromTruck(_previous: DriverAssignmentState = assignmentInitial, formData: FormData): Promise<DriverAssignmentState> {
  const driverId = String(formData.get("driverId") ?? "");
  const truckId = String(formData.get("truckId") ?? "");
  if (!driverId || !truckId) return { ...assignmentInitial, message: "The assignment request was invalid." };

  const client = await createClient();
  const { data: authData } = await client.auth.getUser();
  if (!authData.user) return { ...assignmentInitial, message: "You must be signed in to manage assignments." };

  const { error } = await client.rpc("unassign_driver_from_truck", {
    p_driver_id: driverId,
    p_truck_id: truckId,
  });
  if (error) return { ...assignmentInitial, message: assignmentError(error.message) };

  const { data: truck } = await client.from("trucks").select("plate_number,identity_label").eq("id", truckId).single();
  if (truck) {
    try { await syncCameraPlateRecord({ plate: truck.plate_number, truckName: truck.identity_label, driverName: null }); } catch { /* DB unassignment remains valid. */ }
  }

  revalidatePath("/drivers");
  revalidatePath("/fleet");
  return { success: true, message: "Truck unassigned." };
}

export async function invokeDriverAccountRequest(
  _previous: AccountClaimState = accountClaimInitial,
  formData: FormData,
): Promise<AccountClaimState> {
  const driverId = String(formData.get("driverId") ?? "");
  if (!driverId) return { ...accountClaimInitial, message: "The account request was invalid." };
  const client = await createClient();
  const { data: authData } = await client.auth.getUser();
  if (!authData.user) return { ...accountClaimInitial, message: "You must be signed in to invite drivers." };
  const { data, error } = await client.rpc("create_account_claim_request_v2", { p_staff_member_id: null, p_driver_id: driverId });
  if (error) return { ...accountClaimInitial, message: claimRequestError(error.message) };
  if (!data?.[0]?.raw_token) return { ...accountClaimInitial, message: "Supabase did not return a registration token." };
  const result = data[0] as { raw_token: string; expires_at: string };
  let syncWarning = "";
  const { data: assignedTruck } = await client
    .from("trucks")
    .select("plate_number,identity_label")
    .eq("current_driver_id", driverId)
    .maybeSingle();
  if (assignedTruck) {
    const { data: driver } = await client.from("drivers").select("display_name").eq("id", driverId).single();
    if (driver) {
      try {
        await syncCameraPlateRecord({ plate: assignedTruck.plate_number, truckName: assignedTruck.identity_label, driverName: driver.display_name });
      } catch {
        syncWarning = " The account was claimed, but plates.txt could not be updated.";
      }
    }
  }
  revalidatePath("/drivers");
  return { success: true, message: `Account request created.${syncWarning}`, registrationLink: `${registrationOrigin()}/register/driver/${result.raw_token}`, expiresAt: result.expires_at };
}

function claimRequestError(message: string) {
  if (message.includes("staff_already_claimed") || message.includes("driver_already_claimed")) return "This account is already claimed.";
  if (message.includes("warehouse_not_owned")) return "This record belongs to a warehouse you cannot manage.";
  if (message.includes("not_authenticated")) return "Your admin session expired. Sign in again.";
  if (message.includes("staff_member_not_found") || message.includes("driver_not_found")) return "The member record no longer exists.";
  return `The account request failed: ${message}`;
}

export async function revokeDriverAccountRequest(
  _previous: AccountClaimState = accountClaimInitial,
  formData: FormData,
): Promise<AccountClaimState> {
  const requestId = String(formData.get("requestId") ?? "");
  if (!requestId) return { ...accountClaimInitial, message: "The account request was invalid." };
  const client = await createClient();
  const { data: authData } = await client.auth.getUser();
  if (!authData.user) return { ...accountClaimInitial, message: "You must be signed in to revoke requests." };
  const { error } = await client.rpc("revoke_account_claim_request", { p_request_id: requestId });
  if (error) return { ...accountClaimInitial, message: "The account request could not be revoked." };
  revalidatePath("/drivers");
  return { success: true, message: "Account request revoked." };
}

export async function deleteDriverRecord(_previous: DeleteDriverState = deleteDriverInitial, formData: FormData): Promise<DeleteDriverState> {
  const driverId = String(formData.get("driverId") ?? "");
  if (!driverId) return { ...deleteDriverInitial, message: "The driver delete request was invalid." };
  const client = await createClient();
  const { data: authData } = await client.auth.getUser();
  if (!authData.user) return { ...deleteDriverInitial, message: "You must be signed in to delete driver records." };
  const { error } = await client.rpc("delete_driver_record", { p_driver_id: driverId });
  if (error) return { ...deleteDriverInitial, message: error.message.includes("driver_not_owned") ? "You are not authorized to delete that driver." : "The driver record could not be deleted." };
  revalidatePath("/fleet");
  revalidatePath("/drivers");
  return { success: true, message: "Driver record deleted; truck kept and unassigned." };
}
