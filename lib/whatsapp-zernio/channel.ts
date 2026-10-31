import type { SupabaseClient } from "@supabase/supabase-js";
import type { PickForm, PlayerChannel, PlayerChat, Screen } from "@/lib/telegram-player/context";
import { createWhatsAppChannel } from "@/lib/whatsapp-player/channel";
import { adaptScreen, menuForScreen, renderZernioMenu, type ZernioContent, type ZernioMenu } from "./format";
import { pickFlowContent } from "./pick-flow";

export interface ZernioTurn { replies: ZernioContent[]; menu: ZernioMenu | null }

export function createZernioChannel(db: SupabaseClient, phone: string, chat: PlayerChat, turn: ZernioTurn, now: () => number,
  flow: { id?: string | null; draft?: boolean } = {}): PlayerChannel {
  const base = createWhatsAppChannel({ db, phone, chat, turn: { replies: [], menu: undefined }, now });
  const push = async (screen: Screen) => {
    const { menu, links } = menuForScreen(adaptScreen(screen, chat.flow?.name), chat.flow?.name);
    turn.menu = menu;
    turn.replies.push(...renderZernioMenu(menu), ...links);
  };
  return {
    ...base, show: push, sendScreen: push,
    // The form message carries no menu; the short follow-up keeps the per-match
    // path for clients that cannot open forms (for example WhatsApp Web).
    ...(flow.id ? { pickForm: async (form: PickForm) => {
      turn.replies.push(pickFlowContent(flow.id!, form, { draft: flow.draft }));
      await push({ text: "¿No se abre? Pronostica partido por partido.", buttons: [[{ text: "Uno por uno", callback_data: form.fallback }]] });
      return true;
    } } : {}),
    // sendWelcome calls sendHome next; omit Telegram's separate verbose welcome.
    sendWithMenu: async () => {},
    download: async (fileId, maxBytes) => {
      if (!/^wa:[0-9a-f-]{36}$/i.test(fileId)) return null;
      const { data, error } = await db.from("whatsapp_bot_media").select("data_b64")
        .eq("id", fileId.slice(3)).eq("phone", phone).gte("created_at", new Date(now() - 2 * 3_600_000).toISOString()).maybeSingle();
      if (error || !data) return null;
      const bytes = Buffer.from(data.data_b64, "base64");
      return bytes.length > maxBytes ? "too_large" : bytes;
    },
    saveFlow: async flow => {
      const { error } = await db.from("whatsapp_bot_chats").update(flow
        ? { flow: flow.name, flow_data: flow.data, flow_at: flow.at, updated_at: new Date(now()).toISOString() }
        : { flow: null, flow_data: null, flow_at: null, updated_at: new Date(now()).toISOString() }).eq("phone", phone);
      if (error) throw new Error("Bot flow unavailable");
    },
  };
}
