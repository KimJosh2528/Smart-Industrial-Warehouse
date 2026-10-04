import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { DashboardShell } from "@/components/dashboard-shell";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const client = await createClient();
  const { data } = await client.auth.getUser();
  if (!data.user) redirect("/login");
  const { data: profile } = await client
    .from("profiles")
    .select("display_name,role")
    .eq("id", data.user.id)
    .maybeSingle();
  const displayName = profile?.display_name ?? data.user.user_metadata?.display_name ?? data.user.user_metadata?.name ?? "Administrator";
  const role = profile?.role === "father_admin" || profile?.role === "system_admin" ? profile.role : null;
  return <DashboardShell displayName={displayName} role={role}>{children}</DashboardShell>;
}
