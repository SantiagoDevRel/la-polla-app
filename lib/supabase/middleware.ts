// lib/supabase/middleware.ts — Auth middleware. Two gates:
//   1) Unauthenticated user on a private path → redirect to /login.
//   2) Authenticated user without a custom password → redirect to /set-password.
//      The OTP flow lands users with has_custom_password=false (a temp pw the
//      user never knows). This second gate forces every authenticated session
//      to pick a real password before navigating anywhere else.
import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminSupabase } from "@supabase/supabase-js";
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

  // Gate 2: users with has_custom_password=false land on /set-password until
  // they pick a real password. We skip the lookup for API routes (the page
  // itself needs to call /api/auth/set-password to fix the state) and for
  // the auth pages so the OTP/login flow can complete normally.
  if (user) {
    const ungatedForPasswordCheck =
      path.startsWith("/api/") ||
      path.startsWith("/set-password") ||
      path.startsWith("/login") ||
      path.startsWith("/verify") ||
      path.startsWith("/onboarding");

    if (!ungatedForPasswordCheck) {
      // Admin client because public.users.has_custom_password is RLS-gated to
      // the row's owner via auth.uid(), and auth.uid() does not propagate
      // here (tracked TODO). The query is one indexed lookup per private
      // navigation; acceptable cost for the gate.
      const admin = createAdminSupabase(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
      const { data: profile } = await admin
        .from("users")
        .select("has_custom_password")
        .eq("id", user.id)
        .maybeSingle();

      if (profile && profile.has_custom_password === false) {
        const url = request.nextUrl.clone();
        url.pathname = "/set-password";
        url.search = "";
        return NextResponse.redirect(url);
      }
    }
  }

  return supabaseResponse;
}
