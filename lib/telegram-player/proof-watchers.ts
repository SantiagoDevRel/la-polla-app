// lib/telegram-player/proof-watchers.ts — Aviso de SOLO LECTURA a los
// administradores elegidos cuando llega un comprobante de pago.
//
// El bot de admin (@LaPollaColombianaAdminBot) manda la foto con Aprobar /
// Rechazar, pero exige vincular el chat con un código. Para quien solo necesita
// enterarse y revisar desde la web, el aviso sale por el bot público
// (@LaPollaColombianaBot), donde el administrador ya inició sesión: un texto y
// un botón que abre la cola de recibos. Sin foto, sin teléfono del jugador y
// sin botones que decidan nada.
//
// Destinatarios: CASA_PROOF_WATCHER_USER_IDS (uuids de users separados por
// coma). Además cada uno tiene que seguir siendo admin (users.is_admin) y tener
// su Telegram vinculado (telegram_login_identities). Quitar el rol apaga el
// aviso sin tocar la variable. Mejor esfuerzo: nunca rompe el comprobante.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createLoginBotClient, type LoginBotClient } from "@/lib/auth/telegram-login/bot-api";
import { getTelegramLoginConfig } from "@/lib/auth/telegram-login/config";
import { formatCop } from "@/lib/casa/format";
import { esc } from "./context";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_WATCHERS = 10;

export interface ProofWatcherNotice {
  pollaName: string;
  userName: string;
  amountCop: number;
  ticketNumber: number | null;
  entryNumber: number | null;
  /** Mensaje de prueba: se marca con (TEST) y no describe un pago real. */
  test?: boolean;
}

export function proofWatcherUserIds(env: Record<string, string | undefined> = process.env): string[] {
  const ids = (env.CASA_PROOF_WATCHER_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => UUID_RE.test(s));
  return [...new Set(ids)].slice(0, MAX_WATCHERS);
}

function recibosUrl(env: Record<string, string | undefined>): string {
  const base = (env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "") || "https://lapollacolombiana.com";
  return `${base}/admin/pollas/recibos`;
}

export function proofWatcherMessage(
  n: ProofWatcherNotice,
  env: Record<string, string | undefined> = process.env,
): { text: string; reply_markup: { inline_keyboard: Array<Array<{ text: string; url: string }>> } } {
  const detalle = n.ticketNumber != null ? ` · boleta ${n.ticketNumber}`
    : n.entryNumber != null && n.entryNumber > 1 ? ` · cupo ${n.entryNumber}` : "";
  const text = [
    `${n.test ? "<b>(TEST)</b> " : ""}🧾 <b>Llegó un comprobante de pago</b>`,
    "",
    `Jugador: <b>${esc(n.userName)}</b>`,
    `Polla: <b>${esc(n.pollaName)}</b>${detalle}`,
    `Valor: <b>${formatCop(n.amountCop)}</b>`,
    "",
    n.test
      ? "Este es un mensaje de prueba: no hay ningún pago nuevo. Así te llegarán los avisos."
      : "Entra a la app para revisarlo y confirmarlo.",
  ].join("\n");
  return { text, reply_markup: { inline_keyboard: [[{ text: "Revisar comprobantes", url: recibosUrl(env) }]] } };
}

/** Envía el aviso a cada destinatario válido. Devuelve cuántos mensajes salieron. */
export async function notifyProofWatchers(
  db: SupabaseClient,
  notice: ProofWatcherNotice,
  options: {
    env?: Record<string, string | undefined>;
    client?: LoginBotClient;
    /** Solo la prueba: suma una copia para el admin que la pide. */
    extraUserIds?: string[];
  } = {},
): Promise<number> {
  const env = options.env ?? process.env;
  const extra = (options.extraUserIds ?? []).map((s) => s.toLowerCase()).filter((s) => UUID_RE.test(s));
  const userIds = [...new Set([...proofWatcherUserIds(env), ...extra])];
  if (userIds.length === 0) return 0;
  const config = getTelegramLoginConfig(env);
  if (!config) return 0;
  try {
    const [{ data: admins, error: adminsError }, { data: links, error: linksError }] = await Promise.all([
      db.from("users").select("id").in("id", userIds).eq("is_admin", true),
      db.from("telegram_login_identities").select("user_id, telegram_user_id").in("user_id", userIds),
    ]);
    if (adminsError || linksError) return 0;
    const adminIds = new Set(((admins ?? []) as Array<{ id: string }>).map((r) => r.id));
    const chats = ((links ?? []) as Array<{ user_id: string; telegram_user_id: unknown }>)
      .filter((r) => adminIds.has(r.user_id))
      .map((r) => Number(r.telegram_user_id))
      .filter((id) => Number.isSafeInteger(id) && id > 0);
    if (chats.length === 0) return 0;
    const bot = options.client ?? createLoginBotClient(config.botToken, env);
    const message = proofWatcherMessage(notice, env);
    const sent = await Promise.all(chats.map((chat_id) => bot.send("sendMessage", {
      chat_id,
      text: message.text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: message.reply_markup,
    })));
    return sent.filter(Boolean).length;
  } catch (err) {
    console.warn("[telegram-player] aviso de comprobante a administradores no enviado:", (err as Error).name);
    return 0;
  }
}
