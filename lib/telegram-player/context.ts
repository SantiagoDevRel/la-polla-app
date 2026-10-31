// lib/telegram-player/context.ts — Contexto de un update del bot de jugadores,
// estado de la conversación y helpers para mostrar pantallas.
//
// Una "pantalla" es un texto HTML + botones. Si la persona tocó un botón, la
// pantalla nueva REEMPLAZA ese mensaje (editMessageText): el chat no se llena de
// menús viejos. Si escribió o mandó una foto, llega como mensaje nuevo.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { LoginBotClient } from "@/lib/auth/telegram-login/bot-api";
import type { TelegramLoginConfig } from "@/lib/auth/telegram-login/config";
import { COPY, homeButtons, MAIN_KEYBOARD } from "./copy";

export interface Button {
  text: string;
  callback_data?: string;
  url?: string;
  /** Optional native list presentation; other transports keep the regular text. */
  listRow?: { title: string; description: string };
}
export type Keyboard = Button[][];

export interface Screen {
  text: string;
  /** Optional concise copy for the official WhatsApp transport; same source data. */
  compactText?: string;
  buttons?: Keyboard;
}

export const FLOW_NAMES = ["name", "proof", "photo_pick", "ticket", "score", "answer", "pay_name", "pay_account"] as const;
export type FlowName = (typeof FLOW_NAMES)[number];
export type FlowData = Record<string, string | number | boolean | null>;
export interface Flow {
  name: FlowName;
  data: FlowData;
  at: number;
}

/** Cuánto espera el bot una respuesta. Pagar y volver con el pantallazo tarda. */
export const FLOW_TTL_MS: Record<FlowName, number> = {
  name: 2 * 3_600_000,
  proof: 12 * 3_600_000,
  photo_pick: 3_600_000,
  ticket: 2 * 3_600_000,
  score: 2 * 3_600_000,
  answer: 2 * 3_600_000,
  pay_name: 3_600_000,
  pay_account: 3_600_000,
};

export interface PlayerChat {
  locale: "es" | "en";
  flow: Flow | null;
  /** La fila todavía tiene un paso guardado (vigente o vencido). */
  stored?: boolean;
}

export interface PlayerAccount {
  userId: string;
  phoneE164: string;
}

/**
 * Otro canal para las mismas pantallas (WhatsApp por OpenWA, lib/whatsapp-
 * player). Sin canal, todo sale por el bot de Telegram como siempre.
 */
export interface PlayerChannel {
  kind: "whatsapp";
  show(screen: Screen): Promise<void>;
  sendScreen(screen: Screen): Promise<void>;
  /** Mensaje con el menú principal (en WhatsApp no hay teclado fijo). */
  sendWithMenu(text: string): Promise<void>;
  /** Guarda o borra (null) el paso de texto en curso. */
  saveFlow(flow: { name: FlowName; data: FlowData; at: string } | null): Promise<void>;
  download(fileId: string, maxBytes: number): Promise<Buffer | "too_large" | null>;
  /** Optional one-screen 1X2 form (WhatsApp Flows). false = not available, use the per-match flow. */
  pickForm?(form: PickForm): Promise<boolean>;
}

/** Open matches for a one-screen 1X2 form, already filtered by the shared rules. */
export interface PickForm {
  pollaId: string;
  pollaName: string;
  /** All open matches; a transport may show only its first slots. */
  total: number;
  matches: { id: string; home: string; away: string; when: string; current: string | null }[];
  /** Per-match fallback (callback data) for clients that cannot open forms. */
  fallback: string;
}

export interface PlayerCtx {
  config: TelegramLoginConfig;
  db: SupabaseClient;
  bot: LoginBotClient;
  env: Record<string, string | undefined>;
  now: () => number;
  chatId: number;
  telegramUserId: number;
  account: PlayerAccount;
  chat: PlayerChat;
  /** Mensaje del botón tocado; null si la persona escribió. */
  editMessageId: number | null;
  channel?: PlayerChannel;
}

/** Compact WhatsApp copy: one fact per line and a blank line between blocks. */
export function blocks(...groups: Array<Array<string | null | undefined | false>>): string {
  return groups.map((g) => g.filter(Boolean).join("\n")).filter(Boolean).join("\n\n");
}

