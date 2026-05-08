// app/api/auth/handoff/route.ts — Genera el token SSO para cross-domain
// language switch. Authenticated. POST { target: 'es' | 'en', path?: string }
// → { url: 'https://<otro-dominio>/api/auth/consume?token=...' }.
//
// El cliente (LanguageToggle) hace POST acá ANTES del redirect. Recibe la
// URL completa y hace window.location.href = url.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { signHandoffToken } from "@/lib/auth/handoff-token";

export const runtime = "nodejs";

const HOST_ES = "lapollacolombiana.com";
const HOST_EN = "chickenpicks.app";

export async function POST(request: NextRequest) {
  const supabase = createClient();
  // getUser valida el JWT contra Supabase (no solo lee la cookie),
  // así no emitimos handoff para sesiones revocadas.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "no_session" }, { status: 401 });
  }

  let body: { target?: unknown; path?: unknown } = {};
  try {
    body = (await request.json()) as { target?: unknown; path?: unknown };
  } catch {
    /* empty body OK — caemos al validador siguiente */
  }

  const target =
    body.target === "en" ? "en" : body.target === "es" ? "es" : null;
  if (!target) {
    return NextResponse.json(
      { error: "target_required", hint: "POST body must include target='en'|'es'" },
      { status: 400 },
    );
  }

  // Sanitize target_path: solo paths relativos que arrancan con / y no
  // intentan ser protocol-relative (//evil.com/...).
  const rawPath = typeof body.path === "string" ? body.path : "/perfil";
  const targetPath =
    rawPath.startsWith("/") && !rawPath.startsWith("//") ? rawPath : "/perfil";

  let token: string;
  try {
    token = signHandoffToken({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      user_id: user.id,
      target_path: targetPath,
    });
  } catch (err) {
    console.error("[auth/handoff] sign failed:", err);
    return NextResponse.json(
      { error: "signing_failed" },
      { status: 500 },
    );
  }

  const targetHost = target === "es" ? HOST_ES : HOST_EN;
  const url = `https://${targetHost}/api/auth/consume?token=${encodeURIComponent(token)}`;

  return NextResponse.json({ url });
}
