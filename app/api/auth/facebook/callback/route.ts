// app/api/auth/facebook/callback/route.ts — Vuelta de Facebook.
//
// Facebook redirige acá con un `code` de un solo uso. `exchangeCodeForSession`
// lo canjea contra Supabase y deja las cookies de sesión en ESTE dominio: el
// verificador PKCE viaja en una cookie que puso el cliente del navegador al
// arrancar el flujo, por eso el canje corre en el servidor y no en el cliente
// (mismo camino a prueba de iOS Safari que usa /api/auth/verify-otp).
//
// Es pública a propósito — quien llega todavía no tiene sesión — y el
// middleware ya la deja pasar por el prefijo /api/auth.
//
// No se llama a signOut antes del canje: borraría la cookie del verificador y
// el canje fallaría. La sesión nueva pisa a la anterior al escribir cookies.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyOnboardingCookie } from "@/lib/auth/phone-session";
import { recordLoginEvent } from "@/lib/auth/login-event";
import { isFacebookLoginEnabled } from "@/lib/auth/facebook-login";
import { safeReturnTo } from "@/lib/auth/safe-return-to";
import { needsName } from "@/lib/users/needs-name";

export const runtime = "nodejs";

/** Vuelve al login con el motivo, sin filtrar nada de Facebook en la URL. */
function backToLogin(request: NextRequest, reason: "error" | "cancel") {
  const url = new URL("/login", request.url);
  url.searchParams.set("fb", reason);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  // Apagado: nadie entra por acá aunque tenga el enlace.
  if (!isFacebookLoginEnabled()) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const params = request.nextUrl.searchParams;

  // La persona tocó «Cancelar» en Facebook, o Facebook rechazó el permiso.
  // `error_reason=user_denied` es el caso normal, no un fallo del sistema.
  const oauthError = params.get("error");
  if (oauthError) {
    const denied =
      oauthError === "access_denied" || params.get("error_reason") === "user_denied";
    if (!denied) {
      console.warn("[auth/facebook] Facebook devolvió error:", oauthError);
    }
    return backToLogin(request, denied ? "cancel" : "error");
  }

  const code = params.get("code");
  if (!code) return backToLogin(request, "error");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    // No se loguea el code (es una credencial de un solo uso).
    console.warn("[auth/facebook] canje falló:", error?.message ?? "sin usuario");
    return backToLogin(request, "error");
  }

  // Perfil por admin client con filtro explícito por id: RLS devuelve cero
  // filas desde el contexto de PostgREST (ver CLAUDE.md → auth.uid()).
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("users")
    .select("display_name, avatar_url")
    .eq("id", data.user.id)
    .maybeSingle();

  // Mismo criterio que el gate del middleware: nombre de verdad + pollito.
  // El nombre suele venir ya puesto por el trigger con el de Facebook, así
  // que en la práctica solo falta elegir pollito.
  const needsOnboarding =
    !profile || needsName(profile.display_name) || !profile.avatar_url;

  const next = safeReturnTo(params.get("next"));
  const destination = needsOnboarding ? "/onboarding" : next || "/inicio";
  const response = NextResponse.redirect(new URL(destination, request.url));

  // Las cookies de sesión ya quedaron en el cookieStore del createClient();
  // Next las adjunta a esta respuesta. lp_onb se recalcula acá para que una
  // cookie heredada de otra cuenta no salte el gate de onboarding.
  applyOnboardingCookie(response, needsOnboarding);

  void recordLoginEvent({ userId: data.user.id, method: "facebook", request });

  return response;
}
