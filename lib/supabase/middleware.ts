// lib/supabase/middleware.ts — Auth middleware. One gate:
//   - Unauthenticated user on a private path → redirect to /login.
//
// (The old set-password gate was removed when login switched to Twilio
// SMS OTP via Supabase native phone auth — users no longer have an
// account password to pick.)
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  // Routes accessible without auth. /unirse and /invites/polla need to be
  // reachable so an unauthenticated visitor sees the polla card and gets
  // bounced through login with a returnTo.
  const publicRoutes = [
    "/login",
    "/verify",
    "/onboarding",
    "/api/auth",
    "/api/pollas/preview",
    "/unirse",
    "/invites/polla",
  ];
  const isPublicRoute = publicRoutes.some((route) => path.startsWith(route));

  // These routes handle their own auth (cron secret, webhook signature, etc.)
  const isApiWebhook =
    path.startsWith("/api/whatsapp/webhook") ||
    path.startsWith("/api/whatsapp/test-send") ||
    path.startsWith("/api/matches/sync") ||
    path.startsWith("/api/admin/");

  if (!user && !isPublicRoute && !isApiWebhook) {
    const url = request.nextUrl.clone();
    const original = path + request.nextUrl.search;
    url.pathname = "/login";
    url.search = `?returnTo=${encodeURIComponent(original)}`;
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
