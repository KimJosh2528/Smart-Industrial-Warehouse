"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type AccountSettingsState = { success: boolean; message: string };

export async function updateDisplayName(_previous: AccountSettingsState, formData: FormData): Promise<AccountSettingsState> {
  const displayName = String(formData.get("displayName") ?? "").trim();
  if (displayName.length < 2 || displayName.length > 80) return { success: false, message: "Display name must be 2–80 characters." };
  const client = await createClient(); const { data } = await client.auth.getUser();
  if (!data.user) return { success: false, message: "You must be signed in." };
  const { error } = await client.from("profiles").update({ display_name: displayName }).eq("id", data.user.id);
  if (error) return { success: false, message: "The display name could not be updated." };
  revalidatePath("/settings"); revalidatePath("/"); return { success: true, message: "Display name updated." };
}

export async function updatePassword(_previous: AccountSettingsState, formData: FormData): Promise<AccountSettingsState> {
  const password = String(formData.get("password") ?? ""); const confirmation = String(formData.get("confirmation") ?? "");
  if (password.length < 8) return { success: false, message: "Password must be at least 8 characters." };
  if (password !== confirmation) return { success: false, message: "Passwords do not match." };
  const client = await createClient(); const { data } = await client.auth.getUser();
  if (!data.user) return { success: false, message: "You must be signed in." };
  const { error } = await client.auth.updateUser({ password });
  return error ? { success: false, message: "The password could not be updated." } : { success: true, message: "Password updated." };
}
