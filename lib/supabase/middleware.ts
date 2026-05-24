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

// Public SEO surfaces que NUNCA necesitan saber el user. Saltamos
// Supabase auth y la query a public.users por completo. El locale ya
// fue resuelto por el outer middleware.ts (x-locale en headers) ANTES
// de entrar acá, así que /torneos/* y /partidos/* siguen sabiendo qué
// locale renderear. Cualquier ruta que necesite "redirect-if-logged-in"
// (login, verify, onboarding, unirse, invites) NO va acá — esas siguen
// pasando por el auth gate.
const PUBLIC_NO_AUTH_PREFIXES = [
  "/torneos",
  "/partidos",
  "/tournaments",
  "/matches",
  "/privacy",
  "/soporte",
];
const PUBLIC_NO_AUTH_EXACT = new Set([
  "/sitemap.xml",
  "/robots.txt",
  "/llms.txt",
  "/opengraph-image",
  "/twitter-image",
]);

export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Early-return para rutas SEO públicas: sin tocar Supabase, sin DB.
  // El outer middleware ya seteó x-locale en request.headers, así que
  // sites.ts / i18n/request.ts siguen funcionando para estas rutas.
  if (
    PUBLIC_NO_AUTH_EXACT.has(path) ||
    path.startsWith("/.well-known/") ||
    PUBLIC_NO_AUTH_PREFIXES.some((p) => path.startsWith(p))
  ) {
    return NextResponse.next({ request });
  }

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

  // Routes accessible without auth. /unirse and /invites/polla need to be
  // reachable so an unauthenticated visitor sees the polla card and gets
  // bounced through login with a returnTo. (Los prefijos PUBLIC_NO_AUTH_*
  // ya hicieron early-return arriba — acá quedan solo los que SÍ tocan
  // Supabase porque necesitan saber si el user está logueado.)
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
    path.startsWith("/api/matches/discover") ||
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
    // Fast-path: si el user ya tiene la cookie lp_onb=1, asumimos
    // onboarding completo y saltamos la query a public.users. La cookie
    // se setea acá (línea más abajo) la PRIMERA vez que confirmamos
    // onboarding completo, y también en /api/users/me PATCH cuando el
    // user guarda nombre/avatar desde la web. Dura 30 días.
    //
    // NO es un override del gate: si la cookie no está (primer request,
    // post-clear, o post-expire), caemos al slow path y la DB sigue
    // siendo la fuente de verdad. Solo evita el round-trip cuando ya
    // sabemos que el user está onboardado.
    const hasOnbCookie = request.cookies.get("lp_onb")?.value === "1";

    if (!hasOnbCookie) {
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

      // Onboarding completo — cachear para próximos requests (30 días).
      if (profile && !needsName(profile.display_name) && profile.avatar_url) {
        supabaseResponse.cookies.set("lp_onb", "1", {
          httpOnly: true,
          sameSite: "lax",
          maxAge: 60 * 60 * 24 * 30,
          path: "/",
        });
      }
    }
  }

  return supabaseResponse;
}
