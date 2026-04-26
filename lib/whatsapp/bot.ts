// lib/whatsapp/bot.ts — WhatsApp bot: message sending, routing, and processing
// Extends existing OTP flow with conversational bot capabilities
import axios from "axios";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateOTP } from "@/lib/utils/otp";
import { findPendingOTP, markOTPSent } from "@/lib/utils/otp";
import { redactPhone } from "@/lib/log";
import { looksLikeMenuIntent } from "./menu-intent";
import { getOTPMessage } from "./messages";
import { sendCTAButton } from "./interactive";
import { getState, clearState } from "./state";
import {
  handleMainMenu,
  handleUnknownUser,
  handleMisPollas,
  handlePollaMenu,
  handlePronosticar,
  handlePredictGroupMode,
  handlePredictGroupPage,
  handlePredictGroupReset,
  handlePredictGroupSelect,
  handlePredictionInput,
  handleLeaderboard,
  handleResults,
  handleJoinPolla,
  handleJoinByCode,
  handleJoinByCodeConfirm,
  handleRotateCode,
  handleRotateCodeConfirm,
  handleHelp,
  handleProfile,
  handleHelpTopic,
  handleConfirmPrediction,
  handleCancelPrediction,
} from "./flows";

// Validate required env vars on module load. Hard-throw instead of
// warn: if either is missing the Graph URL would resolve to
// ".../v21.0/undefined/messages" and every send would fail at runtime
// with an opaque 404. Fail-fast at boot surfaces the misconfiguration
// immediately in the build / deploy pipeline.
const META_WA_ACCESS_TOKEN = process.env.META_WA_ACCESS_TOKEN;
const META_WA_PHONE_NUMBER_ID = process.env.META_WA_PHONE_NUMBER_ID;

if (!META_WA_ACCESS_TOKEN || !META_WA_PHONE_NUMBER_ID) {
  throw new Error(
    "[whatsapp] Missing required env: META_WA_ACCESS_TOKEN and/or " +
    "META_WA_PHONE_NUMBER_ID. Refusing to start — sends would 404 " +
    "at runtime otherwise."
  );
}

const WA_API_URL = `https://graph.facebook.com/v21.0/${META_WA_PHONE_NUMBER_ID}/messages`;

// ─── Types ───

export interface IncomingMessage {
  from: string;
  type: string;
  text?: { body: string };
  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
  };
  wa_message_id?: string;
}

interface ButtonAction {
  type: "reply";
  reply: { id: string; title: string };
}

// ─── Message Sending ───

export async function sendTextMessage(to: string, text: string) {
  const response = await callMetaAPI(to, {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  });
  await logMessage(to, "outbound", "text", text);
  return response;
}

export async function sendButtonMessage(
  to: string,
  header: string,
  body: string,
  buttons: { id: string; title: string }[]
) {
  const buttonActions: ButtonAction[] = buttons.slice(0, 3).map((b) => ({
    type: "reply",
    reply: { id: b.id, title: b.title.slice(0, 20) },
  }));

  const response = await callMetaAPI(to, {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      header: { type: "text", text: header },
      body: { text: body },
      action: { buttons: buttonActions },
    },
  });
  await logMessage(to, "outbound", "interactive_button", `${header}: ${body}`);
  return response;
}

export async function sendListMessage(
  to: string,
  header: string,
  body: string,
  buttonText: string,
  items: { id: string; title: string; description?: string }[]
) {
  const rows = items.slice(0, 10).map((item) => ({
    id: item.id,
    title: item.title.slice(0, 24),
    description: item.description?.slice(0, 72) || "",
  }));

  const response = await callMetaAPI(to, {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: header },
      body: { text: body },
      action: {
        button: buttonText.slice(0, 20),
        sections: [{ title: "Opciones", rows }],
      },
    },
  });
  await logMessage(to, "outbound", "interactive_list", `${header}: ${body}`);
  return response;
}

// Keep the original function signature for backwards compatibility (OTP flow uses it)
export async function sendWhatsAppMessage(to: string, text: string) {
  return sendTextMessage(to, text);
}

// ─── Meta API Call ───

