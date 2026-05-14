// lib/whatsapp/onboarding.ts — WhatsApp-native onboarding flow.
//
// Web /onboarding sigue funcionando. Esto es la versión paralela 100% WA
// para users que prefieren no salir del chat (target: gente que llega
// por magic link y abandona en /onboarding antes de elegir pollito).
//
// Order:
//   1. Bot pregunta nombre.
//   2. User responde texto. Bot valida y manda reply buttons SI/NO con
//      el nombre encodeado en el payload (ej: "onbname_yes|Juan Pérez").
//   3. User confirma → bot guarda display_name → manda lista de pollitos.
//   4. User elige pollito (list reply id "onbpoll_<id>") → bot guarda
//      avatar_url → welcome + main menu.
//
// Por qué encodear el nombre en el payload en vez de un campo de state:
// evitamos migración a whatsapp_conversation_state. Reply button id tiene
// límite de 256 chars; nombres realistas (≤50 chars) sobran.

import { createAdminClient } from "@/lib/supabase/admin";
import { sendTextMessage } from "./bot";
import { sendReplyButtons } from "./interactive";
import { setState, getState, clearState } from "./state";
import { isValidDisplayName, needsName } from "@/lib/users/needs-name";
import { POLLITO_TYPES } from "@/lib/pollitos";

const FOOTER = "La Polla Colombiana 🐥";

/**
 * Returns true if the given user still needs to complete onboarding
 * (no real display_name OR no pollito picked). Mirror of the gate in
 * lib/supabase/middleware.ts so web and WA enforce the same rule.
 */
export function userNeedsOnboarding(user: {
  display_name: string | null;
  avatar_url: string | null;
}): boolean {
  return needsName(user.display_name) || !user.avatar_url;
}

// ─── Step 1: ask for name ───

export async function handleAskName(phone: string): Promise<void> {
  await setState(phone, { action: "onboarding_ask_name" });
  await sendTextMessage(
    phone,
    "¡Bienvenido a *La Polla Colombiana*! 🐥\n\n" +
      "Escríbeme tu nombre. Ej: *Juan*",
  );
}

// ─── Step 2: validate name and ask for confirmation ───

export async function handleNameSubmit(
  phone: string,
  rawName: string,
): Promise<void> {
  const trimmed = rawName.trim().slice(0, 50);

  if (!isValidDisplayName(trimmed)) {
    // Invalid: too short, too long, or phone-shaped. Re-prompt.
    await sendTextMessage(
      phone,
      "Eso no me sirve como nombre, parce 🤔\n\n" +
        "Necesito mínimo 2 letras y que no sea un número de teléfono.\n\n" +
        "Mándame tu nombre de nuevo.",
    );
    return;
  }

  // Encode name into the button payload so we don't need a state column.
  // Reply button id max length is 256 — comfortable margin for ≤50-char
  // names. Title (the visible text) is capped to 20 chars por WA.
  const yesPayload = `onbname_yes|${trimmed}`;
  await sendReplyButtons(
    phone,
    `¿Tu nombre es *${trimmed}*?`,
    [
      { id: yesPayload, title: "Sí" },
      { id: "onbname_no", title: "No, cambiar" },
    ],
    undefined,
    FOOTER,
  );
  // No state change here — the payload carries the candidate name.
}

// ─── Step 3: save name + assign random pollito → done ───
//
// Decisión 2026-05-04: NO pedimos pollito en el onboarding de WA. Lo
// asignamos aleatorio. Razones:
//   - Elegir avatar visual sin previews es UX horrible en WA.
//   - El user puede cambiar el pollito después desde el perfil web.
//   - Onboarding queda en UN solo paso (nombre), reduce abandono.
// El web /onboarding sigue mostrando el picker como antes.

