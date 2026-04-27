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
//   4. We find or create the auth user identified by the token's phone.
//   5. We mint a Supabase session for that user via
//      admin.generateLink({type:'magiclink'}) → verifyOtp(...). This
//      sets HttpOnly cookies through the @supabase/ssr client, which
//      is the same cookie path the SMS OTP flow uses (the iOS-Safari-
//      proof one).
//   6. Redirect to /onboarding (new user) or /inicio (returning).
//
// Why a magiclink + verifyOtp dance instead of just signing the user
// in directly? Supabase admin API has no "create session for user X"
// primitive. generateLink returns an `email_otp` we can immediately
// burn server-side via verifyOtp, which establishes the session on
// the request-scoped client and emits the right Set-Cookie headers.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { recordLoginEvent } from "@/lib/auth/login-event";
import { emailForPhone, normalizePhone } from "@/lib/auth/phone";

export const runtime = "nodejs";

// Render a tiny error page — we'd rather show a friendly message than
// 500 with a JSON body, since users land here from a WhatsApp tap.
function errorPage(message: string, status = 400) {
  const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>La Polla · Error</title>
  <style>
    body { background:#080c10; color:#F5F7FA; font-family:system-ui,sans-serif;
           min-height:100vh; margin:0; display:flex; align-items:center;
           justify-content:center; padding:24px; }
    .card { max-width:380px; text-align:center; background:#0e1420;
            border:1px solid rgba(255,255,255,0.08); border-radius:18px;
            padding:28px; }
    h1 { color:#FFD700; font-size:22px; margin:0 0 12px; }
    p  { color:#AEB7C7; font-size:15px; margin:0 0 18px; line-height:1.45; }
    a  { display:inline-block; background:#FFD700; color:#080c10;
         font-weight:700; padding:12px 22px; border-radius:9999px;
         text-decoration:none; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Algo no anda bien</h1>
    <p>${message}</p>
    <a href="/login">Volver a /login</a>
  </div>
</body>
</html>`;
  return new NextResponse(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token")?.trim();
  if (!token || !/^[a-f0-9]{32,128}$/i.test(token)) {
    return errorPage("El link es inválido. Pedí uno nuevo desde /login.");
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
    return errorPage("Este link ya se usó. Pedí uno nuevo desde /login.");
  if (new Date(row.expires_at).getTime() < Date.now())
    return errorPage("Este link expiró. Pedí uno nuevo desde /login.");

  const phoneNormalized = normalizePhone(row.phone_number);
  const phoneE164 = `+${phoneNormalized}`;
  const syntheticEmail = emailForPhone(phoneNormalized);

  // Atomic claim: only succeed if consumed_at is still NULL.
  const { data: claimed } = await admin
    .from("wa_magic_tokens")
    .update({ consumed_at: new Date().toISOString() })
    .eq("token", token)
    .is("consumed_at", null)
    .select("token")
    .maybeSingle();
  if (!claimed)
    return errorPage("Este link ya se usó. Pedí uno nuevo desde /login.");

  // Resolve the auth.users.id for this phone authoritatively. The RPC
  // (migration 026) reads auth.users directly via SECURITY DEFINER and
  // matches by phone OR synthetic email, so it returns the SAME id
  // whether the user previously signed up via SMS (auth.users.phone)
  // or via a WhatsApp magic link (auth.users.email pattern). This is
  // the linchpin against duplicate accounts: same phone → same id,
  // regardless of which channel they used first.
  let authUserId: string | null = null;
  {
    const { data: rpcId, error: rpcErr } = await admin.rpc(
      "find_auth_user_id_by_phone",
      { p_phone: phoneE164 },
    );
    if (rpcErr) {
      console.error("[wa-magic] find_auth_user_id_by_phone failed:", rpcErr);
      return errorPage("No pudimos firmar tu sesión. Probá de nuevo.", 500);
    }
    if (typeof rpcId === "string" && rpcId.length > 0) authUserId = rpcId;
  }

  if (!authUserId) {
    // No existing auth user — create one. phone_confirm=true skips
    // Twilio (the WhatsApp leg is the proof-of-ownership). The
    // synthetic email anchors generateLink({type:'magiclink'}) below.
    const { data: created, error: createErr } =
      await admin.auth.admin.createUser({
        phone: phoneE164,
        phone_confirm: true,
        email: syntheticEmail,
        email_confirm: true,
      });

    if (createErr || !created.user) {
      // Could be a unique-constraint race (phone or email taken since
      // our RPC check). Re-query — if a row exists now, use it. This
      // collapses the SMS-and-WA-tapped-at-the-same-instant case to a
      // single account.
      const { data: retryId } = await admin.rpc(
        "find_auth_user_id_by_phone",
        { p_phone: phoneE164 },
      );
      if (typeof retryId === "string" && retryId.length > 0) {
        authUserId = retryId;
      } else {
        console.error("[wa-magic] createUser failed and recheck miss:", createErr);
        return errorPage("No pudimos crear tu cuenta. Probá de nuevo.", 500);
      }
    } else {
      authUserId = created.user.id;
    }
  }

  // Make sure the synthetic email is on the auth row. The RPC matches
  // accounts that came in via SMS-only (no email), and generateLink
  // below needs an email to anchor on. updateUserById is idempotent —
  // a no-op if the email already matches.
  {
    const { data: info } = await admin.auth.admin.getUserById(authUserId!);
    if (info?.user && info.user.email !== syntheticEmail) {
      const { error: updErr } = await admin.auth.admin.updateUserById(
        authUserId!,
        { email: syntheticEmail, email_confirm: true },
      );
      if (updErr) {
        console.error("[wa-magic] updateUserById failed:", updErr);
        // Non-fatal: continue and let generateLink try anyway. If it
        // fails we fall into the catch below.
      }
    }
  }

  // Mint a one-time email_otp via admin.generateLink and immediately
  // verify it on the request-scoped client so cookies stick.
  const { data: linkData, error: linkErr } =
    await admin.auth.admin.generateLink({
      type: "magiclink",
      email: syntheticEmail,
    });

  const emailOtp =
    (linkData?.properties as { email_otp?: string } | undefined)?.email_otp ??
    null;

  if (linkErr || !emailOtp) {
    console.error("[wa-magic] generateLink failed:", linkErr);
    return errorPage("No pudimos firmar tu sesión. Probá de nuevo.", 500);
  }

  const supabase = createServerSupabase();
  // Defensive: signOut before verify. Same reason as in
  // /api/auth/verify-otp — a user with a live session on a different
  // account would otherwise risk the cookie swap not landing.
  await supabase.auth.signOut().catch(() => {});

  const { error: verifyErr } = await supabase.auth.verifyOtp({
    email: syntheticEmail,
    token: emailOtp,
    type: "email",
  });
  if (verifyErr) {
    console.error("[wa-magic] verifyOtp failed:", verifyErr);
    return errorPage("No pudimos firmar tu sesión. Probá de nuevo.", 500);
  }

  // Mirror the SMS-OTP flow: also stamp public.users with the phone
  // (in case the row is brand new from the trigger and missing it),
  // and record a login event.
  await admin
    .from("users")
    .update({
      whatsapp_number: phoneNormalized,
      whatsapp_verified: true,
    })
    .eq("id", authUserId);

  void recordLoginEvent({
    userId: authUserId,
    method: "otp",
    request,
  });

  // Where to land? Onboarding gate in middleware will catch incomplete
  // profiles regardless, but bouncing once instead of twice feels
  // smoother.
  const { data: profile } = await admin
    .from("users")
    .select("display_name, avatar_url")
    .eq("id", authUserId)
    .maybeSingle();

  const needsOnboarding =
    !profile ||
    !profile.display_name ||
    /^\+?\d{8,15}$/.test(String(profile.display_name).trim()) ||
    !profile.avatar_url;

  const target = needsOnboarding ? "/onboarding" : "/inicio";
  return NextResponse.redirect(new URL(target, request.url));
}
