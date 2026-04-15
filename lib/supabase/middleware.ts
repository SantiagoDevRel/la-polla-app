// lib/supabase/middleware.ts — Middleware de autenticación con Supabase para proteger rutas
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
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Rutas públicas que no requieren autenticación. /unirse and /invites/polla
  // need to be reachable so an unauthenticated visitor sees the polla card and
  // gets bounced through login with a returnTo.
  const publicRoutes = [
    "/login",
    "/verify",
    "/onboarding",
    "/api/auth",
    "/unirse",
    "/invites/polla",
  ];
  const isPublicRoute = publicRoutes.some((route) =>
    request.nextUrl.pathname.startsWith(route)
  );
  // These routes handle their own auth (cron secret, webhook signature, etc.)
  const isApiWebhook = request.nextUrl.pathname.startsWith("/api/whatsapp/webhook") ||
    request.nextUrl.pathname.startsWith("/api/whatsapp/test-send") ||
    request.nextUrl.pathname.startsWith("/api/matches/sync") ||
    request.nextUrl.pathname.startsWith("/api/admin/") ||
    request.nextUrl.pathname.startsWith("/api/webhooks/wompi");

  if (!user && !isPublicRoute && !isApiWebhook) {
    const url = request.nextUrl.clone();
    const original = request.nextUrl.pathname + request.nextUrl.search;
    url.pathname = "/login";
    url.search = `?returnTo=${encodeURIComponent(original)}`;
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
