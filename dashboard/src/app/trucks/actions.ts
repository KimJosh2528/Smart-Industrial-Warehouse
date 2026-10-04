"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { credentialManagementDiagnostic, credentialManagementError, invokeCredentialManagement } from "@/lib/credential-management";

export type TruckMutationState = { success: boolean; message: string };
export type TruckCredentialMutationState = { success: boolean; message: string };
export type TruckCredentialViewState = { success: boolean; message: string; credentialValue?: string; credentialId?: string };
const initial: TruckMutationState = { success: false, message: "" };
const credentialInitial: TruckCredentialMutationState = { success: false, message: "" };

function truckError(message: string | undefined) {
  if (message?.includes("warehouse_not_owned") || message?.includes("truck_not_owned")) return "You are not authorized to manage that warehouse truck.";
  if (message?.includes("truck_identity_required")) return "Enter a truck identity.";
  if (message?.includes("truck_plate_required")) return "Enter a plate number.";
  if (message?.includes("invalid_truck_division")) return "Select a valid truck division.";
  if (message?.includes("trucks_warehouse_id_normalized_plate_key")) return "That plate is already registered in this warehouse.";
  if (message?.includes("truck_identity_immutable")) return "Registered plate identity cannot be changed.";
  if (message?.includes("not_authenticated")) return "You must be signed in to manage trucks.";
  return "The truck change could not be completed.";
}

async function authenticatedClient() {
  const client = await createClient();
  const { data } = await client.auth.getUser();
  return data.user ? client : null;
}

export async function createTruck(_previous: TruckMutationState = initial, formData: FormData): Promise<TruckMutationState> {
  const warehouseId = String(formData.get("warehouseId") ?? "");
  const identityLabel = String(formData.get("identityLabel") ?? "");
  const plateNumber = String(formData.get("plateNumber") ?? "");
  const division = String(formData.get("division") ?? "");
  const isActive = formData.get("isActive") === "on";
  if (!warehouseId || !identityLabel.trim() || !plateNumber.trim()) return { ...initial, message: "Enter the truck identity and plate number." };

  const client = await authenticatedClient();
  if (!client) return { ...initial, message: "You must be signed in to create trucks." };
  const { error } = await client.rpc("create_truck", {
    p_warehouse_id: warehouseId,
    p_identity_label: identityLabel,
    p_plate_number: plateNumber,
    p_division: division || null,
    p_is_active: isActive,
  });
  if (error) return { ...initial, message: truckError(error.message) };
  revalidatePath("/trucks");
  revalidatePath("/");
  return { success: true, message: "Truck created." };
}

export async function updateTruck(_previous: TruckMutationState = initial, formData: FormData): Promise<TruckMutationState> {
  const truckId = String(formData.get("truckId") ?? "");
  const identityLabel = String(formData.get("identityLabel") ?? "");
  const plateNumber = String(formData.get("plateNumber") ?? "");
  const division = String(formData.get("division") ?? "");
  const isActive = formData.get("isActive") === "on";
  if (!truckId || !identityLabel.trim() || !plateNumber.trim()) return { ...initial, message: "Enter the truck identity and plate number." };

  const client = await authenticatedClient();
  if (!client) return { ...initial, message: "You must be signed in to update trucks." };
  const { error } = await client.rpc("update_truck", {
    p_truck_id: truckId,
    p_identity_label: identityLabel,
    p_plate_number: plateNumber,
    p_division: division || null,
    p_is_active: isActive,
  });
  if (error) return { ...initial, message: truckError(error.message) };
  revalidatePath("/trucks");
  return { success: true, message: "Truck updated." };
}

export async function setTruckActive(_previous: TruckMutationState = initial, formData: FormData): Promise<TruckMutationState> {
  const truckId = String(formData.get("truckId") ?? "");
  const isActive = String(formData.get("isActive") ?? "") === "true";
  if (!truckId) return { ...initial, message: "The truck request was invalid." };

  const client = await authenticatedClient();
  if (!client) return { ...initial, message: "You must be signed in to change truck status." };
  const { error } = await client.rpc("set_truck_active", { p_truck_id: truckId, p_is_active: isActive });
  if (error) return { ...initial, message: truckError(error.message) };
  revalidatePath("/trucks");
  revalidatePath("/drivers");
  return { success: true, message: isActive ? "Truck activated." : "Truck deactivated." };
}

