import type { SupabaseClient } from "@supabase/supabase-js";

export type CredentialManagementResult = {
  status: "ok";
  credential_id: string;
  credential_type: string;
  is_active?: boolean;
  credential_value?: string;
};

const SAFE_ERROR_CODES = new Set([
  "not_authenticated",
  "forbidden",
  "invalid_request",
  "credential_required",
  "invalid_rfid",
  "invalid_pin",
  "unsupported_credential_type",
  "credential_not_owned",
  "credential_value_unavailable",
  "credential_already_exists",
  "internal_server_error",
]);

type CredentialManagementErrorDetails = {
  code: string | null;
  status: number | null;
};

async function safeErrorDetails(error: unknown): Promise<CredentialManagementErrorDetails> {
  const context = error && typeof error === "object" && "context" in error
    ? (error as { context?: unknown }).context
    : null;

  if (!context || typeof context !== "object" || !("status" in context) || !("clone" in context)) {
    return { code: "unknown_error", status: null };
  }

  const response = context as Response;
  let code: string | null = null;
  try {
    const payload: unknown = await response.clone().json();
    if (payload && typeof payload === "object" && "message" in payload) {
      const message = (payload as { message?: unknown }).message;
      if (typeof message === "string" && SAFE_ERROR_CODES.has(message)) code = message;
    }
  } catch {
    // Keep only the safe HTTP status when the response is not readable JSON.
  }

  return { code: code ?? "unknown_error", status: response.status };
}

export async function invokeCredentialManagement(
  client: SupabaseClient,
  body: Record<string, unknown>,
): Promise<{
  data: CredentialManagementResult | null;
  errorMessage: string | null;
  errorCode: string | null;
  errorStatus: number | null;
}> {
  const { data, error } = await client.functions.invoke<CredentialManagementResult>("credential-management", { body });
  if (error) {
    const details = await safeErrorDetails(error);
    return { data: null, errorMessage: details.code, errorCode: details.code, errorStatus: details.status };
  }
  return { data: data ?? null, errorMessage: null, errorCode: null, errorStatus: null };
}

export function credentialManagementDiagnostic(code: string | null, status: number | null): string {
  const safeCode = code && SAFE_ERROR_CODES.has(code) ? code : "unknown_error";
  return status === null ? `Credential management error: ${safeCode}` : `Credential management error: ${safeCode} (HTTP ${status})`;
}

export function credentialManagementError(message: string | null | undefined, fallback: string): string {
  const value = message ?? "";
  if (value.includes("not_authenticated") || value.includes("401")) return "You must be signed in to manage credentials.";
  if (value.includes("forbidden") || value.includes("403")) return "You are not authorized to manage that credential.";
  if (value.includes("credential_not_owned")) return "The credential does not belong to the selected person or truck.";
  if (value.includes("credential_value_unavailable")) return "Credential value unavailable — replace the credential to store a managed value.";
  if (value.includes("credential_already_exists")) return "That credential type already exists. Use Replace instead.";
  if (value.includes("invalid") || value.includes("credential_required")) return "The credential value is invalid.";
  return fallback;
}
