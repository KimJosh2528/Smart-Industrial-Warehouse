"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { credentialManagementDiagnostic, credentialManagementError, invokeCredentialManagement } from "@/lib/credential-management";
import { registrationOrigin } from "@/lib/account-claim-server";
import { resolveAuthorizedWarehouseId } from "@/lib/warehouse-scope";

export type CredentialMutationState = {
  success: boolean;
  message: string;
  credentialValue?: string;
  credentialId?: string;
};

export type DepartmentAssignmentState = {
  success: boolean;
  message: string;
};

export type StaffPermissionMutationState = {
  success: boolean;
  message: string;
};

export type CreateStaffState = {
  success: boolean;
  message: string;
};
export type AccountClaimState = { success: boolean; message: string; registrationLink?: string; expiresAt?: string };

const initial: CredentialMutationState = { success: false, message: "" };
const createStaffInitial: CreateStaffState = { success: false, message: "" };
const accountClaimInitial: AccountClaimState = { success: false, message: "" };
const permissionInitial: StaffPermissionMutationState = { success: false, message: "" };

function staffCreationError(message: string | undefined) {
  if (message?.includes("warehouse_not_owned")) return "You are not authorized to create staff in that warehouse.";
  if (message?.includes("department_not_owned") || message?.includes("cross_warehouse_department")) return "The selected department is not in that warehouse.";
  if (message?.includes("department_inactive")) return "The selected department is inactive.";
  if (message?.includes("staff_name_required")) return "Enter a staff display name.";
  if (message?.includes("employee_code_invalid")) return "Employee code cannot be blank.";
  if (message?.includes("staff_members_warehouse_id_employee_code_key")) return "That employee code is already used in this warehouse.";
  if (message?.includes("not_authenticated")) return "You must be signed in to create staff.";
  return "The staff member could not be created.";
}

export async function createStaff(_previous: CreateStaffState = createStaffInitial, formData: FormData): Promise<CreateStaffState> {
  const warehouseId = String(formData.get("warehouseId") ?? "");
  const displayName = String(formData.get("displayName") ?? "");
  const employeeCode = String(formData.get("employeeCode") ?? "");
  const departmentId = String(formData.get("departmentId") ?? "");
  const isActive = formData.get("isActive") === "on";
  if (!warehouseId || !displayName.trim()) return { ...createStaffInitial, message: "Enter a staff display name." };

  const client = await createClient();
  const authorizedWarehouseId = await resolveAuthorizedWarehouseId(client, warehouseId);
  if (!authorizedWarehouseId) return { ...createStaffInitial, message: "You are not authorized to create staff in that warehouse." };

  const { error } = await client.rpc("create_staff", {
    p_warehouse_id: authorizedWarehouseId,
    p_display_name: displayName,
    p_employee_code: employeeCode || null,
    p_department_id: departmentId || null,
    p_is_active: isActive,
  });
  if (error) return { ...createStaffInitial, message: staffCreationError(error.message) };

  revalidatePath("/staff");
  return { success: true, message: "Staff member created as unclaimed." };
}

export async function manageStaffCredential(
  _previous: CredentialMutationState = initial,
  formData: FormData,
): Promise<CredentialMutationState> {
  const staffMemberId = String(formData.get("staffMemberId") ?? "");
  const credentialType = String(formData.get("credentialType") ?? "");
  const credentialId = String(formData.get("credentialId") ?? "");
  const rawCredential = String(formData.get("rawCredential") ?? "");
  const operation = String(formData.get("operation") ?? "");

  if (!staffMemberId || !["staff_rfid", "staff_pin"].includes(credentialType)) return { ...initial, message: "The credential request was invalid." };
  if (!["add", "replace"].includes(operation)) return { ...initial, message: "The credential request was invalid." };
  if (operation === "replace" && !credentialId) return { ...initial, message: "The credential request was invalid." };
  if (!rawCredential.trim()) return { ...initial, message: "Enter the credential value to continue." };

  const client = await createClient();
  const { data: authData } = await client.auth.getUser();
  if (!authData.user) return { ...initial, message: "You must be signed in to manage credentials." };

  const { errorMessage } = await invokeCredentialManagement(client, {
    operation: operation === "add" ? "create" : "replace",
    credential_type: credentialType,
    credential_value: rawCredential,
    credential_id: credentialId || null,
    staff_member_id: staffMemberId,
  });

  if (errorMessage) return { ...initial, message: credentialManagementError(errorMessage, "The credential change could not be completed.") };

  revalidatePath("/staff");
  return { success: true, message: operation === "add" ? "Credential added." : "Credential replaced." };
}

export async function setStaffCredentialActive(
  _previous: CredentialMutationState,
  formData: FormData,
): Promise<CredentialMutationState> {
  const staffMemberId = String(formData.get("staffMemberId") ?? "");
  const credentialId = String(formData.get("credentialId") ?? "");
  const credentialType = String(formData.get("credentialType") ?? "");
  const operation = String(formData.get("operation") ?? "");
  if (!staffMemberId || !credentialId || !["staff_rfid", "staff_pin"].includes(credentialType) || !["activate", "deactivate"].includes(operation)) {
    return { ...initial, message: "The credential request was invalid." };
  }

  const client = await createClient();
  const { data: authData } = await client.auth.getUser();
  if (!authData.user) return { ...initial, message: "You must be signed in to manage credentials." };

  const { errorMessage } = await invokeCredentialManagement(client, {
    operation,
    credential_type: credentialType,
    credential_id: credentialId,
  });
  if (errorMessage) return { ...initial, message: credentialManagementError(errorMessage, "The credential status could not be changed.") };

  revalidatePath("/staff");
  return { success: true, message: operation === "activate" ? "Credential reactivated." : "Credential deactivated." };
}

