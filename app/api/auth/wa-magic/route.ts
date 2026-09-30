// Zernio sends /login/whatsapp?t=… after a signed incoming message.
// GET/HEAD never consume tokens. Only a same-origin confirmation POST claims
// the hash atomically and starts the shared verified-phone session.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordLoginEvent } from "@/lib/auth/login-event";
import { normalizePhone } from "@/lib/auth/phone";
import {
  applyOnboardingCookie,
  startSessionForVerifiedPhone,
} from "@/lib/auth/phone-session";
import { getClientIp } from "@/lib/supabase/auth-ip";
import { isSameOriginRequest } from "@/lib/auth/telegram-login/same-origin";
import { peekWhatsAppLogin, validWhatsAppToken, whatsappTokenHash } from "@/lib/auth/whatsapp-login";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirect(request: NextRequest, path: string) {
  const response = NextResponse.redirect(new URL(path, request.url), 303);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "same-origin");
  return response;
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  return redirect(request, validWhatsAppToken(token) ? `/login/whatsapp?t=${token}` : "/login/whatsapp?estado=invalid");
}

export async function HEAD() {
  return new NextResponse(null, { status: 405, headers: { Allow: "GET, POST", "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request, { requireProof: true })) return new NextResponse(null, { status: 403 });
  if (request.headers.get("content-type")?.split(";")[0] !== "application/x-www-form-urlencoded") return new NextResponse(null, { status: 415 });
  if (Number(request.headers.get("content-length")) > 1024) return new NextResponse(null, { status: 413 });
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 1024) return new NextResponse(null, { status: 413 });
  const form = new URLSearchParams(raw);
  const token = form.get("t");
  if (!validWhatsAppToken(token) || form.getAll("t").length !== 1) return redirect(request, "/login/whatsapp?estado=invalid");
  try {
    const row = await peekWhatsAppLogin(token);
    if (!row) return redirect(request, "/login/whatsapp?estado=expired");
    // Claim with expiry in the same update: concurrent taps cannot both start a session.
    const { data: claimed, error } = await createAdminClient().from("wa_magic_tokens")
      .update({ consumed_at: new Date().toISOString() })
      .eq("token", whatsappTokenHash(token)).eq("phone_number", row.phone_number)
      .is("consumed_at", null).gt("expires_at", new Date().toISOString())
      .select("phone_number").maybeSingle();
    if (error) throw new Error("WhatsApp login claim unavailable");
    if (!claimed) return redirect(request, "/login/whatsapp?estado=expired");
    const session = await startSessionForVerifiedPhone(normalizePhone(claimed.phone_number), "wa-link", {
      clientIp: getClientIp(request.headers),
    });
    if (!session.ok) return redirect(request, "/login/whatsapp?estado=unavailable");
    void recordLoginEvent({ userId: session.userId, method: "otp", request });
    const response = redirect(request, session.needsOnboarding ? "/onboarding" : "/inicio");
    applyOnboardingCookie(response, session.needsOnboarding);
    return response;
  } catch {
    return redirect(request, "/login/whatsapp?estado=unavailable");
  }
}
