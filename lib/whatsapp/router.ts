// lib/whatsapp/router.ts — Inbound WhatsApp message router.
//
// Lifted from the old lib/whatsapp/bot.ts processIncomingMessage +
// routePayload (deleted in commit 6210413, restored here when the
// conversational bot came back). Lives in its own file now so bot.ts
// stays focused on outbound sends and this file owns dispatch.
//
// Responsibilities:
//   1. Identify the user by phone (whatsapp_number lookup).
//   2. For text: parse for special inputs (prediction "2-1", join codes,
//      "ayuda", "perfil"), else fall through to menu-intent → main menu.
//   3. For interactive: dispatch the button/list payload ID through
//      routePayload to the right flow handler.
//   4. Unknown user → onboarding nudge.
//
// The webhook hands us `IncomingMessage`. We log inbound + outbound via
// bot.ts.logMessage indirectly (every send helper logs already).

import { createAdminClient } from "@/lib/supabase/admin";
import { sendTextMessage } from "./bot";
import { clearState, getState, setState } from "./state";
import {
  handleAskName,
  handleNameConfirmed,
  handleNameSubmit,
  userNeedsOnboarding,
} from "./onboarding";
import {
  askPaymentMethod,
  handlePaymentAccountSubmit,
  handlePaymentMethodSelected,
  handlePaymentProofImage,
  handleShowPaymentInfo,
} from "./payment";
import { looksLikeMenuIntent } from "./menu-intent";
import {
  handleCancelPrediction,
  handleConfirmPrediction,
  handleHelp,
  handleHelpTopic,
  handleJoinByCode,
  handleJoinByCodeConfirm,
  handleJoinPolla,
  handleLeaderboard,
  handleMainMenu,
  handleMisPollas,
  handlePollaMenu,
  handlePredictGroupMode,
  handlePredictGroupPage,
  handlePredictGroupReset,
  handlePredictGroupSelect,
  handlePredictionInput,
  handleProfile,
  handleResults,
  handleUnknownUser,
  handlePronosticar,
} from "./flows";

export interface IncomingMessage {
  from: string;
  type: string;
  text?: { body?: string };
  interactive?: {
    button_reply?: { id: string; title?: string };
    list_reply?: { id: string; title?: string };
  };
  image?: {
    id: string;
    mime_type?: string;
    caption?: string;
  };
}

