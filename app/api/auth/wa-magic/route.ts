// app/api/auth/wa-magic/route.ts — WhatsApp magic-link consumer.
//
// Flow:
//   1. User taps the CTA button in WhatsApp (delivered by the bot
//      webhook in /api/whatsapp/webhook).
//   2. The button URL is `https://lapollacolombiana.com/api/auth/wa-magic
//      ?token=<64-hex>` so the user lands here without ever copying a
//      code.
//   3. We validate the token (exists, not consumed, not expired) and
//      mark it consumed atomically.
//   4-5. lib/auth/phone-session.ts finds or creates the auth user for the
//      token's phone and mints the Supabase session in the request cookies
//      (admin.generateLink magiclink → verifyOtp). The Telegram login link
//      (/api/auth/telegram-link) uses the very same helper.
//   6. Redirect to /onboarding (new user) or /casa (returning).

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordLoginEvent } from "@/lib/auth/login-event";
import { normalizePhone } from "@/lib/auth/phone";
import {
  applyOnboardingCookie,
  startSessionForVerifiedPhone,
} from "@/lib/auth/phone-session";
import { getClientIp } from "@/lib/supabase/auth-ip";
import { authErrorPage as errorPage } from "@/lib/auth/auth-error-page";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token")?.trim();
  if (!token || !/^[a-f0-9]{32,128}$/i.test(token)) {
    return errorPage("El link es inválido. Pide uno nuevo desde /login.");
  }

  const admin = createAdminClient();

  // Fetch + lock-by-update: set consumed_at IS NULL filter so concurrent
  // taps can't both succeed. We do a SELECT first to get phone/expires,
  // then a conditional UPDATE that also serves as the "claim" step.
  const { data: row } = await admin
    .from("wa_magic_tokens")
    .select("phone_number, expires_at, consumed_at")
    .eq("token", token)
    .maybeSingle();

  if (!row) return errorPage("Link no reconocido.");
  if (row.consumed_at)
    return errorPage("Este link ya se usó. Pide uno nuevo desde /login.");
  if (new Date(row.expires_at).getTime() < Date.now())
    return errorPage("Este link expiró. Pide uno nuevo desde /login.");

  // Atomic claim: only succeed if consumed_at is still NULL.
  const { data: claimed } = await admin
    .from("wa_magic_tokens")
    .update({ consumed_at: new Date().toISOString() })
    .eq("token", token)
    .is("consumed_at", null)
    .select("token")
    .maybeSingle();
  if (!claimed)
    return errorPage("Este link ya se usó. Pide uno nuevo desde /login.");

  const session = await startSessionForVerifiedPhone(
    normalizePhone(row.phone_number),
    "wa-magic",
    // IP real hacia Supabase: /verify limita por IP (lib/supabase/auth-ip.ts).
    { clientIp: getClientIp(request.headers) },
  );
  if (!session.ok) {
    return errorPage(
      session.stage === "create"
        ? "No pudimos crear tu cuenta. Inténtalo de nuevo."
        : "No pudimos firmar tu sesión. Inténtalo de nuevo.",
      500,
    );
  }

  void recordLoginEvent({
    userId: session.userId,
    method: "otp",
    request,
  });

  // Where to land? Onboarding gate in middleware will catch incomplete
  // profiles regardless, but bouncing once instead of twice feels
  // smoother.
  const target = session.needsOnboarding ? "/onboarding" : "/inicio";
  const response = NextResponse.redirect(new URL(target, request.url));
  applyOnboardingCookie(response, session.needsOnboarding);
  return response;
}
