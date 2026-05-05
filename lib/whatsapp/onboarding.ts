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
import { sendReplyButtons, sendListMessage } from "./interactive";
import { setState, clearState } from "./state";
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
      "Para armar tu perfil necesito saber cómo te llamas.\n\n" +
      "Mándame tu nombre (o como te dicen los amigos). Ej: *Juan Pérez* o *Juancho*",
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
  // names. Title (the visible text) is capped to 20.
  const yesPayload = `onbname_yes|${trimmed}`;
  await sendReplyButtons(
    phone,
    `¿Tu nombre es *${trimmed}*?`,
    [
      { id: yesPayload, title: "Sí, ese soy" },
      { id: "onbname_no", title: "No, lo escribo de nuevo" },
    ],
    undefined,
    FOOTER,
  );
  // No state change here — the payload carries the candidate name.
}

// ─── Step 3: save name and ask for pollito ───

export async function handleNameConfirmed(
  phone: string,
  userId: string,
  name: string,
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("users")
    .update({ display_name: name.trim().slice(0, 50) })
    .eq("id", userId);
  if (error) {
    console.error("[onboarding] save name failed:", error);
    await sendTextMessage(
      phone,
      "Algo falló guardando tu nombre, parce. Intenta de nuevo en un minuto.",
    );
    return;
  }
  await sendAskPollito(phone, /*page*/ 0);
}

// ─── Step 4: pollito picker (paginated 10 + 6) ───

const POLLITOS_PER_PAGE = 9; // leave 1 row for "Ver más" on page 0

export async function sendAskPollito(
  phone: string,
  page: number,
): Promise<void> {
  await setState(phone, { action: "onboarding_pick_pollito" });

  const start = page * POLLITOS_PER_PAGE;
  const end = start + POLLITOS_PER_PAGE;
  const slice = POLLITO_TYPES.slice(start, end);
  const hasMore = end < POLLITO_TYPES.length;

  const rows: { id: string; title: string }[] = slice.map((p) => ({
    id: `onbpoll_${p.id}`,
    title: p.label.slice(0, 24), // WA list row title cap
  }));
  if (hasMore) {
    rows.push({ id: `onbpoll_more_${page + 1}`, title: "Ver más pollitos ➡️" });
  } else if (page > 0) {
    rows.push({ id: `onbpoll_more_0`, title: "⬅️ Volver al inicio" });
  }

  const headerText = page === 0 ? "🐥 Elige tu pollito" : "🐥 Más pollitos";
  await sendListMessage(
    phone,
    "Tu pollito te representa en las pollas y en la tabla. " +
      "Lo puedes cambiar después desde tu perfil.",
    "Ver opciones",
    [{ title: headerText, rows }],
    headerText,
    FOOTER,
  );
}

// ─── Step 5: save pollito + welcome ───

export async function handlePollitoConfirmed(
  phone: string,
  userId: string,
  pollitoId: string,
): Promise<void> {
  // Validate the id is one of ours (defense against tampered payload).
  const valid = POLLITO_TYPES.some((p) => p.id === pollitoId);
  if (!valid) {
    await sendTextMessage(
      phone,
      "No reconocí ese pollito, parce. Intenta de nuevo escribiendo *menu*.",
    );
    await clearState(phone);
    return;
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("users")
    .update({ avatar_url: pollitoId })
    .eq("id", userId);
  if (error) {
    console.error("[onboarding] save pollito failed:", error);
    await sendTextMessage(
      phone,
      "Algo falló guardando tu pollito. Intenta de nuevo en un minuto.",
    );
    return;
  }

  await clearState(phone);

  // Welcome + nudge to either join with a code or create their own.
  await sendReplyButtons(
    phone,
    "¡Listo, parcero! 🎉 Ya tienes tu perfil armado.\n\n" +
      "Ahora puedes unirte a una polla con un código o crear la tuya.",
    [{ id: "join_with_code", title: "Unirme con código" }],
    undefined,
    FOOTER,
  );
}