export async function processIncomingMessage(
  message: IncomingMessage,
): Promise<void> {
  const { from, type, text, interactive, image } = message;

  const supabase = createAdminClient();
  const { data: user } = await supabase
    .from("users")
    .select("id, display_name, whatsapp_number, avatar_url")
    .eq("whatsapp_number", from)
    .maybeSingle();

  if (!user) {
    // Pass the message body so handleUnknownUser puede detectar "unirse
    // XXXXXX" en el primer mensaje (caso wa.me link de invite) y lo
    // guarda en pending_join_code para auto-join al final del onboarding.
    await handleUnknownUser(from, text?.body);
    return;
  }

  // ONBOARDING GATE — usuario existe pero le falta display_name o pollito.
  // Interceptamos antes que cualquier otra cosa para que el bot no muestre
  // mis-pollas / menú principal con un perfil incompleto.
  if (userNeedsOnboarding(user)) {
    // Si el primer mensaje contiene "unirse XXXXXX" (caso wa.me link de
    // invitación con perfil aún incompleto), preservamos el code para
    // auto-join al terminar onboarding. Mismo patrón que handleUnknownUser.
    if (text?.body) {
      const upper = text.body.trim().toUpperCase();
      const m = upper.match(/(?:^|\s)([ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6})(?:\s|$)/);
      if (m) {
        const existing = await getState(from);
        await setState(from, {
          action: existing?.action ?? "onboarding_ask_name",
          ...existing,
          pendingJoinCode: m[1],
        });
      }
    }
    await routeOnboarding(from, user, type, text, interactive);
    return;
  }

  // ─── IMAGEN: solo procesamos si state es waiting_payment_proof. Si no,
  // explicamos al user que solo aceptamos comprobantes acá.
  if (type === "image" && image?.id) {
    const state = await getState(from);
    if (state?.action === "waiting_payment_proof") {
      await handlePaymentProofImage(from, user.id, image.id);
      return;
    }
    await sendTextMessage(
      from,
      "Recibí tu foto 📸 pero no estaba esperando ninguna en este momento. " +
        "Si quieres mandar un comprobante de pago, primero únete a una polla y te lo pido cuando toque.",
    );
    return;
  }

  if (type === "interactive" && interactive) {
    const payload =
      interactive.button_reply?.id || interactive.list_reply?.id || "";
    if (payload) {
      await routePayload(from, user, payload);
    }
    return;
  }

  if (type === "text" && text?.body) {
    const body = text.body.trim();
    const lower = body.toLowerCase();

    const state = await getState(from);

    // Mid-flow: payment account input. Antes que cualquier comando para
    // que números no se interpreten como bareCode/score por error.
    if (state?.action === "waiting_payment_account") {
      await handlePaymentAccountSubmit(from, user.id, body);
      return;
    }

    // Comandos para gestionar info de pago.
    if (lower === "pago" || lower === "metodo de pago" || lower === "método de pago") {
      await handleShowPaymentInfo(from, user.id);
      return;
    }
    if (lower === "cambiar pago" || lower === "cambiar metodo de pago" || lower === "cambiar método de pago") {
      await askPaymentMethod(from);
      return;
    }

    // Mid-flow: waiting for a score input.
    if (state && state.action === "waiting_prediction" && state.pollaId) {
      if (lower === "cancelar") {
        await handleCancelPrediction(
          from,
          user.id,
          state.pollaId,
          state.matchId!,
        );
        return;
      }
      const predMatch = body.match(/^(\d{1,2})\s*[-:]\s*(\d{1,2})$/);
      if (!predMatch) {
        await sendTextMessage(
          from,
          "Ingresá solo números parce, sin letras ni símbolos. Escribí el marcador así: *2-1* _(local primero)_",
        );
        return;
      }
      const h = parseInt(predMatch[1], 10);
      const a = parseInt(predMatch[2], 10);
      if (h > 20 || a > 20) {
        await sendTextMessage(
          from,
          "Eso parece mucho parce 😅 ¿Estás seguro? Escribí el marcador de nuevo (ej: *2-1*).",
        );
        return;
      }
      await handlePredictionInput(from, user, state.pollaId, state.matchId!, h, a);
      return;
    }

    // Join link in URL form.
    if (lower.includes("/unirse/") || lower.includes("/pollas/")) {
      const slugMatch = lower.match(/\/(?:unirse|pollas)\/([a-z0-9-]+)/);
      if (slugMatch) {
        await handleJoinPolla(from, user, slugMatch[1]);
        return;
      }
    }

    // Explicit "unirse CODE".
    const unirseMatch = lower.match(/^unirse\s+([a-z0-9]{6})$/);
    if (unirseMatch) {
      await handleJoinByCode(from, user.id, unirseMatch[1].toUpperCase());
      return;
    }

    // Mid-flow: waiting for SI/NO on a bare-code join.
    if (
      state &&
      state.action === "waiting_join_confirm" &&
      state.joinCode
    ) {
      if (lower === "si" || lower === "sí" || lower === "yes") {
        await handleJoinByCode(from, user.id, state.joinCode);
        return;
      }
      if (lower === "no") {
        await clearState(from);
        await sendTextMessage(
          from,
          "Listo, no te uniste. Si quieres probar con otro código, mándamelo de nuevo.",
        );
        return;
      }
      // Any other text falls through to the default menu nudge below.
    }

    // Bare 6-char code in the join alphabet.
    const bareCode = lower.match(/^[abcdefghjklmnpqrstuvwxyz23456789]{6}$/);
    if (bareCode) {
      // Si veníamos del flujo "Unirme con código" (empty Mis Pollas →
      // botón → user manda el código), saltar la confirmación SI/NO y
      // unir directo: el user ya consintió al tapear el botón.
      if (state?.action === "waiting_join_code") {
        await clearState(from);
        await handleJoinByCode(from, user.id, lower.toUpperCase());
        return;
      }
      await handleJoinByCodeConfirm(from, lower.toUpperCase());
      return;
    }

    if (["ayuda", "help"].includes(lower)) {
      await handleHelp(from);
      return;
    }

    if (["perfil", "profile"].includes(lower)) {
      await handleProfile(from, user.id);
      return;
    }

    if (looksLikeMenuIntent(body)) {
      await handleMainMenu(from, user.display_name, user.id);
      return;
    }

    // Default: cualquier texto no reconocido → menú principal con
    // botones. Decisión 2026-05-04 del user: nada de "no entendí, escribe
    // menu" — directo al menú para no dejar al user en dead-end.
    await handleMainMenu(from, user.display_name, user.id);
    return;
  }

  // Sticker / audio / unsupported → menú directo (mismo principio).
  await handleMainMenu(from, user.display_name, user.id);
}