export async function manageTruckCredential(
  _previous: TruckCredentialMutationState = credentialInitial,
  formData: FormData,
): Promise<TruckCredentialMutationState> {
  const truckId = String(formData.get("truckId") ?? "");
  const credentialType = String(formData.get("credentialType") ?? "");
  const credentialId = String(formData.get("credentialId") ?? "");
  const rawCredential = String(formData.get("rawCredential") ?? "");
  const operation = String(formData.get("operation") ?? "");

  if (!truckId || !["truck_rfid", "truck_pin"].includes(credentialType) || !["add", "replace"].includes(operation)) {
    return { ...credentialInitial, message: "The credential request was invalid." };
  }
  if (operation === "replace" && !credentialId) return { ...credentialInitial, message: "The credential request was invalid." };
  if (!rawCredential.trim()) return { ...credentialInitial, message: "Enter a credential value to continue." };

  const client = await authenticatedClient();
  if (!client) return { ...credentialInitial, message: "You must be signed in to manage truck credentials." };
  const { errorMessage } = await invokeCredentialManagement(client, {
    operation: operation === "add" ? "create" : "replace",
    credential_type: credentialType,
    credential_value: rawCredential,
    credential_id: credentialId || null,
    truck_id: truckId,
  });
  if (errorMessage) return { ...credentialInitial, message: credentialManagementError(errorMessage, "The truck credential change could not be completed.") };

  revalidatePath("/trucks");
  return { success: true, message: operation === "add" ? "Credential added." : "Credential replaced." };
}

export async function setTruckCredentialActive(
  _previous: TruckCredentialMutationState = credentialInitial,
  formData: FormData,
): Promise<TruckCredentialMutationState> {
  const truckId = String(formData.get("truckId") ?? "");
  const credentialId = String(formData.get("credentialId") ?? "");
  const credentialType = String(formData.get("credentialType") ?? "");
  const operation = String(formData.get("operation") ?? "");
  if (!truckId || !credentialId || !["truck_rfid", "truck_pin"].includes(credentialType) || !["activate", "deactivate"].includes(operation)) {
    return { ...credentialInitial, message: "The credential request was invalid." };
  }

  const client = await authenticatedClient();
  if (!client) return { ...credentialInitial, message: "You must be signed in to manage truck credentials." };
  const { errorMessage } = await invokeCredentialManagement(client, {
    operation,
    credential_type: credentialType,
    credential_id: credentialId,
  });
  if (errorMessage) return { ...credentialInitial, message: credentialManagementError(errorMessage, "The truck credential status could not be changed.") };

  revalidatePath("/trucks");
  return { success: true, message: operation === "activate" ? "Credential reactivated." : "Credential deactivated." };
}

export async function viewTruckCredential(
  _previous: TruckCredentialViewState,
  formData: FormData,
): Promise<TruckCredentialViewState> {
  const credentialId = String(formData.get("credentialId") ?? "");
  const credentialType = String(formData.get("credentialType") ?? "");
  if (!credentialId || !["truck_rfid", "truck_pin"].includes(credentialType)) {
    return { success: false, message: "The credential request was invalid." };
  }

  const client = await authenticatedClient();
  if (!client) return { success: false, message: "You must be signed in to view credentials." };
  const { data, errorMessage, errorCode, errorStatus } = await invokeCredentialManagement(client, {
    operation: "view",
    credential_type: credentialType,
    credential_id: credentialId,
  });
  if (errorMessage || !data?.credential_value) {
    return { success: false, message: credentialManagementDiagnostic(errorCode ?? errorMessage, errorStatus) };
  }
  return { success: true, message: "Credential value loaded.", credentialValue: data.credential_value, credentialId: data.credential_id };
}
