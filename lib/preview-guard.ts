// lib/preview-guard.ts — Vercel Preview never reaches a real provider.
//
// The Preview target shares some provider keys with production (Resend,
// Telegram, Twilio, Wompi...). A PR preview renders against the synthetic
// preview database (docs/preview-db.md), so any flow a tester clicks could send
// a real email, Telegram message, SMS or WhatsApp with production keys. With
// VERCEL_ENV=preview:
//   - every fetch to a messaging or payment provider host is skipped: it logs
//     "preview: skipped <provider>" and returns a fake success, so the flow
//     continues and nothing leaves the deployment (installPreviewFetchGuard,
//     wired in instrumentation.ts);
//   - crons and provider webhooks answer 404 (proxy.ts, requireCronSecret).
// Production and local development are unaffected. Edge-safe: no Node imports.
import { NextResponse } from "next/server";

export function isPreviewDeployment(env: Record<string, string | undefined> = process.env): boolean {
  return env.VERCEL_ENV === "preview";
}

const PROVIDER_HOSTS: ReadonlyArray<readonly [string, string]> = [
  ["api.resend.com", "resend"],
  ["api.telegram.org", "telegram"],
  ["api.labsmobile.com", "labsmobile"],
  ["zernio.com", "zernio"],
  ["graph.facebook.com", "whatsapp"],
  ["api.twilio.com", "twilio"],
  ["wompi.co", "wompi"],
];

/** Provider name when the URL belongs to a messaging or payment provider. */
export function previewBlockedProvider(input: unknown): string | null {
  let host: string;
  try {
    const raw = input instanceof Request ? input.url : input instanceof URL ? input.href : String(input);
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const [suffix, provider] of PROVIDER_HOSTS) {
    if (host === suffix || host.endsWith(`.${suffix}`)) return provider;
  }
  return null;
}

// One body that each provider client reads as success: Resend {id},
// Telegram {ok,result}, LabsMobile {code:"0",subid}, Zernio {success},
// Meta {messages:[{id}]}.
const FAKE_BODY = JSON.stringify({
  ok: true,
  success: true,
  id: "preview-skipped",
  code: "0",
  subid: "preview-skipped",
  message: "preview: skipped",
  result: {},
  messages: [{ id: "preview-skipped" }],
});

const GUARD = Symbol.for("la-polla.preview-fetch-guard");
type Guarded = typeof fetch & { [GUARD]?: true };

/**
 * Wraps target.fetch when running in a Vercel preview. Idempotent. Never logs
 * the URL: Telegram puts the bot token in the path.
 */
export function installPreviewFetchGuard(
  env: Record<string, string | undefined> = process.env,
  target: { fetch: typeof fetch } = globalThis,
  log: (message: string) => void = (message) => console.warn(message),
): boolean {
  if (!isPreviewDeployment(env)) return false;
  if ((target.fetch as Guarded)[GUARD]) return true;
  const original = target.fetch;
  const guarded: Guarded = async (input, init) => {
    const provider = previewBlockedProvider(input);
    if (!provider) return original(input, init);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    log(`preview: skipped ${provider} ${method}`);
    return new Response(FAKE_BODY, { status: 200, headers: { "content-type": "application/json" } });
  };
  guarded[GUARD] = true;
  target.fetch = guarded;
  return true;
}

// Callers are GitHub Actions, Telegram, Meta, Zernio, LabsMobile, OpenWA and the
// Supabase SMS hook; none of them should reach a preview.
const REFUSED_PREFIXES = [
  "/api/cron",
  "/api/telegram/webhook",
  "/api/telegram/login",
  "/api/whatsapp/webhook",
  "/api/whatsapp/zernio",
  "/api/whatsapp/openwa",
  "/api/auth/sms-hook",
  "/api/sms/ack",
];

export function isPreviewRefusedPath(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return REFUSED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** 404 for crons and webhooks in a preview; null elsewhere. */
export function previewRefusal(pathname: string, env: Record<string, string | undefined> = process.env): NextResponse | null {
  if (!isPreviewDeployment(env) || !isPreviewRefusedPath(pathname)) return null;
  return NextResponse.json({ error: "disabled_in_preview" }, { status: 404, headers: { "Cache-Control": "no-store" } });
}
