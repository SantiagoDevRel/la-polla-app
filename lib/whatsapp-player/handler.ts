// lib/whatsapp-player/handler.ts — Bot de jugadores por WhatsApp (OpenWA).
//
// Mismas pantallas y reglas que el bot de Telegram (lib/telegram-player): este
// archivo solo resuelve QUIÉN escribe y traduce la respuesta («1», «B», «2-1»,
// una foto) al botón o texto equivalente.
//
// Seguridad:
//   - La identidad es el número que WhatsApp verificó (remitente @c.us, o el
//     senderPhone que OpenWA resuelve para @lid). Llega en un evento firmado
//     por el relay (signature.ts). Nada del texto elige la cuenta.
//   - Número sin cuenta → se crea en el chat (resolveAccountForVerifiedPhone,
//     igual que SMS y Telegram) y se pide nombre y pollito.
//   - Las opciones guardadas son DATO: cada callback vuelve a validarse contra
//     la base en lib/telegram-player (polla visible, partido de esa polla…).
//   - Cada id de mensaje se procesa una sola vez; máximo 20 mensajes por
//     minuto por número.

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveAccountForVerifiedPhone } from "@/lib/auth/phone-session";
import type { LoginBotClient } from "@/lib/auth/telegram-login/bot-api";
import type { TelegramLoginConfig } from "@/lib/auth/telegram-login/config";
import { redactId } from "@/lib/log";
import { COPY, menuCommandOf } from "@/lib/telegram-player/copy";
import { sendWelcome, type PlayerCtx } from "@/lib/telegram-player/context";
import { routePlayerCallback, routePlayerMessage } from "@/lib/telegram-player/handler";
import { ensureProfile, readProfile } from "@/lib/telegram-player/profile";
import type { PlayerPhoto } from "@/lib/telegram-player/update";
import { phoneAllowed, type WhatsAppBotConfig } from "./config";
import { chatStateFromRow, createWhatsAppChannel, MEDIA_FILE_PREFIX, plainReply, WHATSAPP_COPY, type WhatsAppChatRow, type WhatsAppTurn } from "./channel";
import { matchMenu } from "./format";
import { classifyOpenWaEvent } from "./inbound";
import { parseOpenWaMenu, POLL_PAGE_PREFIX, renderOpenWaMenu, type OpenWaPoll } from "./poll-menu";
import { claimPollVote } from "./poll-votes";

export const RATE_LIMIT_PER_MINUTE = 20;

export interface WebLink {
  kind: "magic" | "plain" | "limited";
  url: string;
}

export interface WhatsAppBotDeps {
  db: SupabaseClient;
  config: WhatsAppBotConfig;
  /** Enlace para entrar a la web (web-link.ts en producción). */
  webLink: (phone: string) => Promise<WebLink>;
  env?: Record<string, string | undefined>;
  now?: () => number;
  resolveAccount?: typeof resolveAccountForVerifiedPhone;
}

export interface WhatsAppReply {
  /** Chat de WhatsApp («57300…@c.us» o «…@lid»). */
  to: string;
  text: string;
  poll?: OpenWaPoll;
}

export type WhatsAppOutcome = "ignored" | "duplicate" | "limited" | "unverified" | "handled" | "failed";

// El ctx del bot de jugadores trae campos de Telegram; con canal WhatsApp no
// se leen (context.ts delega todo en ctx.channel).
const NO_TELEGRAM_CONFIG = {} as TelegramLoginConfig;
const NO_TELEGRAM_BOT: LoginBotClient = {
  send: async () => false,
  call: async () => ({ ok: false, description: "whatsapp" }),
  download: async () => null,
};

const CHAT_COLUMNS = "phone, user_id, flow, flow_data, flow_at, menu";

