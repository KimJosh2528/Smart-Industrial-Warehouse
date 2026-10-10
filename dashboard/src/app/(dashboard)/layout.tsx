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
  const scope = await import("@/lib/warehouse-scope").then(({ getAuthorizedWarehouses }) => getAuthorizedWarehouses(client));
  const role = scope.role;
  const { data: warehouse } = role === "system_admin"
    ? await client.from("warehouses").select("name").eq("system_admin_id", data.user.id).maybeSingle()
    : { data: null };
  let assignmentContext: string | null = null;
  if (role === "driver") {
    const { data: driver } = await client.from("drivers").select("id").eq("profile_id", data.user.id).maybeSingle<{ id: string }>();
    if (driver) {
      const { data: truck } = await client.from("trucks").select("identity_label,plate_number,division").eq("current_driver_id", driver.id).maybeSingle<{ identity_label: string; plate_number: string; division: string | null }>();
      assignmentContext = truck ? `${truck.identity_label} · ${truck.plate_number} · ${truck.division ?? "No placement"}` : "No truck assigned";
    }
  }
  return <DashboardShell displayName={displayName} role={role} warehouseContext={warehouse?.name ?? null} assignmentContext={assignmentContext}>{children}</DashboardShell>;
}
