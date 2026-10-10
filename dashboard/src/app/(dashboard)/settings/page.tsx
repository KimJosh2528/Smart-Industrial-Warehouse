import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/sign-out-button";
import { AccountSettingsForm } from "@/components/account-settings-form";
import { updateDisplayName, updatePassword } from "@/app/settings/actions";

function roleLabel(role: string | null) { return role === "father_admin" ? "Father Admin" : role === "system_admin" ? "System Admin" : role === "driver" ? "Driver" : role === "staff" ? "Staff" : role === "guard" ? "Guard" : "Personal account"; }

export default async function AccountSettingsPage() {
  const client = await createClient(); const { data: authData } = await client.auth.getUser();
  if (!authData.user) return null;
  const { data: profile } = await client.from("profiles").select("display_name,role").eq("id", authData.user.id).maybeSingle();
  const displayName = profile?.display_name ?? authData.user.user_metadata?.display_name ?? authData.user.email?.split("@")[0] ?? "User";
  const avatarUrl = typeof authData.user.user_metadata?.avatar_url === "string" ? authData.user.user_metadata.avatar_url : null;
  return <><header className="mb-6"><p className="text-xs font-medium uppercase tracking-[0.18em] text-cyan-300/80">My Account</p><h1 className="mt-1 text-2xl font-semibold text-white">Account Settings</h1><p className="mt-2 text-sm text-slate-400">Manage your display name and password. Email cannot be changed here.</p></header><section className="mb-5 flex items-center gap-4 rounded-2xl border border-white/10 bg-[#0b1d34] p-5"><div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-cyan-300 to-blue-600 text-2xl font-semibold text-slate-950">{avatarUrl ? <img src={avatarUrl} alt="Profile" className="h-full w-full object-cover" /> : displayName.charAt(0).toUpperCase()}</div><div><p className="font-semibold text-white">{displayName}</p><p className="mt-1 text-sm text-slate-400">{authData.user.email ?? "Email unavailable"}</p><p className="mt-1 text-xs text-slate-500">{roleLabel(profile?.role ?? null)}</p></div></section><AccountSettingsForm displayName={displayName} updateName={updateDisplayName} updatePassword={updatePassword} /><div className="mt-5 rounded-2xl border border-white/10 bg-[#0b1d34] p-5"><p className="text-sm text-slate-400">Profile picture is displayed from your account profile when available.</p><div className="mt-4"><SignOutButton /></div></div></>;
}
