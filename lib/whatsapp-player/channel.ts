// lib/whatsapp-player/channel.ts — Canal WhatsApp para las pantallas del bot de
// jugadores (lib/telegram-player). Cada pantalla se convierte a texto con
// opciones (format.ts) y se acumula como respuesta del turno: el relay del DGX
// las envía en orden por OpenWA. El paso de texto en curso y el menú viven en
// whatsapp_bot_chats; las fotos, en whatsapp_bot_media.

import type { SupabaseClient } from "@supabase/supabase-js";
import { FLOW_NAMES, FLOW_TTL_MS, type FlowData, type FlowName, type PlayerChannel, type PlayerChat, type Screen } from "@/lib/telegram-player/context";
import { COPY } from "@/lib/telegram-player/copy";
import { menuModeFor, parseMenu, renderScreen, toWhatsAppText, type WhatsAppMenu } from "./format";

export const MEDIA_FILE_PREFIX = "wa:";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface WhatsAppChatRow {
  phone: string;
  user_id: string | null;
  flow: string | null;
  flow_data: unknown;
  flow_at: string | null;
  menu: unknown;
}

export interface WhatsAppChatState {
  /** La fila ya existía (no es el primer mensaje de este número). */
  existed: boolean;
  userId: string | null;
  chat: PlayerChat;
  menu: WhatsAppMenu | null;
  /** Había un paso guardado pero venció o es inválido: hay que borrarlo ya. */
  expiredFlow: boolean;
}

/** Fila del chat → paso vigente y menú (mismas reglas que readPlayerChat). */
export function chatStateFromRow(row: WhatsAppChatRow | null, now: number): WhatsAppChatState {
  if (!row) return { existed: false, userId: null, chat: { locale: "es", flow: null, stored: false }, menu: null, expiredFlow: false };
  const stored = row.flow != null || row.flow_data != null;
  const name = (FLOW_NAMES as readonly string[]).includes(String(row.flow)) ? (row.flow as FlowName) : null;
  const at = row.flow_at ? Date.parse(row.flow_at) : NaN;
  const data = row.flow_data;
  const valid = Boolean(name) && Number.isFinite(at) && now - at <= FLOW_TTL_MS[name as FlowName]
    && typeof data === "object" && data !== null && !Array.isArray(data);
  return {
    existed: true,
    userId: row.user_id,
    chat: valid
      ? { locale: "es", flow: { name: name as FlowName, data: data as FlowData, at }, stored: true }
      : { locale: "es", flow: null, stored: false },
    menu: parseMenu(row.menu),
    expiredFlow: stored && !valid,
  };
}

export interface WhatsAppTurn {
  replies: string[];
  /** Menú de la última pantalla con opciones de este turno (undefined = sin cambios). */
  menu: WhatsAppMenu | undefined;
}

export function createWhatsAppChannel(opts: {
  db: SupabaseClient;
  phone: string;
  chat: PlayerChat;
  turn: WhatsAppTurn;
  now: () => number;
}): PlayerChannel {
  const { db, phone, chat, turn } = opts;
  const push = (screen: Screen) => {
    const rendered = renderScreen(screen, menuModeFor(chat.flow?.name));
    if (rendered.text) turn.replies.push(rendered.text);
    if (rendered.menu) turn.menu = rendered.menu;
  };
  return {
    kind: "whatsapp",
    show: async (screen) => push(screen),
    sendScreen: async (screen) => push(screen),
    // En WhatsApp no hay teclado fijo: la bienvenida es solo texto y las
    // opciones llegan enseguida con sendHome.
    sendWithMenu: async (text) => {
      turn.replies.push(toWhatsAppText(text).trim());
    },
    saveFlow: async (flow) => {
      const at = new Date(opts.now()).toISOString();
      const { error } = await db.from("whatsapp_bot_chats").update(
        flow
          ? { flow: flow.name, flow_data: flow.data, flow_at: flow.at, updated_at: at }
          : { flow: null, flow_data: null, flow_at: null, updated_at: at },
      ).eq("phone", phone);
      if (error) console.warn("[whatsapp-player] no se guardó el paso:", error.code);
    },
    download: async (fileId, maxBytes) => {
      const id = fileId.startsWith(MEDIA_FILE_PREFIX) ? fileId.slice(MEDIA_FILE_PREFIX.length) : "";
      if (!UUID_RE.test(id)) return null;
      // Filtrada por número: una foto de otra persona nunca se lee aquí.
      const { data, error } = await db.from("whatsapp_bot_media").select("data_b64").eq("id", id).eq("phone", phone).maybeSingle();
      if (error || !data) return null;
      const bytes = Buffer.from(String((data as { data_b64: string }).data_b64), "base64");
      return bytes.length > maxBytes ? "too_large" : bytes;
    },
  };
}

/** Texto plano del bot (sin opciones), con la marca de WhatsApp. */
export function plainReply(html: string): string {
  return toWhatsAppText(html).trim();
}

export const WHATSAPP_COPY = {
  unverified: "No pudimos ver tu número de celular en este chat. Escríbenos desde WhatsApp con el número de tu cuenta, o entra a https://lapollacolombiana.com.",
  mediaTooLarge: "Esa imagen pesa más de 3 MB. Envíala como foto (no como documento) para que WhatsApp la comprima.",
  failure: COPY.failure,
  webMagic: (url: string) => `Abre este enlace para entrar a La Polla en el navegador. Es personal y vence en 10 minutos: no lo compartas.\n\n${url}`,
  webPlain: (url: string) => `Entra a ${url} con tu número de celular.`,
  webLimited: (url: string) => `Ya pediste cinco enlaces en la última hora. Usa el más reciente o entra con tu número de celular en ${url}.`,
} as const;
