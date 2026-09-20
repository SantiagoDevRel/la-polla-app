import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTelegramLoginConfig } from "@/lib/auth/telegram-login/config";
import { canIssueFor, linkTelegramAccountForContact, telegramIdentityStatus } from "@/lib/auth/telegram-login/identity";
import { linkedAccountFor, type LoginGrant } from "@/lib/auth/telegram-login/requests";
import { startTelegramSession, finishTelegramSessionResponse } from "@/lib/auth/telegram-login/session";
import {
  exchangeTelegramCode, getTelegramOidcConfig, matchesOidcState, oidcCookieOptions,
  oidcOrigin, OIDC_COOKIE, readOidcAttempt,
} from "@/lib/auth/telegram-login/oidc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const origin = oidcOrigin(request.url);
  // Never redirect to a request-controlled origin.
  if (!origin) return new NextResponse(null, { status: 400, headers: { "Cache-Control": "no-store" } });
  const finish = (response: NextResponse) => {
    response.cookies.set(OIDC_COOKIE, "", { ...oidcCookieOptions(origin.startsWith("https:")), maxAge: 0 });
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  };
  let returnTo: string | null = null;
  const fail = (reason: string) => {
    const url = new URL("/login", origin);
    url.searchParams.set("telegram", reason);
    if (returnTo) url.searchParams.set("returnTo", returnTo);
    return finish(NextResponse.redirect(url, 303));
  };
  const config = getTelegramOidcConfig();
  const loginConfig = getTelegramLoginConfig();
  if (!config || !loginConfig) return fail("unavailable");
  const attempt = await readOidcAttempt(request.cookies.get(OIDC_COOKIE)?.value, config);
  const params = request.nextUrl.searchParams;
  if (!attempt || attempt.origin !== origin || params.getAll("state").length !== 1 ||
    !matchesOidcState(params.get("state"), attempt.state)) return fail("expired");
  returnTo = attempt.returnTo;
  if (params.has("error")) return fail("cancelled");
  const code = params.get("code");
  if (!code || code.length > 2048 || params.getAll("code").length !== 1) return fail("failed");
  try {
    // No DB access until Telegram has verified this browser's one-time code.
    const identity = await exchangeTelegramCode(code, attempt, config);
    const db = createAdminClient();
    const linked = await linkedAccountFor(db, identity.telegramUserId);
    let grant: LoginGrant;
    if (linked.kind === "linked") {
      grant = { userId: linked.userId, phoneE164: linked.phoneE164, telegramUserId: identity.telegramUserId };
    } else {
      if (linked.kind === "error") return fail("failed");
      if (linked.kind === "ambiguous") return fail("sms_only");
      if (!identity.phoneE164) return fail("phone_required");
      const status = await telegramIdentityStatus(db, identity.phoneE164, identity.telegramUserId);
      if (status === "error") return fail("failed");
      if (!canIssueFor(status, loginConfig)) return fail("sms_only");
      const result = await linkTelegramAccountForContact(db, loginConfig, identity.phoneE164, identity.telegramUserId);
      if (result.status !== "ok") return fail(result.status === "denied" ? "sms_only" : "failed");
      grant = result.grant;
    }
    const session = await startTelegramSession(request, db, grant, "telegram-oidc");
    if (!session.ok) return fail(session.stage === "denied" ? "sms_only" : "failed");
    const destination = new URL(session.needsOnboarding ? "/onboarding" : attempt.returnTo, origin);
    // Defense in depth against URL normalization changing the origin.
    if (destination.origin !== origin) return fail("failed");
    return finish(finishTelegramSessionResponse(NextResponse.redirect(destination, 303), session.needsOnboarding));
  } catch {
    // Provider responses, codes, tokens and phone numbers must never reach logs.
    return fail("failed");
  }
}
