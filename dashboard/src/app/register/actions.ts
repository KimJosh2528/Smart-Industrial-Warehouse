"use server";

"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hashClaimToken } from "@/lib/account-claim-server";
import type { RegistrationState } from "@/lib/registration-state";
import { registrationInitial } from "@/lib/registration-state";

export type SystemAdminApplicationState = { success: boolean; message: string };

function classifySystemAdminApplicationError(error: { message?: string; code?: string; status?: number }): string {
  const message = (error.message ?? "").toLowerCase();
  const code = (error.code ?? "").toLowerCase();

  if (message.includes("system_admin_application_already_pending") || code === "23505") {
    return "An application for this email is already pending Father Admin review.";
  }
  if (message.includes("system_admin_application_invalid")) {
    return "Check that the Valid ID link uses the required HTTPS format.";
  }
  if (code === "42883" || code === "pgrst202" || message.includes("submit_system_admin_application") && message.includes("does not exist")) {
    return "System Admin registration is not configured on this environment yet. Please contact Father Admin.";
  }
  if (error.status === 0 || message.includes("fetch failed") || message.includes("network")) {
    return "The registration service could not be reached. Please try again.";
  }
  return "The application could not be submitted. Check the links and try again.";
}

function classifySignupError(error: { message?: string; code?: string; status?: number }): string {
  const message = (error.message ?? "").toLowerCase();
  const code = (error.code ?? "").toLowerCase();
  if (code.includes("user_already_exists") || message.includes("already registered") || message.includes("already been registered")) {
    return "This email is already registered. Use the confirmation/sign-in option for this claim link.";
  }
  if (code.includes("invalid_email") || message.includes("invalid email") || message.includes("valid email")) {
    return "Enter a valid email address.";
  }
  if (code.includes("weak_password") || code.includes("password") || message.includes("password")) {
    return "The password does not meet the required policy.";
  }
  if (code.includes("rate_limit") || message.includes("rate limit") || message.includes("too many requests")) {
    return "Too many registration attempts. Please wait and try again.";
  }
  if (error.status === 0 || message.includes("fetch failed") || message.includes("network")) {
    return "The authentication service could not be reached. Please try again.";
  }
  return "The account registration request was rejected by the authentication service.";
}

function safeSignupDiagnostic(error: { name?: string; message?: string; code?: string; status?: number }) {
  const clean = (value: unknown) => String(value ?? "unknown").replace(/[\r\n\t]+/g, " ").slice(0, 200);
  return {
    name: clean(error.name),
    code: clean(error.code),
    status: typeof error.status === "number" ? error.status : null,
    message: clean(error.message),
  };
}

export async function registerAndClaim(
  _previous: RegistrationState = registrationInitial,
  formData: FormData,
): Promise<RegistrationState> {
  const token = String(formData.get("token") ?? "").trim();
  const kind = String(formData.get("kind") ?? "");
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  const warehouseName = String(formData.get("warehouseName") ?? "").trim();

  if (!token || !["staff", "driver", "system_admin"].includes(kind) || !email || !password || (kind === "system_admin" && !warehouseName)) {
    return { ...registrationInitial, message: "Complete all required fields." };
  }
  if (password.length < 8) return { ...registrationInitial, message: "Password must be at least 8 characters." };
  if (password !== confirmation) return { ...registrationInitial, message: "Passwords do not match." };

  const client = await createClient();
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) {
    const message = String(error.message ?? "").toLowerCase();
    const code = String(error.code ?? "").toLowerCase();
    if (code.includes("user_already_exists") || message.includes("already registered")) {
      return { ...registrationInitial, message: "This email is already registered. Sign in below to finish this claim.", requiresConfirmation: true, email };
    }
    return { ...registrationInitial, message: classifySignupError(error), diagnostic: process.env.NODE_ENV === "production" ? undefined : safeSignupDiagnostic(error) };
  }
  if (!data.session) return { success: false, message: "Account created. Confirm your email, then return here to finish registration.", requiresConfirmation: true, email };

  const { error: claimError } = kind === "system_admin"
    ? await client.rpc("claim_system_admin_account", { p_token_hash: hashClaimToken(token), p_warehouse_name: warehouseName })
    : await client.rpc("claim_account", { p_token_hash: hashClaimToken(token) });
  if (claimError) return { ...registrationInitial, message: "The registration link is invalid, expired, or already used." };

  redirect("/login?claimed=1");
}

