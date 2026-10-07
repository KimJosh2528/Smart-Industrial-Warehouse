import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isMaintenanceEnabled, requestDestination } from "./lib/maintenance-access.mjs";

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

  if (maintenanceRoute) {
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    response.headers.set("Pragma", "no-cache");
    response.headers.set("Expires", "0");
    return response;
  }

  const redirectToMaintenance = () => {
    const redirectResponse = NextResponse.redirect(new URL("/maintenance", request.url));
    copySupabaseResponseState(response, redirectResponse);
    redirectResponse.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    return redirectResponse;
  };

  // Fail closed while maintenance is enabled if the server cannot validate a session.
  // The login page remains reachable so an administrator can authenticate.
  if (maintenanceEnabled && !maintenanceRoute && !loginRoute && (!url || !key)) {
    return redirectToMaintenance();
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

  // Claims are verified by Supabase and are safe to use for request routing.
  // Do not trust the session cookie directly in proxy code.
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;
  const authenticated = Boolean(userId);

  if (maintenanceEnabled && !maintenanceRoute && !loginRoute) {
    const { data: profile } = userId
      ? await supabase.from("profiles").select("role").eq("id", userId).maybeSingle()
      : { data: null };
    const destination = requestDestination({ pathname, authenticated, role: profile?.role });
    if (destination === "maintenance" || (destination === "login" && registrationRoute)) {
      return redirectToMaintenance();
    }
  }

  if (!authenticated && !publicRoute) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    const loginResponse = NextResponse.redirect(loginUrl);
    copySupabaseResponseState(response, loginResponse);
    return loginResponse;
  }

  return response;
}

function copySupabaseResponseState(source: NextResponse, destination: NextResponse) {
  source.cookies.getAll().forEach((cookie) => destination.cookies.set(cookie));
  for (const header of ["cache-control", "expires", "pragma"] as const) {
    const value = source.headers.get(header);
    if (value) destination.headers.set(header, value);
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