export async function viewStaffCredential(
  _previous: CredentialMutationState,
  formData: FormData,
): Promise<CredentialMutationState> {
  const credentialId = String(formData.get("credentialId") ?? "");
  const credentialType = String(formData.get("credentialType") ?? "");
  if (!credentialId || !["staff_rfid", "staff_pin"].includes(credentialType)) {
    return { ...initial, message: "The credential request was invalid." };
  }

  const client = await createClient();
  const { data: authData } = await client.auth.getUser();
  if (!authData.user) return { ...initial, message: "You must be signed in to view credentials." };

  const { data, errorMessage, errorCode, errorStatus } = await invokeCredentialManagement(client, {
    operation: "view",
    credential_type: credentialType,
    credential_id: credentialId,
  });
  if (errorMessage || !data?.credential_value) {
    return { ...initial, message: credentialManagementDiagnostic(errorCode ?? errorMessage, errorStatus) };
  }
  return { success: true, message: "Credential value loaded.", credentialValue: data.credential_value, credentialId: data.credential_id };
}

export async function assignStaffDepartment(
  _previous: DepartmentAssignmentState,
  formData: FormData,
): Promise<DepartmentAssignmentState> {
  const staffMemberId = String(formData.get("staffMemberId") ?? "");
  const departmentId = String(formData.get("departmentId") ?? "");
  if (!staffMemberId) return { success: false, message: "The department request was invalid." };

  const client = await createClient();
  const { data: authData } = await client.auth.getUser();
  if (!authData.user) return { success: false, message: "You must be signed in to assign departments." };

  const { error } = await client.rpc("assign_staff_department", {
    p_staff_member_id: staffMemberId,
    p_department_id: departmentId || null,
  });
  if (error) {
    const message = error.message;
    if (["staff_member_not_owned", "department_not_owned", "cross_warehouse_department", "department_inactive"].some((code) => message.includes(code))) {
      return { success: false, message: "The department assignment was rejected." };
    }
    return { success: false, message: "The department assignment could not be completed." };
  }

  revalidatePath("/staff");
  return { success: true, message: "Department updated." };
}

function staffPermissionError(message: string | undefined, action: "grant" | "revoke") {
  if (message?.includes("not_authenticated")) return "You must be signed in to manage permissions.";
  if (message?.includes("staff_member_not_owned") || message?.includes("area_not_owned") || message?.includes("cross_warehouse_permission")) {
    return "The permission change was rejected for this warehouse.";
  }
  if (message?.includes("area_not_found")) return "That warehouse area is no longer available.";
  return action === "grant" ? "The area permission could not be granted." : "The area permission could not be revoked.";
}

export async function grantStaffAreaPermission(
  _previous: StaffPermissionMutationState = permissionInitial,
  formData: FormData,
): Promise<StaffPermissionMutationState> {
  const staffMemberId = String(formData.get("staffMemberId") ?? "");
  const areaId = String(formData.get("areaId") ?? "");
  if (!staffMemberId || !areaId) return { ...permissionInitial, message: "The permission request was invalid." };

  const client = await createClient();
  const { data: authData } = await client.auth.getUser();
  if (!authData.user) return { ...permissionInitial, message: "You must be signed in to manage permissions." };

  const { error } = await client.rpc("grant_staff_area_permission", {
    p_staff_member_id: staffMemberId,
    p_area_id: areaId,
  });
  if (error) return { ...permissionInitial, message: staffPermissionError(error.message, "grant") };

  revalidatePath("/staff");
  return { success: true, message: "Area permission granted." };
}

export async function revokeStaffAreaPermission(
  _previous: StaffPermissionMutationState = permissionInitial,
  formData: FormData,
): Promise<StaffPermissionMutationState> {
  const staffMemberId = String(formData.get("staffMemberId") ?? "");
  const areaId = String(formData.get("areaId") ?? "");
  if (!staffMemberId || !areaId) return { ...permissionInitial, message: "The permission request was invalid." };

  const client = await createClient();
  const { data: authData } = await client.auth.getUser();
  if (!authData.user) return { ...permissionInitial, message: "You must be signed in to manage permissions." };

  const { error } = await client.rpc("revoke_staff_area_permission", {
    p_staff_member_id: staffMemberId,
    p_area_id: areaId,
  });
  if (error) return { ...permissionInitial, message: staffPermissionError(error.message, "revoke") };

  revalidatePath("/staff");
  return { success: true, message: "Area permission revoked." };
}

export async function invokeStaffAccountRequest(
  _previous: AccountClaimState = accountClaimInitial,
  formData: FormData,
): Promise<AccountClaimState> {
  const staffMemberId = String(formData.get("staffMemberId") ?? "");
  if (!staffMemberId) return { ...accountClaimInitial, message: "The account request was invalid." };
  const client = await createClient();
  const { data: authData } = await client.auth.getUser();
  if (!authData.user) return { ...accountClaimInitial, message: "You must be signed in to invite staff." };
  const { data, error } = await client.rpc("create_account_claim_request", { p_staff_member_id: staffMemberId, p_driver_id: null });
  if (error || !data?.[0]?.raw_token) return { ...accountClaimInitial, message: "The account request could not be created." };
  const result = data[0] as { raw_token: string; expires_at: string };
  revalidatePath("/staff");
  return { success: true, message: "Account request created.", registrationLink: `${registrationOrigin()}/register/staff/${result.raw_token}`, expiresAt: result.expires_at };
}

export async function revokeStaffAccountRequest(
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
  revalidatePath("/staff");
  return { success: true, message: "Account request revoked." };
}