export async function signInAndClaim(
  _previous: RegistrationState = registrationInitial,
  formData: FormData,
): Promise<RegistrationState> {
  const token = String(formData.get("token") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const warehouseName = String(formData.get("warehouseName") ?? "").trim();
  if (!token || !email || !password || (kind === "system_admin" && !warehouseName)) return { ...registrationInitial, message: "Complete the confirmed account and warehouse name." };

  const client = await createClient();
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) return {
    ...registrationInitial,
    message: "Sign-in failed. Confirm the email and password, then try again.",
    diagnostic: safeSignupDiagnostic(signInError),
  };

  const { error: claimError } = kind === "system_admin"
    ? await client.rpc("claim_system_admin_account", { p_token_hash: hashClaimToken(token), p_warehouse_name: warehouseName })
    : await client.rpc("claim_account", { p_token_hash: hashClaimToken(token) });
  if (claimError) return { ...registrationInitial, message: "The registration link is invalid, expired, or already used." };

  redirect("/login?claimed=1");
}

export async function submitSystemAdminApplication(
  _previous: SystemAdminApplicationState = { success: false, message: "" },
  formData: FormData,
): Promise<SystemAdminApplicationState> {
  const applicantName = String(formData.get("applicantName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const validIdUrl = String(formData.get("validIdUrl") ?? "").trim();
  const facebookProfileUrl = String(formData.get("facebookProfileUrl") ?? "").trim();
  if (!applicantName || !email || !validIdUrl || !facebookProfileUrl) {
    return { success: false, message: "Complete the name, email, Valid ID, and Facebook profile fields." };
  }

  const client = await createClient();
  const { error } = await client.rpc("submit_system_admin_application", {
    p_applicant_name: applicantName,
    p_applicant_email: email,
    p_valid_id_url: validIdUrl,
    p_facebook_profile_url: facebookProfileUrl,
  });
  if (error) return { success: false, message: classifySystemAdminApplicationError(error) };
  return { success: true, message: "Application submitted. Father Admin review is required before account setup." };
}

export type MemberApplicationState = { success: boolean; message: string };

export async function submitMemberApplication(
  _previous: MemberApplicationState = { success: false, message: "" },
  formData: FormData,
): Promise<MemberApplicationState> {
  const role = String(formData.get("requestedRole") ?? "");
  const applicantName = String(formData.get("applicantName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const validIdUrl = String(formData.get("validIdUrl") ?? "").trim();
  const facebookProfileUrl = String(formData.get("facebookProfileUrl") ?? "").trim();
  const warehouseName = String(formData.get("warehouseName") ?? "").trim();
  const cameraOptIn = false;
  if (!["staff", "driver"].includes(role) || !applicantName || !email || !validIdUrl || !facebookProfileUrl || !warehouseName) return { success: false, message: "Complete all required fields, including the exact warehouse name." };
  const client = await createClient();
  const { error } = await client.rpc("submit_warehouse_member_application_with_camera", {
    p_requested_role: role,
    p_applicant_name: applicantName,
    p_applicant_email: email,
    p_valid_id_url: validIdUrl,
    p_facebook_profile_url: facebookProfileUrl,
    p_warehouse_name: warehouseName,
    p_camera_opt_in: cameraOptIn,
  });
  const message = String(error?.message ?? "").toLowerCase();
  if (error) {
    if (message.includes("warehouse_not_found")) return { success: false, message: "Warehouse name does not match. Enter the full exact warehouse name." };
    if (message.includes("valid_id_invalid")) return { success: false, message: "Valid ID link must start with https://." };
    if (message.includes("facebook_invalid")) return { success: false, message: "Facebook link must be a valid https://facebook.com/... profile link." };
    if (message.includes("email_invalid")) return { success: false, message: "Enter a valid email address." };
    if (message.includes("name_invalid")) return { success: false, message: "Enter your full name." };
    if (message.includes("already_pending") || error.code === "23505") return { success: false, message: "An application with this email is already pending for this warehouse." };
    if (process.env.NODE_ENV !== "production") {
      const diagnostic = String(error.message ?? "unknown database error").replace(/[\r\n]+/g, " ").slice(0, 240);
      return { success: false, message: `Application database error: ${diagnostic}` };
    }
    return { success: false, message: "The application could not be submitted. Check the required links and warehouse name." };
  }
  return { success: true, message: "Application submitted. The System Admin of this warehouse must review it." };
}
