import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveAccountForVerifiedPhone } from "@/lib/auth/phone-session";
import type { TelegramLoginConfig } from "@/lib/auth/telegram-login/config";
import type { LoginBotClient } from "@/lib/auth/telegram-login/bot-api";
import { chatStateFromRow, type WhatsAppChatRow } from "@/lib/whatsapp-player/channel";
import { routePlayerCallback, routePlayerMessage } from "@/lib/telegram-player/handler";
import { ensureProfile } from "@/lib/telegram-player/profile";
import { clearFlow, type PlayerCtx } from "@/lib/telegram-player/context";
import { normalizeCommandText } from "@/lib/telegram-player/update";
import { createZernioChannel, type ZernioTurn } from "./channel";
import { HOME, MORE, matchZernioOption, menuForScreen, parseZernioMenu, renderZernioMenu, type ZernioContent } from "./format";
import { downloadZernioProof } from "./media";
import { deliverTurn } from "./delivery";
import type { ZernioInbound } from "./inbound";
import type { ZernioBotConfig } from "./config";
import type { sendZernioContent } from "./send";

const NO_BOT: LoginBotClient = { send: async () => false, call: async () => ({ ok: false, description: "whatsapp" }), download: async () => null };
export interface ZernioDeps {
  db: SupabaseClient; config: ZernioBotConfig;
  login: (capture: (conversationId: string, key: string, content: Record<string, unknown>) => Promise<void>) => Promise<string>;
  now?: () => number; resolveAccount?: typeof resolveAccountForVerifiedPhone;
  download?: typeof downloadZernioProof; send?: typeof sendZernioContent;
}