async function routePayload(
  from: string,
  user: { id: string; display_name: string },
  payload: string,
): Promise<void> {
  // Clear conversation state on a fresh button press unless this payload
  // is itself part of a continuation (pagination, confirmations).
  const keepState =
    payload.startsWith("pred_next_") ||
    payload.startsWith("match_") ||
    payload.startsWith("more_") ||
    payload.startsWith("predgrp_") ||
    payload.startsWith("pgsel|") ||
    payload.startsWith("pgmore|") ||
    payload.startsWith("pgreset|") ||
    payload === "confirm_yes" ||
    payload === "confirm_no" ||
    payload === "join_code_yes" ||
    payload === "join_code_no" ||
    payload.startsWith("paymeth_");
  if (!keepState) {
    await clearState(from);
  }

  // "Unirme con código" desde empty-state de Mis Pollas. Setea state y
  // pide al user que escriba el código de 6 caracteres en el próximo
  // mensaje. La text branch lo agarra cuando state.action === "waiting_join_code"
  // y llama handleJoinByCode directo (sin pasar por el SI/NO de
  // handleJoinByCodeConfirm — el user ya pidió explícitamente unirse).
  if (payload === "join_with_code") {
    await setState(from, { action: "waiting_join_code" });
    await sendTextMessage(
      from,
      "¡Listo! 🐥\n\nMándame el *código de 6 caracteres* de la polla que quieres entrar\n\n_Te lo pasa el organizador de la polla._",
    );
    return;
  }

  // Selección de banco para método de pago.
  if (payload.startsWith("paymeth_")) {
    const methodId = payload.slice("paymeth_".length);
    await handlePaymentMethodSelected(from, methodId);
    return;
  }

  // Join-by-code SI/NO.
  if (payload === "join_code_yes") {
    const state = await getState(from);
    if (state?.action === "waiting_join_confirm" && state.joinCode) {
      await handleJoinByCode(from, user.id, state.joinCode);
    } else {
      await sendTextMessage(
        from,
        "Parce, se me perdió el código. Mándalo de nuevo porfa.",
      );
    }
    return;
  }
  if (payload === "join_code_no") {
    await clearState(from);
    await sendTextMessage(
      from,
      "Listo, no te uniste. Si quieres probar con otro código, mándamelo de nuevo.",
    );
    return;
  }

  if (payload === "menu") {
    await handleMainMenu(from, user.display_name, user.id);
    return;
  }

  if (payload === "menu_mis_pollas" || payload === "mis_pollas") {
    await handleMisPollas(from, user.id);
    return;
  }
  if (payload === "menu_predecir" || payload === "pronosticar") {
    await handleMisPollas(from, user.id);
    return;
  }
  if (payload === "menu_tabla" || payload === "tabla") {
    await handleMisPollas(from, user.id);
    return;
  }

  if (payload.startsWith("polla_")) {
    const pollaId = payload.replace("polla_", "");
    await handlePollaMenu(from, user.id, pollaId);
    return;
  }

  if (payload.startsWith("pred_")) {
    const pollaId = payload.replace("pred_", "").replace("next_", "");
    await handlePronosticar(from, user.id, pollaId);
    return;
  }

  if (payload.startsWith("predgrp_phase_")) {
    const pollaId = payload.replace("predgrp_phase_", "");
    await handlePredictGroupMode(from, user.id, pollaId, "phase");
    return;
  }
  if (payload.startsWith("predgrp_date_")) {
    const pollaId = payload.replace("predgrp_date_", "");
    await handlePredictGroupMode(from, user.id, pollaId, "date");
    return;
  }

  if (payload.startsWith("pgreset|")) {
    const parts = payload.split("|");
    if (parts.length >= 2) {
      await handlePredictGroupReset(from, user.id, parts[1]);
    }
    return;
  }

  if (payload.startsWith("pgmore|")) {
    const parts = payload.split("|");
    if (parts.length >= 3) {
      const page = parseInt(parts[2], 10) || 0;
      await handlePredictGroupPage(from, user.id, parts[1], page);
    }
    return;
  }

  if (payload.startsWith("pgsel|")) {
    const parts = payload.split("|");
    if (parts.length >= 3) {
      const groupKey = parts.slice(2).join("|");
      await handlePredictGroupSelect(from, user.id, parts[1], groupKey);
    }
    return;
  }

  if (payload.startsWith("more_")) {
    const rest = payload.replace("more_", "");
    const lastUnderscore = rest.lastIndexOf("_");
    const pollaId = rest.substring(0, lastUnderscore);
    const page = parseInt(rest.substring(lastUnderscore + 1), 10) || 0;
    await handlePronosticar(from, user.id, pollaId, undefined, page);
    return;
  }

  if (payload.startsWith("match_")) {
    const state = await getState(from);
    if (state && state.pollaId) {
      const matchId = payload.replace("match_", "");
      await handlePronosticar(from, user.id, state.pollaId, matchId);
    } else {
      await sendTextMessage(
        from,
        "Ups parce, se me perdió el hilo. ¿Cuál polla querías pronosticar?",
      );
      await handleMisPollas(from, user.id);
    }
    return;
  }

  if (payload.startsWith("rank_")) {
    const pollaId = payload.replace("rank_", "");
    await handleLeaderboard(from, user.id, pollaId);
    return;
  }

  if (payload.startsWith("results_")) {
    const pollaId = payload.replace("results_", "");
    await handleResults(from, user.id, pollaId);
    return;
  }

  if (payload === "confirm_yes") {
    const state = await getState(from);
    if (state && state.action === "confirm_prediction" && state.pollaId) {
      await handleConfirmPrediction(from, user, {
        ...state,
        pollaId: state.pollaId,
      });
    } else {
      await sendTextMessage(
        from,
        "Parce, perdí tu pronóstico. Dale de nuevo a Pronosticar para volver a mandarlo.",
      );
      await handleMisPollas(from, user.id);
    }
    return;
  }

  if (payload === "confirm_no") {
    const state = await getState(from);
    if (state && state.pollaId) {
      await handlePronosticar(from, user.id, state.pollaId);
    } else {
      await sendTextMessage(
        from,
        "Ups, se me olvidó que ibas a cambiar. Dale a Pronosticar de nuevo.",
      );
      await handleMisPollas(from, user.id);
    }
    return;
  }

  if (payload === "menu_ayuda") {
    await handleHelp(from);
    return;
  }
  if (payload.startsWith("help_")) {
    await handleHelpTopic(from, user, payload);
    return;
  }
  if (payload === "menu_perfil" || payload === "help_perfil") {
    await handleProfile(from, user.id);
    return;
  }

  // Fallback: re-render the main menu.
  await handleMainMenu(from, user.display_name, user.id);
}

