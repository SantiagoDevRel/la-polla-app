// lib/whatsapp/bot.ts — Lógica principal del bot de WhatsApp para procesar mensajes entrantes
import axios from "axios";
import { generateOTP } from "@/lib/utils/otp";
import { getWelcomeMessage, getOTPMessage, getErrorMessage } from "./messages";

const WA_API_URL = `https://graph.facebook.com/v18.0/${process.env.META_WA_PHONE_NUMBER_ID}/messages`;

interface WhatsAppMessage {
  from: string;
  type: string;
  text?: { body: string };
}

export async function sendWhatsAppMessage(to: string, text: string) {
  console.log("[WA] Enviando a:", to);
  console.log("[WA] Phone ID:", process.env.META_WA_PHONE_NUMBER_ID);
  console.log("[WA] Token existe:", !!process.env.META_WA_ACCESS_TOKEN);
  console.log("[WA] URL:", WA_API_URL);

  try {
    const response = await axios.post(
      WA_API_URL,
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.META_WA_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log("[WA] Respuesta Meta:", JSON.stringify(response.data));
    return response;
  } catch (error: unknown) {
    const axiosErr = error as { response?: { data?: unknown; status?: number } };
    console.error("[WA] Error status:", axiosErr.response?.status);
    console.error("[WA] Error Meta:", JSON.stringify(axiosErr.response?.data));
    throw error;
  }
}

export async function processIncomingMessage(message: WhatsAppMessage) {
  const { from, text } = message;
  const body = text?.body?.trim().toLowerCase() || "";

  if (body === "hola" || body === "inicio") {
    await sendWhatsAppMessage(from, getWelcomeMessage());
    return;
  }

  if (body === "codigo" || body === "código") {
    const otp = await generateOTP(from);
    await sendWhatsAppMessage(from, getOTPMessage(otp));
    return;
  }

  await sendWhatsAppMessage(from, getErrorMessage());
}
