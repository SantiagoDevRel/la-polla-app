// lib/supabase/middleware.ts — Auth middleware. Two gates:
//   1. Unauthenticated user on a private path → redirect to /login.
//   2. Authenticated user with incomplete profile (no name OR no pollito)
//      → redirect to /onboarding. This is the enforcement that makes
//      name + pollito truly mandatory; without it a returning user who
//      bailed mid-onboarding could navigate around it via URL.
//
// (The old set-password gate was removed when login switched to Twilio
// SMS OTP via Supabase native phone auth — users no longer have an
// account password to pick.)
import { createServerClient } from "@supabase/ssr";
import { createClient as createSbClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { needsName } from "@/lib/users/needs-name";

// Admin client built inline so middleware doesn't pull lib/supabase/admin
// (which is fine, but keeps the dependency surface here explicit).
function getAdmin() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

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

  // Onboarding gate — authenticated users without a real display_name or
  // without a pollito picked must finish onboarding before doing anything
  // else. We skip API routes (they 401 on their own) and the onboarding
  // page itself (otherwise infinite redirect). /api/users/me is exempt
  // because the onboarding page calls it to save the profile.
  const isApiRoute = path.startsWith("/api/");
  const isOnboardingRoute = path.startsWith("/onboarding");
  const isAuthFlowRoute =
    path.startsWith("/login") ||
    path.startsWith("/verify") ||
    path === "/";

  if (
    user &&
    !isApiRoute &&
    !isOnboardingRoute &&
    !isAuthFlowRoute
  ) {
    // Admin client bypasses RLS — auth.uid() returns NULL in PostgREST
    // context (see CLAUDE.md TODO), so the anon client would read 0 rows
    // and the gate would fail open silently. Scope is enforced manually
    // via .eq("id", user.id) where user.id came from getUser() above.
    const admin = getAdmin();
    const { data: profile } = await admin
      .from("users")
      .select("display_name, avatar_url")
      .eq("id", user.id)
      .maybeSingle();

    if (
      profile &&
      (needsName(profile.display_name) || !profile.avatar_url)
    ) {
      const url = request.nextUrl.clone();
      url.pathname = "/onboarding";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
