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
import { clearState, getState } from "./state";
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
}

export async function processIncomingMessage(
  message: IncomingMessage,
): Promise<void> {
  const { from, type, text, interactive } = message;

  const supabase = createAdminClient();
  const { data: user } = await supabase
    .from("users")
    .select("id, display_name, whatsapp_number")
    .eq("whatsapp_number", from)
    .maybeSingle();

  if (!user) {
    await handleUnknownUser(from);
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

    // Mid-flow: waiting for a score input.
    const state = await getState(from);
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
          "Listo parce, no te uniste. Si querés probar con otro código, mándamelo de nuevo.",
        );
        return;
      }
      // Any other text falls through to the default menu nudge below.
    }

    // Bare 6-char code in the join alphabet → ask SI/NO.
    const bareCode = lower.match(/^[abcdefghjklmnpqrstuvwxyz23456789]{6}$/);
    if (bareCode) {
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

    // Default: nudge to menu.
    await sendTextMessage(
      from,
      "🤔 Parce, no entendí bien. Escribí *menu* y te muestro tus pollas.",
    );
    return;
  }

  // Anything else (sticker, audio, etc.).
  await sendTextMessage(
    from,
    "🤔 Parce, no entendí bien. Escribí *menu* y te muestro tus pollas.",
  );
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
    payload === "join_code_no";
  if (!keepState) {
    await clearState(from);
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
      "Listo parce, no te uniste. Si querés probar con otro código, mándamelo de nuevo.",
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
