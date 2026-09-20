import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getClientIp } from "@/lib/supabase/auth-ip";
import { getTelegramLoginConfig } from "@/lib/auth/telegram-login/config";
import { localeForHost } from "@/lib/auth/telegram-login/links";
import { createLoginRequest, requesterLabel } from "@/lib/auth/telegram-login/requests";
import { isSameOriginRequest } from "@/lib/auth/telegram-login/same-origin";
import {
  getTelegramOidcConfig, newOidcAttempt, oidcAuthorizationUrl, oidcCookieOptions,
  oidcOrigin, OIDC_COOKIE, sealOidcAttempt,
} from "@/lib/auth/telegram-login/oidc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: NextRequest) {
  const config = getTelegramOidcConfig();
  if (!config || !getTelegramLoginConfig()) return json({ error: "not_available" }, 404);
  const origin = oidcOrigin(request.url);
  if (!origin || !isSameOriginRequest(request, { requireProof: true })) return json({ error: "forbidden" }, 403);
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) return json({ error: "unsupported_media_type" }, 415);
  const raw = await request.text();
  if (raw.length > 2000) return json({ error: "invalid_request" }, 400);
  let body: { returnTo?: unknown };
  try { body = JSON.parse(raw); } catch { return json({ error: "invalid_request" }, 400); }
  if (!body || typeof body !== "object") return json({ error: "invalid_request" }, 400);
  const attempt = newOidcAttempt(origin, typeof body.returnTo === "string" ? body.returnTo : null);
  try {
    // Reutiliza el límite atómico por IP. Esta fila NO aprueba ni abre sesión;
    // solo el código firmado de OIDC + PKCE + cookie puede hacerlo.
    const locale = localeForHost(request.headers.get("host"));
    const created = await createLoginRequest(createAdminClient(), {
      nonce: attempt.state, browserSecret: attempt.verifier, locale,
      ip: getClientIp(request.headers), label: requesterLabel(request.headers, locale),
    });
    if (created.status === "rate_limited") return json({ error: "rate_limited" }, 429);
    if (created.status !== "ok") return json({ error: "server_error" }, 503);
    const response = json({ authorizeUrl: oidcAuthorizationUrl(attempt, config) });
    response.cookies.set(OIDC_COOKIE, await sealOidcAttempt(attempt, config), oidcCookieOptions(origin.startsWith("https:")));
    return response;
  } catch {
    return json({ error: "server_error" }, 503);
  }
}
