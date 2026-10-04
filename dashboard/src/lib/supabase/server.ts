import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canAccessProtectedRouteDuringMaintenance, isMaintenanceEnabled } from "@/lib/maintenance-access.mjs";

export async function createClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    if (isMaintenanceEnabled(process.env.WAREGUARD_MAINTENANCE_MODE)) redirect("/maintenance");
    throw new Error("Missing public Supabase environment variables.");
  }
  const client = createServerClient(url, key, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Middleware refreshes cookies when Server Components cannot write them.
        }
      },
    },
  });

  if (isMaintenanceEnabled(process.env.WAREGUARD_MAINTENANCE_MODE)) {
    const { data: { user } } = await client.auth.getUser();
    const { data: profile } = user
      ? await client.from("profiles").select("role").eq("id", user.id).maybeSingle()
      : { data: null };
    if (!canAccessProtectedRouteDuringMaintenance({ authenticated: Boolean(user), role: profile?.role })) redirect("/maintenance");
  }

  return client;
}