async function callMetaAPI(to: string, payload: Record<string, unknown>) {
  try {
    const response = await axios.post(WA_API_URL, payload, {
      headers: {
        Authorization: `Bearer ${META_WA_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    });
    return response;
  } catch (error: unknown) {
    const axiosErr = error as { response?: { data?: unknown; status?: number } };
    console.error("[WA] Error status:", axiosErr.response?.status);
    console.error("[WA] Error Meta:", JSON.stringify(axiosErr.response?.data));
    throw error;
  }
}

// ─── Message Logging ───

async function logMessage(
  phone: string,
  direction: "inbound" | "outbound",
  messageType: string,
  content: string
) {
  try {
    const supabase = createAdminClient();

    // Find user by phone number
    const { data: user } = await supabase
      .from("users")
      .select("id")
      .eq("whatsapp_number", phone)
      .single();

    await supabase.from("whatsapp_messages").insert({
      user_id: user?.id || null,
      direction,
      message_type: messageType,
      content: content.slice(0, 1000),
      status: "delivered",
    });
  } catch (err) {
    console.error("[WA] Error logging message:", err);
  }
}

// ─── Message Processing & Routing ───

export async function processIncomingMessage(message: IncomingMessage) {
  const { from, type, text, interactive } = message;

  // Phone is PII; we log the redacted form (country prefix + last 3) so
  // we can still correlate without leaking the full number into Vercel logs.
  console.log(`[WA] Incoming from: ${redactPhone(from)} | type: ${type}`);

  // Log inbound message
  const inboundContent =
    text?.body ||
    interactive?.button_reply?.title ||
    interactive?.list_reply?.title ||
    "[unknown]";
  await logMessage(from, "inbound", type, inboundContent);

  // 0a. Bot-first login gate: if this phone tapped "Abrir WhatsApp" in the
  // login page, a row exists in login_pending_sessions. On any inbound
  // message from that phone we generate + deliver the OTP here, mark the
  // session code_sent=true, and return. The frontend is polling and will
  // advance to the code-entry step once it sees code_sent.
  try {
    const normalizedPhone = from.replace(/^\+/, "");
    const adminForGate = createAdminClient();
    const { data: pendingSession } = await adminForGate
      .from("login_pending_sessions")
      .select("phone, expires_at, code_sent")
      .eq("phone", normalizedPhone)
      .maybeSingle();
    if (
      pendingSession &&
      !pendingSession.code_sent &&
      new Date(pendingSession.expires_at).getTime() > Date.now()
    ) {
      const code = await generateOTP(from);
      const APP_URL =
        (process.env.NEXT_PUBLIC_APP_URL ?? "").trim() || "https://lapollacolombiana.com";
      await sendCTAButton(
        from,
        `🔐 *Tu código de verificación*\n\n` +
          `*${code}*\n\n` +
          `Válido por 10 minutos\n` +
          `Ingresa este código en la app para continuar 👇`,
        "Abrir La Polla 🐔",
        `${APP_URL}/login`,
        "La Polla Colombiana 🐥"
      );
      const justCreated = await findPendingOTP(from);
      if (justCreated) await markOTPSent(justCreated.id);
      await adminForGate
        .from("login_pending_sessions")
        .update({ code_sent: true, code_sent_at: new Date().toISOString() })
        .eq("phone", normalizedPhone);
      return;
    }
  } catch (err) {
    console.error("[WA] login-gate OTP send failed:", err);
    // Fall through to the legacy pending-OTP path rather than stranding the user.
  }

  // 0. Check for pending OTP BEFORE normal routing
  // This allows new users (not yet in DB) to receive their OTP
  try {
    const pendingOTP = await findPendingOTP(from);
    if (pendingOTP) {
      console.log(`[WA] Found pending OTP for ${redactPhone(from)}, delivering...`);
      const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim() || "https://lapollacolombiana.com";
      await sendCTAButton(
        from,
        `🔐 *Tu código de verificación*\n\n` +
          `*${pendingOTP.code}*\n\n` +
          `Válido por 10 minutos\n` +
          `Ingresa este código en la app para continuar 👇`,
        "Abrir La Polla 🐔",
        `${APP_URL}/verify`,
        "La Polla Colombiana 🐥"
      );
      await markOTPSent(pendingOTP.id);
      return;
    }
  } catch (err) {
    console.error("[WA] Error checking pending OTP:", err);
    // Continue normal flow if OTP check fails
  }

  // 1. Lookup user by phone number
  const supabase = createAdminClient();
  const { data: user } = await supabase
    .from("users")
    .select("id, display_name, whatsapp_number")
    .eq("whatsapp_number", from)
    .single();

  // 2. Unknown user
  if (!user) {
    await handleUnknownUser(from);
    return;
  }

  // 3. Handle interactive replies (button or list)
  if (type === "interactive" && interactive) {
    const payload =
      interactive.button_reply?.id || interactive.list_reply?.id || "";

    await routePayload(from, user, payload);
    return;
  }

  // 4. Handle text messages
  if (type === "text" && text?.body) {
    const body = text.body.trim().toLowerCase();

    // OTP flow — preserve existing behavior
    if (body === "codigo" || body === "código") {
      const otp = await generateOTP(from);
      await sendTextMessage(from, getOTPMessage(otp));
      return;
    }

    // RULE 6 — prediction input validation when the bot is waiting for a score.
    const state = await getState(from);
    if (state && state.action === "waiting_prediction" && state.pollaId) {
      const trimmed = body.trim();
      // "cancelar" escapes the update and returns to the polla menu, keeping
      // any existing prediction intact.
      if (trimmed.toLowerCase() === "cancelar") {
        await handleCancelPrediction(
          from,
          user.id,
          state.pollaId,
          state.matchId!
        );
        return;
      }
      const predMatch = trimmed.match(/^(\d{1,2})-(\d{1,2})$/);
      if (!predMatch) {
        await sendTextMessage(
          from,
          "Ingresá solo números parce, sin letras ni símbolos. Escribí el marcador así: *2-1* _(local primero)_"
        );
        return;
      }
      const h = parseInt(predMatch[1], 10);
      const a = parseInt(predMatch[2], 10);
      if (h > 20 || a > 20) {
        await sendTextMessage(
          from,
          "Eso parece mucho parce 😅 ¿Estás seguro? Escribí el marcador de nuevo (ej: *2-1*)."
        );
        return;
      }
      await handlePredictionInput(
        from,
        user,
        state.pollaId,
        state.matchId!,
        h,
        a
      );
      return;
    }

    // Check for join link
    if (body.includes("/unirse/") || body.includes("/pollas/")) {
      const slugMatch = body.match(/\/(?:unirse|pollas)\/([a-z0-9-]+)/);
      if (slugMatch) {
        await handleJoinPolla(from, user, slugMatch[1]);
        return;
      }
    }

    // ── Join by code (TASK 3) ──
    // 1. Explicit: "unirse CODIGO"
    const unirseMatch = body.match(/^unirse\s+([a-z0-9]{6})$/);
    if (unirseMatch) {
      await handleJoinByCode(from, user.id, unirseMatch[1].toUpperCase());
      return;
    }

    // 2. Pending confirmation from a bare-code message. SI/NO text replies
    //    land here before the bare-6-char detection below so a user in the
    //    confirm flow does not get re-prompted.
    const joinState = await getState(from);
    if (joinState && joinState.action === "waiting_join_confirm" && joinState.joinCode) {
      if (body === "si" || body === "sí" || body === "yes") {
        const code = joinState.joinCode;
        await handleJoinByCode(from, user.id, code);
        return;
      }
      if (body === "no") {
        await clearState(from);
        await sendTextMessage(from, "Listo parce, no te uniste. Si querés probar con otro código, mándamelo de nuevo.");
        return;
      }
      // Any other text while in confirm state: fall through so the default
      // handler can nudge the user. Clearing state is not strictly needed
      // (10min TTL) but keeps the conversation crisp.
    }

    // 3. Bare 6-char code in the join alphabet → ask SI/NO. The lowercased
    //    alphabet mirrors JOIN_CODE_ALPHABET (no 0/o/i/1) so ordinary words
    //    rarely match. Remaining false positives get dismissed with "no".
    const bareCode = body.match(/^[abcdefghjklmnpqrstuvwxyz23456789]{6}$/);
    if (bareCode) {
      await handleJoinByCodeConfirm(from, body.toUpperCase());
      return;
    }

    // Help keywords
    if (["ayuda", "help"].includes(body)) {
      await handleHelp(from);
      return;
    }

    // Profile keywords
    if (["perfil", "profile"].includes(body)) {
      await handleProfile(from, user.id);
      return;
    }

    // Menu intent — broad match. We treat almost any conversational opener
    // as "show me the menu" because users don't always type the exact word.
    // The bubble in the app pre-fills "hola parce, muestrame el menu porfa"
    // for example; that should surface the menu, not the fallback.
    if (looksLikeMenuIntent(body)) {
      await handleMainMenu(from, user.display_name);
      return;
    }

    // Default: fallback message
    await sendTextMessage(
      from,
      "🤔 Parce, no entendí bien. Escribe *menu* para ver las opciones o *ayuda* si tenés dudas."
    );
    return;
  }

  // 5. Any other message type: fallback
  await sendTextMessage(
    from,
    "🤔 Parce, no entendí bien. Escribe *menu* para ver las opciones o *ayuda* si tenés dudas."
  );
}

// ─── Payload Router ───

async function routePayload(
  from: string,
  user: { id: string; display_name: string },
  payload: string
) {
  // Clear conversation state on new button press, except for flow-continuation
  // payloads that depend on the state (match selection, pagination, confirmations).
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
    payload.startsWith("rotate_confirm_") ||
    payload.startsWith("rotate_yes_") ||
    payload === "rotate_no";
  if (!keepState) {
    await clearState(from);
  }

  // Join-by-code SI/NO (set by handleJoinByCodeConfirm).
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

  // Rotate join code (admin only). Both steps re-verify role inside the
  // handler so a forged rotate_yes_<id> payload cannot skip the confirm.
  if (payload.startsWith("rotate_confirm_")) {
    const pollaId = payload.replace("rotate_confirm_", "");
    await handleRotateCodeConfirm(from, user.id, pollaId);
    return;
  }
  if (payload.startsWith("rotate_yes_")) {
    const pollaId = payload.replace("rotate_yes_", "");
    await handleRotateCode(from, user.id, pollaId);
    return;
  }
  if (payload === "rotate_no") {
    await clearState(from);
    await sendTextMessage(from, "Listo parce, no roté nada.");
    return;
  }

  if (payload === "menu") {
    await handleMainMenu(from, user.display_name);
    return;
  }

  // Main menu buttons (new IDs)
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

  // Predict group-mode toggle: "Por fase" / "Por fecha" buttons.
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

  // Predict group reset: user tapped "Cambiar agrupación" from the group
  // list to re-pick phase vs date. Payload format: "pgreset|{pollaId}".
  if (payload.startsWith("pgreset|")) {
    const parts = payload.split("|");
    if (parts.length >= 2) {
      const pollaId = parts[1];
      await handlePredictGroupReset(from, user.id, pollaId);
    }
    return;
  }

  // Predict group-list pagination: "Ver más fases/fechas" row.
  // Payload format: "pgmore|{pollaId}|{page}".
  if (payload.startsWith("pgmore|")) {
    const parts = payload.split("|");
    if (parts.length >= 3) {
      const pollaId = parts[1];
      const page = parseInt(parts[2], 10) || 0;
      await handlePredictGroupPage(from, user.id, pollaId, page);
    }
    return;
  }

  // Predict group selection: user tapped a row in the phase/date list.
  // Payload format: "pgsel|{pollaId}|{groupKey}".
  if (payload.startsWith("pgsel|")) {
    const parts = payload.split("|");
    if (parts.length >= 3) {
      const pollaId = parts[1];
      const groupKey = parts.slice(2).join("|");
      await handlePredictGroupSelect(from, user.id, pollaId, groupKey);
    }
    return;
  }

  // RULE 8 — pagination: "more_<pollaId>_<page>" advances the match list
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
      // Harmonize state shape with flows.ts:556 picker write. Batch 4a.
      // The previous setState here wrote waiting_prediction state without
      // matchIndex or totalMatches, producing a transient inconsistent
      // shape flagged in docs/batch-4-audit.md Section 9 question 7. The
      // call to handlePronosticar below immediately routes through
      // showPredictionPrompt, which writes the complete waiting_prediction
      // state with the counters filled in. In both downstream branches
      // (match found and match not found) the full-shape write happens
      // before any consumer reads, so removing the partial write here
      // eliminates the inconsistency without changing observable behavior.
      await handlePronosticar(from, user.id, state.pollaId, matchId);
    } else {
      // Batch 4b recovery: state was lost (Supabase read failure or expired). Guide user back instead of silent no-op.
      await sendTextMessage(
        from,
        "Ups parce, se me perdió el hilo. ¿Cuál polla querías pronosticar?"
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

  // Prediction confirmation
  if (payload === "confirm_yes") {
    const state = await getState(from);
    if (state && state.action === "confirm_prediction" && state.pollaId) {
      await handleConfirmPrediction(from, user, { ...state, pollaId: state.pollaId });
    } else {
      // Batch 4b recovery: state was lost (Supabase read failure or expired). Guide user back instead of silent no-op.
      await sendTextMessage(
        from,
        "Parce, perdí tu pronóstico. Dale de nuevo a Pronosticar para volver a mandarlo."
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
      // Batch 4b recovery: state was lost (Supabase read failure or expired). Guide user back instead of silent no-op.
      await sendTextMessage(
        from,
        "Ups, se me olvidó que ibas a cambiar. Dale a Pronosticar de nuevo."
      );
      await handleMisPollas(from, user.id);
    }
    return;
  }

  // Help menu
  if (payload === "menu_ayuda") {
    await handleHelp(from);
    return;
  }

  if (payload.startsWith("help_")) {
    await handleHelpTopic(from, user, payload);
    return;
  }

  // Profile
  if (payload === "menu_perfil" || payload === "help_perfil") {
    await handleProfile(from, user.id);
    return;
  }

  // Fallback
  await handleMainMenu(from, user.display_name);
}