// ─── Onboarding routing ───
//
// Sólo se llama cuando userNeedsOnboarding(user) === true. Maneja:
//   - Texto libre: intent "ask_name" recibe nombre, "pick_pollito" pide
//     re-tap del botón.
//   - Payloads: onbname_yes|<name> guarda nombre, onbname_no re-pregunta,
//     onbpoll_<id> guarda pollito, onbpoll_more_<page> pagina la lista.
async function routeOnboarding(
  from: string,
  user: { id: string; display_name: string | null; avatar_url: string | null },
  type: string,
  text?: { body?: string },
  interactive?: {
    button_reply?: { id: string; title?: string };
    list_reply?: { id: string; title?: string };
  },
): Promise<void> {
  const state = await getState(from);

  if (type === "interactive" && interactive) {
    const payload =
      interactive.button_reply?.id || interactive.list_reply?.id || "";
    if (!payload) return;

    // onbname_yes|<name>
    if (payload.startsWith("onbname_yes|")) {
      const name = payload.slice("onbname_yes|".length);
      await handleNameConfirmed(from, user.id, name);
      return;
    }
    if (payload === "onbname_no") {
      await handleAskName(from);
      return;
    }
    // Stale payload from un flujo anterior → re-prompt onboarding.
    await handleAskName(from);
    return;
  }

  if (type === "text" && text?.body) {
    const body = text.body.trim();

    if (state?.action === "onboarding_ask_name") {
      await handleNameSubmit(from, body);
      return;
    }

    // No state set yet — start from the top (pedir nombre).
    await handleAskName(from);
    return;
  }

  // Anything else (sticker, audio) → restart prompt.
  await handleAskName(from);
}

