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
    return "Check that the Valid ID and Facebook links use the required HTTPS formats.";
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

  if (!token || !["staff", "driver", "system_admin"].includes(kind) || !email || !password) {
    return { ...registrationInitial, message: "Complete all required fields." };
  }
  if (password.length < 8) return { ...registrationInitial, message: "Password must be at least 8 characters." };
  if (password !== confirmation) return { ...registrationInitial, message: "Passwords do not match." };

  const client = await createClient();
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) return {
    ...registrationInitial,
    message: classifySignupError(error),
    diagnostic: process.env.NODE_ENV === "production" ? undefined : safeSignupDiagnostic(error),
  };
  if (!data.session) return { success: false, message: "Account created. Confirm your email, then return here to finish registration.", requiresConfirmation: true, email };

  const { error: claimError } = await client.rpc("claim_account", { p_token_hash: hashClaimToken(token) });
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
  if (!token || !email || !password) return { ...registrationInitial, message: "Enter the confirmed account email and password." };

  const client = await createClient();
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) return {
    ...registrationInitial,
    message: "Sign-in failed. Confirm the email and password, then try again.",
    diagnostic: safeSignupDiagnostic(signInError),
  };

  const { error: claimError } = await client.rpc("claim_account", { p_token_hash: hashClaimToken(token) });
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
  const warehouseName = String(formData.get("warehouseName") ?? "").trim();
  if (!applicantName || !email || !validIdUrl || !facebookProfileUrl || !warehouseName) {
    return { success: false, message: "Complete all application fields." };
  }

  const client = await createClient();
  const { error } = await client.rpc("submit_system_admin_application", {
    p_applicant_name: applicantName,
    p_applicant_email: email,
    p_valid_id_url: validIdUrl,
    p_facebook_profile_url: facebookProfileUrl,
    p_requested_warehouse_name: warehouseName,
  });
  if (error) return { success: false, message: classifySystemAdminApplicationError(error) };
  return { success: true, message: "Application submitted. Father Admin review is required before account setup." };
}