export async function handleNameConfirmed(
  phone: string,
  name: string,
): Promise<void> {
  const supabase = createAdminClient();
  const { normalizePhone, emailForPhone } = await import("@/lib/auth/phone");

  const phoneNormalized = normalizePhone(phone);
  const phoneE164 = `+${phoneNormalized}`;
  const syntheticEmail = emailForPhone(phoneNormalized);
  const finalName = name.trim().slice(0, 50);

  // Asignar pollito aleatorio. Excluimos los "hincha de equipo" (dim,
  // millos, verde, envigado) para no asumir afinidad de equipo de un
  // user nuevo — sería raro que a un hincha del Nacional le toque el
  // pollito del Millos por sorteo.
  const generic = POLLITO_TYPES.filter(
    (p) => !["dim", "millos", "verde", "envigado"].includes(p.id),
  );
  const randomPollito = generic[Math.floor(Math.random() * generic.length)];

  // FIND-OR-CREATE atomico. Acá es donde realmente nace la cuenta — si el
  // user llego como telefono desconocido (router.ts → routeOnboarding) y
  // ahora confirma el nombre, creamos auth.users + public.users en este
  // momento. Si ya existe (caso "user legacy con shell sin nombre que vuelve
  // a hablarle al bot"), solo actualizamos su row.
  let authUserId: string | null = null;
  const { data: rpcId } = await supabase.rpc("find_auth_user_id_by_phone", {
    p_phone: phoneE164,
  });
  if (typeof rpcId === "string" && rpcId.length > 0) {
    authUserId = rpcId;
  }

  if (!authUserId) {
    const { data: created, error: createErr } =
      await supabase.auth.admin.createUser({
        phone: phoneE164,
        phone_confirm: true,
        email: syntheticEmail,
        email_confirm: true,
      });
    if (createErr || !created.user) {
      // Race: SMS OTP o magic-link tap concurrente pudo haber creado el
      // user entre el RPC y el createUser. Re-leemos.
      const { data: retryId } = await supabase.rpc("find_auth_user_id_by_phone", {
        p_phone: phoneE164,
      });
      if (typeof retryId === "string" && retryId.length > 0) {
        authUserId = retryId;
      } else {
        console.error("[onboarding] createUser failed:", createErr);
        await sendTextMessage(
          phone,
          "Algo falló creando tu cuenta, parce. Intenta de nuevo en un minuto.",
        );
        return;
      }
    } else {
      authUserId = created.user.id;
    }
  }

  // Upsert public.users con nombre + pollito + phone. El trigger
  // auth.users → public.users normalmente ya creo una row vacia al
  // momento del createUser de arriba; el upsert la completa con todo
  // de una vez. onConflict=id la convierte en UPDATE para users legacy.
  const { error: upsertErr } = await supabase
    .from("users")
    .upsert(
      {
        id: authUserId,
        whatsapp_number: phoneNormalized,
        whatsapp_verified: true,
        display_name: finalName,
        avatar_url: randomPollito.id,
      },
      { onConflict: "id" },
    );
  if (upsertErr) {
    console.error("[onboarding] save profile failed:", upsertErr);
    await sendTextMessage(
      phone,
      "Algo falló guardando tu perfil, parce. Intenta de nuevo en un minuto.",
    );
    return;
  }

  // Antes de limpiar el state, sacar pendingJoinCode si lo había (caso
  // wa.me link de invitación). Si está, unimos directo a esa polla.
  const prev = await getState(phone);
  const pendingCode = prev?.pendingJoinCode;
  await clearState(phone);

  if (pendingCode) {
    const { handleJoinByCode } = await import("./flows");
    await sendTextMessage(
      phone,
      "¡Listo parce! 🎉 Tu perfil está armado.\n\n" +
        "Te uno a la polla 👇",
    );
    await handleJoinByCode(phone, authUserId, pendingCode);
    return;
  }

  // Sin pending code: welcome + pedimos el código directo (state
  // waiting_join_code para que un bareCode lo procese sin SI/NO).
  await setState(phone, { action: "waiting_join_code" });
  await sendTextMessage(
    phone,
    "¡Listo parce! 🎉 Tu perfil está armado.\n\n" +
      "Mándame el *código de 6 caracteres* de la polla a la que te invitaron 🐥",
  );
}
