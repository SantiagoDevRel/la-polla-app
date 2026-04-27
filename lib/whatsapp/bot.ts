// lib/whatsapp/bot.ts — WhatsApp send helpers (Meta Cloud API).
// Used por:
//   • app/api/pollas/[slug]/invite — invitaciones por WA
//   • lib/notifications.ts          — notificaciones a users (results, etc.)
//   • app/api/whatsapp/send         — endpoint genérico
//
// El flow inbound (procesar mensajes que llegan al bot) fue eliminado
// junto con el login por WhatsApp OTP. Lo único que queda es la salida.
import axios from "axios";
import { createAdminClient } from "@/lib/supabase/admin";

// Resolve config at call time, not module-load. Si faltan envs el build
// no se cae; los sends loud-fail solo cuando se intentan.
function getWhatsAppConfig(): { token: string; url: string } {
  const token = process.env.META_WA_ACCESS_TOKEN;
  const phoneNumberId = process.env.META_WA_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    throw new Error(
      "[whatsapp] Missing required env: META_WA_ACCESS_TOKEN and/or " +
      "META_WA_PHONE_NUMBER_ID. Refusing to send — sends would 404 " +
      "at runtime otherwise.",
    );
  }
  return {
    token,
    url: `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
  };
}

interface ButtonAction {
  type: "reply";
  reply: { id: string; title: string };
}

// ─── Public API ───

export async function sendTextMessage(to: string, text: string) {
  const response = await callMetaAPI({
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
  buttons: { id: string; title: string }[],
) {
  const buttonActions: ButtonAction[] = buttons.slice(0, 3).map((b) => ({
    type: "reply",
    reply: { id: b.id, title: b.title.slice(0, 20) },
  }));

  const response = await callMetaAPI({
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
  items: { id: string; title: string; description?: string }[],
) {
  const rows = items.slice(0, 10).map((item) => ({
    id: item.id,
    title: item.title.slice(0, 24),
    description: item.description?.slice(0, 72) || "",
  }));

  const response = await callMetaAPI({
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

// Alias retro-compat — ex-OTP flow lo usaba con este nombre.
export async function sendWhatsAppMessage(to: string, text: string) {
  return sendTextMessage(to, text);
}

// ─── Internal ───

async function callMetaAPI(payload: Record<string, unknown>) {
  const { token, url } = getWhatsAppConfig();
  try {
    return await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
  } catch (error: unknown) {
    const axiosErr = error as {
      response?: { data?: unknown; status?: number };
    };
    console.error("[WA] Error status:", axiosErr.response?.status);
    console.error("[WA] Error Meta:", JSON.stringify(axiosErr.response?.data));
    throw error;
  }
}

async function logMessage(
  phone: string,
  direction: "inbound" | "outbound",
  messageType: string,
  content: string,
) {
  try {
    const supabase = createAdminClient();
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