export function esc(s: string | null | undefined): string {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Texto plano para un botón: sin saltos y con largo acotado. */
export function buttonText(s: string, max = 48): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export async function readPlayerChat(db: SupabaseClient, telegramUserId: number, now: number): Promise<PlayerChat> {
  const { data, error } = await db
    .from("telegram_login_chats")
    .select("locale, bot_flow, bot_flow_data, bot_flow_at")
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();
  if (error || !data) return { locale: "es", flow: null };
  const locale = data.locale === "en" ? "en" : "es";
  const stored = data.bot_flow != null || data.bot_flow_data != null;
  const name = (FLOW_NAMES as readonly string[]).includes(String(data.bot_flow)) ? (data.bot_flow as FlowName) : null;
  const at = data.bot_flow_at ? Date.parse(String(data.bot_flow_at)) : NaN;
  const payload = data.bot_flow_data;
  if (!name || !Number.isFinite(at) || now - at > FLOW_TTL_MS[name] || typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    if (stored) {
      // Paso vencido o inválido: se borra ya, para que datos a medio escribir
      // (p. ej. el titular de una cuenta) no queden guardados.
      const { error: clearError } = await db
        .from("telegram_login_chats")
        .update({ bot_flow: null, bot_flow_data: null, bot_flow_at: null })
        .eq("telegram_user_id", telegramUserId);
      if (clearError) console.warn("[telegram-player] no se limpió un paso vencido:", clearError.code);
    }
    return { locale, flow: null, stored: false };
  }
  return { locale, flow: { name, data: payload as FlowData, at }, stored: true };
}

export async function setFlow(ctx: PlayerCtx, name: FlowName, data: FlowData): Promise<void> {
  const at = new Date(ctx.now()).toISOString();
  if (ctx.channel) {
    await ctx.channel.saveFlow({ name, data, at });
  } else {
    const { error } = await ctx.db.from("telegram_login_chats").upsert(
      { telegram_user_id: ctx.telegramUserId, locale: ctx.chat.locale, bot_flow: name, bot_flow_data: data, bot_flow_at: at, updated_at: at },
      { onConflict: "telegram_user_id" },
    );
    if (error) console.warn("[telegram-player] no se guardó el paso:", error.code);
  }
  ctx.chat.flow = { name, data, at: ctx.now() };
  ctx.chat.stored = true;
}

export async function clearFlow(ctx: PlayerCtx): Promise<void> {
  if (!ctx.chat.flow && !ctx.chat.stored) return;
  ctx.chat.stored = false;
  if (ctx.channel) {
    await ctx.channel.saveFlow(null);
  } else {
    const { error } = await ctx.db
      .from("telegram_login_chats")
      .update({ bot_flow: null, bot_flow_data: null, bot_flow_at: null, updated_at: new Date(ctx.now()).toISOString() })
      .eq("telegram_user_id", ctx.telegramUserId);
    if (error) console.warn("[telegram-player] no se limpió el paso:", error.code);
  }
  ctx.chat.flow = null;
}

function messageBody(ctx: PlayerCtx, screen: Screen): Record<string, unknown> {
  return {
    chat_id: ctx.chatId,
    text: screen.text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(screen.buttons ? { reply_markup: { inline_keyboard: screen.buttons } } : {}),
  };
}

/** Muestra una pantalla: reemplaza el mensaje del botón tocado o manda uno nuevo. */
export async function show(ctx: PlayerCtx, screen: Screen): Promise<void> {
  if (ctx.channel) return ctx.channel.show(screen);
  if (ctx.editMessageId) {
    const edited = await ctx.bot.call("editMessageText", {
      ...messageBody(ctx, screen),
      message_id: ctx.editMessageId,
      reply_markup: { inline_keyboard: screen.buttons ?? [] },
    });
    if (edited.ok || edited.description?.includes("message is not modified")) return;
  }
  await ctx.bot.send("sendMessage", messageBody(ctx, screen));
}

/** Siempre un mensaje nuevo (respuestas a texto o foto, avisos). */
export async function sendScreen(ctx: PlayerCtx, screen: Screen): Promise<number | null> {
  if (ctx.channel) {
    await ctx.channel.sendScreen(screen);
    return null;
  }
  const sent = await ctx.bot.call<{ message_id?: number }>("sendMessage", messageBody(ctx, screen));
  return sent.ok && typeof sent.result.message_id === "number" ? sent.result.message_id : null;
}

/** «Subiendo foto…» mientras se procesa el comprobante (solo Telegram). */
export async function showUploading(ctx: PlayerCtx): Promise<void> {
  if (ctx.channel) return;
  await ctx.bot.send("sendChatAction", { chat_id: ctx.chatId, action: "upload_photo" });
}

/** Bytes de una imagen recibida: archivo de Telegram o foto guardada por el canal. */
export function downloadMedia(ctx: PlayerCtx, fileId: string, maxBytes: number): Promise<Buffer | "too_large" | null> {
  return ctx.channel ? ctx.channel.download(fileId, maxBytes) : ctx.bot.download(fileId, maxBytes);
}

/** Mensaje con el menú fijo de abajo (el teclado de siempre). */
export async function sendWithMenu(ctx: PlayerCtx, text: string): Promise<void> {
  if (ctx.channel) return ctx.channel.sendWithMenu(text);
  await ctx.bot.send("sendMessage", {
    chat_id: ctx.chatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: MAIN_KEYBOARD,
  });
}

/** Mensaje nuevo con las opciones principales como botones dentro del mensaje. */
export async function sendHome(ctx: PlayerCtx, text: string = COPY.home): Promise<void> {
  await sendScreen(ctx, { text, buttons: homeButtons() });
}

/**
 * Bienvenida (al terminar el perfil y con /start): deja el menú fijo abajo y,
 * como en el computador ese menú queda escondido, repite las opciones como
 * botones en un segundo mensaje (un mensaje admite un solo tipo de teclado).
 */
export async function sendWelcome(ctx: PlayerCtx, name: string | null): Promise<void> {
  await sendWithMenu(ctx, COPY.welcome(esc(name)));
  await sendHome(ctx);
}

export async function answerCallback(ctx: Pick<PlayerCtx, "bot">, callbackId: string, text?: string): Promise<void> {
  await ctx.bot.send("answerCallbackQuery", {
    callback_query_id: callbackId,
    ...(text ? { text: text.slice(0, 190) } : {}),
  });
}
