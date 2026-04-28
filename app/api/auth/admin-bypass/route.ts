// app/api/auth/admin-bypass/route.ts — Login directo para admin.
//
// Permite que un admin (is_admin=true en public.users) entre a la app
// sin pasar por OTP por SMS. Pensado para ahorrar costo Twilio cuando
// el admin (santi) testea cosas. NO es un bypass general — solo
// funciona si:
//   1. El token HMAC matchea (firmado con ADMIN_BYPASS_SECRET).
//   2. El user existe en auth con ese phone.
//   3. El user tiene is_admin=true en public.users.
//
// URL bookmarkeable:
//   /api/auth/admin-bypass?phone=<E164>&token=<hex>
//
// Donde token = hex(HMAC-SHA256(phone, ADMIN_BYPASS_SECRET)).
// Generar con: node scripts/admin-bypass-url.mjs <phone>
//
// Si ADMIN_BYPASS_SECRET no está seteado en env, la ruta retorna 503.
// Eso evita un bypass accidental si la env var falla. Setear el secret
// con: vercel env add ADMIN_BYPASS_SECRET production

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { recordLoginEvent } from "@/lib/auth/login-event";
import { emailForPhone, normalizePhone } from "@/lib/auth/phone";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorPage(message: string, status = 400) {
  const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>La Polla · Admin bypass</title>
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
    <h1>Admin bypass</h1>
    <p>${message}</p>
    <a href="/login">Volver a /login</a>
  </div>
</body>
</html>`;
  return new NextResponse(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function timingSafeHexEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export async function GET(request: NextRequest) {
  const secret = process.env.ADMIN_BYPASS_SECRET;
  if (!secret) {
    return errorPage("Admin bypass no está habilitado en este entorno.", 503);
  }

  const url = request.nextUrl;
  const phoneRaw = url.searchParams.get("phone")?.trim() ?? "";
  const token = url.searchParams.get("token")?.trim() ?? "";
  if (!phoneRaw || !token) {
    return errorPage("Faltan parámetros.", 400);
  }

  // Normalizar phone igual que SMS OTP path para que el HMAC sea
  // consistente con el script generador.
  const phoneE164 = normalizePhone(phoneRaw);
  if (!phoneE164) {
    return errorPage("Phone inválido.", 400);
  }

  // Verify HMAC. Pedimos hex en vez de base64 para que sea cómodo
  // de bookmarkear y no tenga caracteres especiales.
  const expected = crypto
    .createHmac("sha256", secret)
    .update(phoneE164)
    .digest("hex");
  if (!timingSafeHexEqual(token, expected)) {
    return errorPage("Token inválido.", 401);
  }

  const admin = createAdminClient();

  // Resolver el auth.users.id por phone (mismo método que wa-magic).
  let authUserId: string | null = null;
  {
    const { data: rpcId, error: rpcErr } = await admin.rpc(
      "find_auth_user_id_by_phone",
      { p_phone: phoneE164 },
    );
    if (rpcErr) {
      console.error("[admin-bypass] rpc lookup failed:", rpcErr);
      return errorPage("Error interno (lookup).", 500);
    }
    if (typeof rpcId === "string" && rpcId.length > 0) authUserId = rpcId;
  }
  if (!authUserId) {
    return errorPage("Ese phone no tiene cuenta en la app.", 404);
  }

  // El admin debe estar marcado como tal en public.users. Si no, se
  // rechaza — el bypass no es para users normales.
  const { data: profile, error: profileErr } = await admin
    .from("users")
    .select("id, is_admin, display_name, avatar_url")
    .eq("id", authUserId)
    .maybeSingle();
  if (profileErr || !profile) {
    return errorPage("No se pudo verificar el perfil.", 500);
  }
  if (!profile.is_admin) {
    return errorPage("Esta cuenta no es admin.", 403);
  }

  // Mismo dance que wa-magic: generar email_otp via admin.generateLink
  // y verificarlo en el cliente request-scoped para que las cookies
  // queden seteadas.
  const syntheticEmail = emailForPhone(phoneE164);

  // Asegurar que el row de auth tenga el email sintético (los users
  // SMS-only no lo tienen y generateLink lo necesita como anchor).
  {
    const { data: info } = await admin.auth.admin.getUserById(authUserId);
    if (info?.user && info.user.email !== syntheticEmail) {
      await admin.auth.admin
        .updateUserById(authUserId, {
          email: syntheticEmail,
          email_confirm: true,
        })
        .catch((err) => {
          console.warn("[admin-bypass] updateUserById warning:", err);
        });
    }
  }

  const { data: linkData, error: linkErr } =
    await admin.auth.admin.generateLink({
      type: "magiclink",
      email: syntheticEmail,
    });
  const emailOtp =
    (linkData?.properties as { email_otp?: string } | undefined)?.email_otp ??
    null;
  if (linkErr || !emailOtp) {
    console.error("[admin-bypass] generateLink failed:", linkErr);
    return errorPage("No pudimos firmar la sesión.", 500);
  }

  const supabase = createServerSupabase();
  await supabase.auth.signOut().catch(() => {});
  const { error: verifyErr } = await supabase.auth.verifyOtp({
    email: syntheticEmail,
    token: emailOtp,
    type: "email",
  });
  if (verifyErr) {
    console.error("[admin-bypass] verifyOtp failed:", verifyErr);
    return errorPage("No pudimos firmar la sesión.", 500);
  }

  void recordLoginEvent({
    userId: authUserId,
    method: "otp",
    request,
  });

  // Onboarding gate compatibility — admins ya tienen profile completo
  // pero seguimos el mismo redirect logic por si acaso.
  const needsOnboarding =
    !profile.display_name ||
    /^\+?\d{8,15}$/.test(String(profile.display_name).trim()) ||
    !profile.avatar_url;

  const target = needsOnboarding ? "/onboarding" : "/inicio";
  return NextResponse.redirect(new URL(target, request.url));
}