async function buildTurn(event: ZernioInbound, deps: ZernioDeps): Promise<ZernioTurn> {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const turn: ZernioTurn = { replies: [], menu: null };
  const webLink = async () => {
    const result = await deps.login(async (_conversation, _key, content) => { turn.replies.push(content as ZernioContent); });
    if (result === "ignored") turn.replies.push({ message: "Entra con tu número en https://lapollacolombiana.com/login." });
    const back = menuForScreen({ text: "Puedes seguir jugando aquí.", buttons: [[{ text: "Menú", callback_data: "m" }]] });
    turn.menu = back.menu;
    turn.replies.push(...renderZernioMenu(back.menu));
  };
  try {
    if (normalizeCommandText(event.text ?? "") === "dame el link para entrar a la polla") {
      await webLink();
      return turn;
    }
    const { data: row, error } = await db.from("whatsapp_bot_chats").select("phone, user_id, flow, flow_data, flow_at, menu").eq("phone", event.phone).maybeSingle();
    if (error) throw new Error("Bot chat unavailable");
    const state = chatStateFromRow(row as WhatsAppChatRow | null, now());
    let menu = parseZernioMenu(row?.menu);
    // Notice buttons and earlier screens retain opaque mappings without replacing an active text flow.
    if (event.selection && !event.selection.startsWith(`${menu?.nonce}:`)) {
      const nonce = event.selection.split(":")[0];
      if (/^[a-f0-9]{16}$/.test(nonce)) {
        const previous = await db.from("whatsapp_zernio_deliveries").select("menu").eq("phone", event.phone)
          .eq("menu->>nonce", nonce).eq("status", "sent").gte("created_at", new Date(now() - 24 * 3_600_000).toISOString()).limit(1).maybeSingle();
        if (!previous.error) menu = parseZernioMenu(previous.data?.menu);
      }
    }
    let userId = state.userId;
    if (!userId) {
      const resolved = await (deps.resolveAccount ?? resolveAccountForVerifiedPhone)(`+${event.phone}`, "whatsapp-bot", db);
      if (!resolved.ok) throw new Error("Bot account unavailable");
      userId = resolved.authUserId;
      const linked = await db.from("whatsapp_bot_chats").update({ user_id: userId }).eq("phone", event.phone);
      if (linked.error) throw new Error("Bot identity unavailable");
      const phoneWrite = await db.from("users").update({ whatsapp_number: event.phone, whatsapp_verified: true }).eq("id", userId);
      if (phoneWrite.error) throw new Error("Bot phone unavailable");
    }
    const ctx: PlayerCtx = {
      config: {} as TelegramLoginConfig, db, bot: NO_BOT, env: process.env, now,
      chatId: 0, telegramUserId: 0, account: { userId, phoneE164: `+${event.phone}` }, chat: state.chat, editMessageId: null,
    };
    ctx.channel = createZernioChannel(db, event.phone, ctx.chat, turn, now);
    if (state.expiredFlow) await ctx.channel.saveFlow(null);
    const textFlow = ["name", "ticket", "score", "answer", "pay_name", "pay_account"].includes(ctx.chat.flow?.name ?? "");
    const picked = matchZernioOption(menu, event.selection ?? event.text ?? "", Boolean(event.selection), textFlow);
    if (picked?.startsWith("zpage:")) {
      if (menu) {
        menu = { ...menu, page: Number(picked.slice(6)) };
        turn.menu = menu;
        turn.replies.push(...renderZernioMenu(menu));
      }
    } else if (picked === "zmore") {
      if (await ensureProfile(ctx)) {
        if (ctx.chat.flow?.name !== "proof") await clearFlow(ctx);
        await ctx.channel.show(MORE);
      }
    } else if (picked === "zretry") {
      await ctx.channel.show({ text: "Envía la imagen del comprobante (JPG, PNG o WEBP, máximo 3 MB). No repitas la transferencia." });
    } else if (picked) {
      await routePlayerCallback(ctx, picked, { webLink });
    } else if (event.selection) {
      await ctx.channel.show({ text: "Esa opción ya cambió. Vuelve al menú." });
    } else if (event.attachment) {
      const downloaded = await (deps.download ?? downloadZernioProof)(event.attachment, deps.config);
      if (!downloaded.ok) {
        await ctx.channel.show({ text: downloaded.reason === "too_large" ? "Supera 3 MB. Envía el comprobante como foto para reducir su tamaño."
          : downloaded.reason === "unsupported" ? "Envía el comprobante como imagen JPG, PNG o WEBP. Si está en PDF, envía una captura de pantalla."
          : "No pudimos descargar el comprobante. Envía la imagen de nuevo.",
          buttons: [[{ text: "Reintentar", callback_data: "zretry" }]] });
      } else {
        const staged = await db.from("whatsapp_bot_media").insert({ phone: event.phone, mimetype: downloaded.mime, data_b64: downloaded.bytes.toString("base64") }).select("id").single();
        if (staged.error || !staged.data) throw new Error("Bot media unavailable");
        const fileId = `wa:${staged.data.id}`;
        await routePlayerMessage(ctx, { text: null, photo: { fileId, fileUniqueId: fileId, size: downloaded.bytes.length, source: "document", mime: downloaded.mime }, otherMedia: false }, { webLink });
      }
    } else {
      const text = event.text ?? "hola";
      // These explicit navigation words remain available during name/free-answer steps.
      const navigation = ["menu", "hola"].includes(normalizeCommandText(text));
      await routePlayerMessage(ctx, { text: navigation ? "/menu" : text, photo: null, otherMedia: false }, { webLink });
    }
    if (!turn.replies.length) await ctx.channel.show(HOME);
  } catch {
    // Never log provider payloads, URLs, account ids, names or proof contents.
    turn.replies = [];
    turn.menu = null;
    const fallback = menuForScreen({ text: "No pudimos completar la solicitud. Vuelve al menú e inténtalo de nuevo.", buttons: HOME.buttons });
    turn.menu = fallback.menu;
    turn.replies.push(...renderZernioMenu(fallback.menu));
  }
  return turn;
}

export function handleZernioPlayerEvent(event: ZernioInbound, deps: ZernioDeps) {
  return deliverTurn(deps.db, deps.config, event, () => buildTurn(event, deps), { now: deps.now, send: deps.send });
}
