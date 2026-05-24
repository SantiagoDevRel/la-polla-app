// app/api/users/me/delete/route.ts — Borrado de cuenta self-service.
//
// Requerido por Apple App Store guideline 5.1.1(v): toda app que permite
// crear cuenta DEBE ofrecer borrado de cuenta in-app (no por email).
//
// Modelo de borrado (decision user 2026-05-19): "anonimizar organizador,
// mantener la polla viva". Implementado de forma natural por el schema:
//   - pollas.created_by → users(id) ON DELETE SET NULL: al borrar el user,
//     sus pollas SOBREVIVEN para los demas participantes (created_by queda
//     NULL). No hay que anonimizar a mano.
//   - polla_participants / predictions / feedback / match_result_notifications
//     / payment_proofs → ON DELETE CASCADE: se borran solos.
//
// Tablas que NO tienen ON DELETE rule (default NO ACTION → bloquearian el
// delete) y que limpiamos explicito ANTES de borrar el user:
//   - polla_invites.invited_by, whatsapp_messages.user_id, notifications.user_id
//
// Tablas keyed por telefono (sin FK a users) — limpieza explicita:
//   - otp_rate_limits.phone_number, wa_magic_tokens.phone_number,
//     whatsapp_conversation_state.phone

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST() {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const admin = createAdminClient();
    const userId = user.id;

    // Telefono para limpiar tablas keyed-by-phone (sin FK a users).
    const { data: profile } = await admin
      .from("users")
      .select("whatsapp_number")
      .eq("id", userId)
      .maybeSingle();
    const phone = profile?.whatsapp_number ?? null;

    // 1. Limpiar tablas que bloquearian el delete (FK sin ON DELETE rule) +
    //    el resto de datos personales. Best-effort: si una tabla no existe
    //    o ya esta vacia, seguimos. El delete de users (paso 2) es el que
    //    realmente importa para FK integrity.
    const byUser = [
      "polla_invites:invited_by",
      "whatsapp_messages:user_id",
      "notifications:user_id",
      "predictions:user_id",
      "polla_participants:user_id",
      "match_result_notifications:user_id",
      "feedback:user_id",
      "payment_proofs:user_id",
      "wa_template_sends:user_id",
    ];
    for (const entry of byUser) {
      const [table, col] = entry.split(":");
      const { error } = await admin.from(table).delete().eq(col, userId);
      if (error) {
        console.warn(`[delete-account] cleanup ${table}.${col} failed (continuing):`, error.message);
      }
    }

    if (phone) {
      const byPhone = [
        "otp_rate_limits:phone_number",
        "wa_magic_tokens:phone_number",
        "whatsapp_conversation_state:phone",
      ];
      for (const entry of byPhone) {
        const [table, col] = entry.split(":");
        const { error } = await admin.from(table).delete().eq(col, phone);
        if (error) {
          console.warn(`[delete-account] cleanup ${table}.${col} failed (continuing):`, error.message);
        }
      }
    }

    // 2. Borrar la fila public.users. CASCADE/SET NULL del schema hace el
    //    resto: participations/predictions caen, pollas creadas sobreviven
    //    con created_by=NULL.
    const { error: delErr } = await admin.from("users").delete().eq("id", userId);
    if (delErr) {
      console.error("[delete-account] users delete failed:", delErr);
      return NextResponse.json(
        { error: "No se pudo eliminar la cuenta. Intenta de nuevo." },
        { status: 500 },
      );
    }

    // 3. Borrar la identidad de auth (mata el login + saca el telefono de
    //    auth.users). public.users.id NO es FK a auth.users, asi que hay
    //    que borrar ambos explicitamente.
    const { error: authErr } = await admin.auth.admin.deleteUser(userId);
    if (authErr) {
      // public.users ya se borro; el usuario no puede operar. Logueamos
      // pero no fallamos toda la request — el dato personal ya se fue.
      console.error("[delete-account] auth.admin.deleteUser failed:", authErr.message);
    }

    // 4. Cerrar la sesion actual (cookies).
    await supabase.auth.signOut().catch(() => {});

    // 5. Limpiar la cookie lp_onb (HttpOnly, el cliente no puede borrarla).
    const response = NextResponse.json({ success: true });
    response.cookies.delete("lp_onb");
    return response;
  } catch (error) {
    console.error("[delete-account] unexpected error:", error);
    return NextResponse.json(
      { error: "Error al eliminar la cuenta" },
      { status: 500 },
    );
  }
}