export async function handleWhatsAppEvent(
  payload: unknown,
  deps: WhatsAppBotDeps,
): Promise<{ outcome: WhatsAppOutcome; replies: WhatsAppReply[] }> {
  const now = deps.now ?? Date.now;
  const isVote = typeof payload === "object" && payload !== null && "event" in payload && payload.event === "poll.vote";
  const vote = isVote ? await claimPollVote(payload, deps.db, deps.config, now()) : null;
  if (isVote && !vote) return { outcome: "ignored", replies: [] };
  const event = vote
    ? { kind: "message" as const, messageId: vote.messageId, phone: vote.phone, replyTo: vote.chatId, text: null, media: null, otherMedia: false }
    : classifyOpenWaEvent(payload, now());
  if (event.kind === "ignore") return { outcome: "ignored", replies: [] };
  if (event.kind === "unverified") {
    return { outcome: "unverified", replies: [{ to: event.replyTo, text: WHATSAPP_COPY.unverified }] };
  }
  if (!phoneAllowed(deps.config, event.phone)) return { outcome: "ignored", replies: [] };
  const { db } = deps;

  // Una sola vez por mensaje: OpenWA reintenta si no recibe 2xx a tiempo.
  const { error: dedupeError } = await db.from("whatsapp_bot_inbound").insert({ message_id: event.messageId, phone: event.phone });
  if (dedupeError) {
    if (dedupeError.code === "23505") return { outcome: "duplicate", replies: [] };
    throw new Error(`inbound no registrado: ${dedupeError.code}`);
  }
  const since = new Date(now() - 60_000).toISOString();
  const { count } = await db.from("whatsapp_bot_inbound").select("message_id", { count: "exact", head: true })
    .eq("phone", event.phone).gte("received_at", since);
  if ((count ?? 0) > RATE_LIMIT_PER_MINUTE) {
    await db.from("whatsapp_bot_inbound").update({ status: "limited" }).eq("message_id", event.messageId);
    return { outcome: "limited", replies: [] };
  }

  const turn: WhatsAppTurn = { replies: [], menu: undefined };
  const reply = (text: string) => turn.replies.push(text);
  let outcome: WhatsAppOutcome = "handled";
  try {
    const { data: row, error: rowError } = await db.from("whatsapp_bot_chats").select(CHAT_COLUMNS).eq("phone", event.phone).maybeSingle();
    if (rowError) throw new Error(`chat no leído: ${rowError.code}`);
    const state = chatStateFromRow((row as WhatsAppChatRow | null) ?? null, now());
    // Also fence a text turn that might have advanced after the SQL vote claim.
    if (vote && (!state.userId || parseOpenWaMenu(state.menu)?.nonce !== vote.nonce)) {
      await db.from("whatsapp_bot_inbound").update({ status: "done" }).eq("message_id", event.messageId);
      return { outcome: "ignored", replies: [] };
    }

    let userId = state.userId;
    if (!userId) {
      const account = await (deps.resolveAccount ?? resolveAccountForVerifiedPhone)(`+${event.phone}`, "whatsapp-bot", db);
      if (!account.ok) throw new Error(`cuenta no resuelta: ${account.stage}`);
      userId = account.authUserId;
      const at = new Date(now()).toISOString();
      const { error: upsertError } = await db.from("whatsapp_bot_chats").upsert(
        { phone: event.phone, user_id: userId, updated_at: at },
        { onConflict: "phone" },
      );
      if (upsertError) throw new Error(`chat no guardado: ${upsertError.code}`);
      // Igual que SMS y Telegram: public.users guarda el teléfono sin «+». Mejor
      // esfuerzo (la columna es única).
      const { error: phoneError } = await db.from("users")
        .update({ whatsapp_number: event.phone, whatsapp_verified: true }).eq("id", userId);
      if (phoneError) console.warn("[whatsapp-player] teléfono no sincronizado:", phoneError.code);
    }

    const ctx: PlayerCtx = {
      config: NO_TELEGRAM_CONFIG,
      db,
      bot: NO_TELEGRAM_BOT,
      env: deps.env ?? process.env,
      now,
      chatId: 0,
      telegramUserId: 0,
      account: { userId, phoneE164: `+${event.phone}` },
      chat: state.chat,
      editMessageId: null,
    };
    ctx.channel = createWhatsAppChannel({ db, phone: event.phone, chat: ctx.chat, turn, now });
    if (state.expiredFlow) await ctx.channel.saveFlow(null);

    const routes = {
      webLink: async () => {
        const link = await deps.webLink(event.phone);
        reply(link.kind === "magic" ? WHATSAPP_COPY.webMagic(link.url) : link.kind === "limited" ? WHATSAPP_COPY.webLimited(link.url) : WHATSAPP_COPY.webPlain(link.url));
      },
    };
    const dispatch = async (data: string) => {
      if (data.startsWith(POLL_PAGE_PREFIX)) {
        const menu = parseOpenWaMenu(state.menu);
        const page = data.slice(POLL_PAGE_PREFIX.length);
        if (!menu || !/^\d{1,4}$/.test(page)) return;
        const rendered = renderOpenWaMenu({ ...menu, page: Number(page) });
        turn.replies.push(rendered.text);
        (turn.polls ??= new Map()).set(rendered.text, rendered.poll);
        turn.menu = rendered.menu;
      } else await routePlayerCallback(ctx, data, routes);
    };

    if (vote) {
      await dispatch(vote.callback);
    } else if (event.media?.kind === "too_large") {
      reply(WHATSAPP_COPY.mediaTooLarge);
    } else if (event.media?.kind === "inline") {
      const { data: staged, error: mediaError } = await db.from("whatsapp_bot_media")
        .insert({ phone: event.phone, mimetype: event.media.mimetype, data_b64: event.media.base64 })
        .select("id").single();
      if (mediaError || !staged) throw new Error(`foto no guardada: ${mediaError?.code}`);
      const fileId = `${MEDIA_FILE_PREFIX}${(staged as { id: string }).id}`;
      const photo: PlayerPhoto = { fileId, fileUniqueId: fileId, size: event.media.bytes, source: event.media.source, mime: event.media.mimetype };
      await routePlayerMessage(ctx, { text: null, photo, otherMedia: false }, routes);
    } else if (event.otherMedia) {
      await routePlayerMessage(ctx, { text: null, photo: null, otherMedia: true }, routes);
    } else if (event.text) {
      const text = event.text;
      const flow = ctx.chat.flow?.name;
      const textFlow = flow === "name" || flow === "answer" || flow === "ticket" || flow === "score" || flow === "pay_name" || flow === "pay_account";
      // En un paso de texto solo valen las letras de ese paso: «15» es una
      // boleta, no la opción 15 de un aviso que llegó mientras tanto.
      const picked = textFlow && state.menu?.mode !== "abc" ? null : matchMenu(state.menu, text, { labels: !textFlow });
      if (!state.existed) {
        // Primer mensaje de este número: presentación y, si falta, nombre y
        // pollito. Con el perfil completo (cuenta de la web), la bienvenida.
        const profile = await readProfile(ctx);
        if (!(await ensureProfile(ctx, profile))) turn.replies.unshift(plainReply(COPY.intro));
        else if (menuCommandOf(text)) await routePlayerMessage(ctx, { text, photo: null, otherMedia: false }, routes);
        else await sendWelcome(ctx, profile?.display_name ?? null);
      } else if (picked) {
        await dispatch(picked);
      } else {
        await routePlayerMessage(ctx, { text, photo: null, otherMedia: false }, routes);
      }
    }

    if (turn.menu !== undefined) {
      const { error: menuError } = await db.from("whatsapp_bot_chats")
        .update({ menu: turn.menu, updated_at: new Date(now()).toISOString() }).eq("phone", event.phone);
      if (menuError) throw new Error(`menu not saved: ${menuError.code}`);
    }
  } catch (err) {
    outcome = "failed";
    console.error("[whatsapp-player] mensaje falló:", redactId(event.phone), (err as Error).name);
    turn.polls?.clear();
    turn.replies.push(WHATSAPP_COPY.failure);
  }
  await db.from("whatsapp_bot_inbound").update({ status: outcome === "failed" ? "failed" : "done" }).eq("message_id", event.messageId);
  return { outcome, replies: turn.replies.filter(Boolean).map((text) => ({ to: event.replyTo, text,
    ...(turn.polls?.get(text) ? { poll: turn.polls.get(text) } : {}),
  })) };
}
