// lib/whatsapp/bot.ts — WhatsApp bot: message sending, routing, and processing
// Extends existing OTP flow with conversational bot capabilities
import axios from "axios";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateOTP } from "@/lib/utils/otp";
import { findPendingOTP, markOTPSent } from "@/lib/utils/otp";
import { getOTPMessage } from "./messages";
import { sendCTAButton } from "./interactive";
import { getState, setState, clearState } from "./state";
import {
  handleMainMenu,
  handleUnknownUser,
  handleMisPollas,
  handlePollaMenu,
  handlePronosticar,
  handlePredictionInput,
  handleLeaderboard,
  handleResults,
  handleJoinPolla,
  handleHelp,
  handleProfile,
  handleHelpTopic,
  handleConfirmPrediction,
  handleCancelPrediction,
} from "./flows";

// Validate required env vars on module load
if (!process.env.META_WA_PHONE_NUMBER_ID) {
  console.error("[WA] META_WA_PHONE_NUMBER_ID is not set — bot will not send messages.");
}
if (!process.env.META_WA_ACCESS_TOKEN) {
  console.error("[WA] META_WA_ACCESS_TOKEN is not set — bot will not send messages.");
}

const WA_API_URL = `https://graph.facebook.com/v21.0/${process.env.META_WA_PHONE_NUMBER_ID}/messages`;

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
        Authorization: `Bearer ${process.env.META_WA_ACCESS_TOKEN}`,
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

  // Log raw phone number for debugging (Colombian numbers start with 57)
  console.log(`[WA] Incoming from: ${from} | type: ${type}`);

  // Log inbound message
  const inboundContent =
    text?.body ||
    interactive?.button_reply?.title ||
    interactive?.list_reply?.title ||
    "[unknown]";
  await logMessage(from, "inbound", type, inboundContent);

  // 0. Check for pending OTP BEFORE normal routing
  // This allows new users (not yet in DB) to receive their OTP
  try {
    const pendingOTP = await findPendingOTP(from);
    if (pendingOTP) {
      console.log(`[WA] Found pending OTP for ${from}, delivering...`);
      const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://la-polla.vercel.app";
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
    const state = getState(from);
    if (state && state.action === "waiting_prediction") {
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

    // Menu keywords
    if (["hola", "hi", "inicio", "menu", "menú"].includes(body)) {
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
    payload === "confirm_yes" ||
    payload === "confirm_no";
  if (!keepState) {
    clearState(from);
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
    const state = getState(from);
    if (state && state.pollaId) {
      const matchId = payload.replace("match_", "");
      setState(from, {
        action: "waiting_prediction",
        pollaId: state.pollaId,
        matchId,
      });
      await handlePronosticar(from, user.id, state.pollaId, matchId);
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
    const state = getState(from);
    if (state && state.action === "confirm_prediction") {
      await handleConfirmPrediction(from, user, state);
    }
    return;
  }

  if (payload === "confirm_no") {
    const state = getState(from);
    if (state && state.pollaId) {
      await handlePronosticar(from, user.id, state.pollaId);
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
