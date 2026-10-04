import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

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
  const pathname = request.nextUrl.pathname;
  const maintenanceEnabled = ["1", "true", "on"].includes((process.env.WAREGUARD_MAINTENANCE_MODE ?? "").toLowerCase());
  const maintenanceRoute = pathname === "/maintenance";
  const publicRoute = maintenanceRoute || pathname === "/login" || pathname === "/register/system-admin" || pathname.startsWith("/register/staff/") || pathname.startsWith("/register/driver/");

  if (maintenanceEnabled && !maintenanceRoute && pathname !== "/login") {
    if (user) {
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
      const authorizedAdministrator = profile?.role === "father_admin" || profile?.role === "system_admin";
      if (!authorizedAdministrator) return NextResponse.rewrite(new URL("/maintenance", request.url));
    } else {
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
