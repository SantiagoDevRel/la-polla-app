// lib/auth/phone-session.ts — Inicia la sesión de Supabase para un teléfono
// cuya propiedad YA se probó por un canal propio (magic-link de WhatsApp,
// bot de Telegram). Es el mecanismo que nació en /api/auth/wa-magic, movido
// acá sin cambios para que los dos canales usen exactamente el mismo camino.
//
// Por qué magiclink + verifyOtp: la Admin API de Supabase no tiene "crear
// sesión para el usuario X". generateLink devuelve un email_otp que se quema
// de inmediato en el servidor con verifyOtp sobre el cliente con cookies del
// request, y eso emite los Set-Cookie HttpOnly (el camino a prueba de iOS
// Safari que usa también /api/auth/verify-otp).
//
// Reglas de sesión (CLAUDE.md, "Auth: cookies host-only + signOut global"):
// signOut con scope 'local' en el request justo antes de mintear — nunca
// 'global', nunca on-mount.

import type { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { emailForPhone, normalizePhone } from "@/lib/auth/phone";

export type PhoneSessionResult =
  | { ok: true; userId: string; needsOnboarding: boolean }
  | { ok: false; stage: "lookup" | "create" | "link" | "verify" };

/**
 * Busca o crea la cuenta del teléfono y deja la sesión en las cookies del
 * request actual. Solo llamar DESPUÉS de haber probado la propiedad del número.
 */
export async function startSessionForVerifiedPhone(
  phone: string,
  logTag: string,
): Promise<PhoneSessionResult> {
  const admin = createAdminClient();
  const phoneNormalized = normalizePhone(phone);
  const phoneE164 = `+${phoneNormalized}`;
  const syntheticEmail = emailForPhone(phoneNormalized);

  // Resolver auth.users.id por teléfono (migración 026): mismo id venga la
  // cuenta de SMS (auth.users.phone) o de un canal con email sintético. Es lo
  // que evita cuentas duplicadas entre canales.
  let authUserId: string | null = null;
  {
    const { data: rpcId, error: rpcErr } = await admin.rpc(
      "find_auth_user_id_by_phone",
      { p_phone: phoneE164 },
    );
    if (rpcErr) {
      console.error(`[${logTag}] find_auth_user_id_by_phone failed:`, rpcErr.message);
      return { ok: false, stage: "lookup" };
    }
    if (typeof rpcId === "string" && rpcId.length > 0) authUserId = rpcId;
  }

  if (!authUserId) {
    // Sin cuenta: se crea. phone_confirm=true porque el canal ya probó la
    // propiedad del número. El email sintético ancla generateLink.
    const { data: created, error: createErr } =
      await admin.auth.admin.createUser({
        phone: phoneE164,
        phone_confirm: true,
        email: syntheticEmail,
        email_confirm: true,
      });

    if (createErr || !created.user) {
      // Carrera de unicidad (el mismo teléfono entró por otro canal en el mismo
      // instante): si ahora existe, se usa esa fila.
      const { data: retryId } = await admin.rpc("find_auth_user_id_by_phone", {
        p_phone: phoneE164,
      });
      if (typeof retryId === "string" && retryId.length > 0) {
        authUserId = retryId;
      } else {
        console.error(`[${logTag}] createUser failed and recheck miss:`, createErr?.message);
        return { ok: false, stage: "create" };
      }
    } else {
      authUserId = created.user.id;
    }
  }

  // El email sintético tiene que estar en la fila (las cuentas de solo SMS no
  // lo tienen). updateUserById es idempotente.
  {
    const { data: info } = await admin.auth.admin.getUserById(authUserId);
    if (info?.user && info.user.email !== syntheticEmail) {
      const { error: updErr } = await admin.auth.admin.updateUserById(
        authUserId,
        { email: syntheticEmail, email_confirm: true },
      );
      if (updErr) {
        // No fatal: generateLink lo intenta igual.
        console.error(`[${logTag}] updateUserById failed:`, updErr.message);
      }
    }
  }

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: syntheticEmail,
  });
  const emailOtp =
    (linkData?.properties as { email_otp?: string } | undefined)?.email_otp ?? null;
  if (linkErr || !emailOtp) {
    console.error(`[${logTag}] generateLink failed:`, linkErr?.message);
    return { ok: false, stage: "link" };
  }

  const supabase = await createServerSupabase();
  // scope:'local' — solo este navegador. 'global' revocaría las sesiones del
  // usuario anterior en sus otros dispositivos.
  await supabase.auth.signOut({ scope: "local" }).catch(() => {});

  const { error: verifyErr } = await supabase.auth.verifyOtp({
    email: syntheticEmail,
    token: emailOtp,
    type: "email",
  });
  if (verifyErr) {
    console.error(`[${logTag}] verifyOtp failed:`, verifyErr.message);
    return { ok: false, stage: "verify" };
  }

  // Igual que el flujo SMS: public.users guarda el teléfono sin "+".
  await admin
    .from("users")
    .update({ whatsapp_number: phoneNormalized, whatsapp_verified: true })
    .eq("id", authUserId);

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

  return { ok: true, userId: authUserId, needsOnboarding };
}

/**
 * Cookie de atajo del middleware (lp_onb). Con onboarding completo se fija;
 * si falta, se BORRA para que una lp_onb=1 heredada de otra cuenta en este
 * navegador no deje escapar del gate de onboarding.
 */
export function applyOnboardingCookie(
  response: NextResponse,
  needsOnboarding: boolean,
): void {
  if (!needsOnboarding) {
    response.cookies.set("lp_onb", "1", {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });
  } else {
    response.cookies.delete("lp_onb");
  }
}
