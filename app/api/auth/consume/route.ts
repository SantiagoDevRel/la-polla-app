// app/api/auth/consume/route.ts — Consume el token SSO emitido por
// /api/auth/handoff en el dominio origen. Verifica firma + expiry, llama
// supabase.auth.setSession() para emitir cookies frescas en ESTE dominio,
// y redirige al target_path.
//
// Es accesible sin auth (ese es el punto: el user todavía no tiene sesión
// en este dominio). Si el token es inválido/expirado, redirect a /login
// para que se loguee manual.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyHandoffToken } from "@/lib/auth/handoff-token";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  let payload;
  try {
    payload = verifyHandoffToken(token);
  } catch (err) {
    // No logueamos el token en sí — contiene access/refresh tokens.
    console.warn(
      "[auth/consume] token invalid:",
      err instanceof Error ? err.message : "unknown",
    );
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Sanitize defensivo (handoff ya lo hace, pero double-check porque el
  // token vino de un dominio externo y la firma sola no garantiza shape).
  const safePath =
    payload.target_path.startsWith("/") &&
    !payload.target_path.startsWith("//")
      ? payload.target_path
      : "/perfil";

  const supabase = createClient();
  try {
    const { error } = await supabase.auth.setSession({
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
    });
    if (error) {
      // Token revocado, refresh_token vencido, etc. → re-login.
      console.warn("[auth/consume] setSession error:", error.message);
      return NextResponse.redirect(new URL("/login", request.url));
    }
  } catch (err) {
    console.warn(
      "[auth/consume] setSession threw:",
      err instanceof Error ? err.message : "unknown",
    );
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Las cookies de Supabase quedaron seteadas via el cookieStore del
  // createClient(). Next.js las attacha a la response de redirect.
  return NextResponse.redirect(new URL(safePath, request.url));
}
