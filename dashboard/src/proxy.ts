import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isMaintenanceEnabled, maintenanceDestination } from "./lib/maintenance-access.mjs";

export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request });
  const pathname = request.nextUrl.pathname;
  const maintenanceEnabled = isMaintenanceEnabled(process.env.WAREGUARD_MAINTENANCE_MODE);
  const maintenanceRoute = pathname === "/maintenance";
  const loginRoute = pathname === "/login";
  const registrationRoute = pathname === "/register/system-admin" || pathname.startsWith("/register/staff/") || pathname.startsWith("/register/driver/");
  const publicRoute = maintenanceRoute || loginRoute || registrationRoute;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  // Fail closed while maintenance is enabled if the server cannot validate a session.
  // The login page remains reachable so an administrator can authenticate.
  if (maintenanceEnabled && !maintenanceRoute && !loginRoute && (!url || !key)) {
    return NextResponse.rewrite(new URL("/maintenance", request.url));
  }

  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() { return request.cookies.getAll(); },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();

  if (maintenanceEnabled && !maintenanceRoute && !loginRoute) {
    const { data: profile } = user
      ? await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle()
      : { data: null };
    const destination = maintenanceDestination({ authenticated: Boolean(user), role: profile?.role });
    if (destination === "maintenance" || (destination === "login" && registrationRoute)) {
      return NextResponse.rewrite(new URL("/maintenance", request.url));
    }
  }

  if (!user && !publicRoute) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
