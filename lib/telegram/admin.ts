// lib/telegram/admin.ts — quien puede usar el panel del bot.
//
// Modelo de acceso: el bot no le sirve a nadie hasta que alguien manda el
// codigo de admin. Ese codigo vincula SU chat_id, y de ahi en adelante la
// autorizacion es el chat_id (no el codigo), asi que el codigo viaja una sola
// vez. Se puede desvincular con /salir.

import { createAdminClient } from "@/lib/supabase/admin";
import { timingSafeEqual } from "node:crypto";

/** Intentos de codigo permitidos por chat, y en cuanto tiempo. */
const MAX_ATTEMPTS = 5;
const WINDOW_MIN = 15;

export interface TelegramAdmin {
  chat_id: number;
  username: string | null;
  first_name: string | null;
  active: boolean;
}

/** Comparacion en tiempo constante: no filtra el largo del prefijo acertado. */
function codeMatches(given: string): boolean {
  const expected = process.env.TELEGRAM_ADMIN_CODE;
  if (!expected) return false;
  const a = Buffer.from(given.trim());
  const b = Buffer.from(expected.trim());
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function isLinkedAdmin(chatId: number): Promise<boolean> {
  const db = createAdminClient();
  const { data } = await db
    .from("telegram_admins")
    .select("chat_id, active")
    .eq("chat_id", chatId)
    .maybeSingle();
  return data?.active === true;
}

/** Todos los chats que deben recibir las notificaciones de pago. */
export async function listActiveAdminChats(): Promise<number[]> {
  const db = createAdminClient();
  const { data } = await db
    .from("telegram_admins")
    .select("chat_id")
    .eq("active", true);
  return (data ?? []).map((r: { chat_id: number }) => Number(r.chat_id));
}

/**
 * Intenta vincular un chat con el codigo. Devuelve por que fallo, para poder
 * responder distinto a "codigo malo" y a "estas bloqueado un rato".
 */
export async function tryLink(
  chatId: number,
  code: string,
  meta: { username?: string; firstName?: string },
): Promise<"ok" | "codigo_malo" | "bloqueado"> {
  const db = createAdminClient();
  const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();

  const { count } = await db
    .from("telegram_auth_attempts")
    .select("chat_id", { count: "exact", head: true })
    .eq("chat_id", chatId)
    .gte("attempted_at", since);

  if ((count ?? 0) >= MAX_ATTEMPTS) return "bloqueado";

  await db.from("telegram_auth_attempts").insert({ chat_id: chatId });

  if (!codeMatches(code)) return "codigo_malo";

  await db.from("telegram_admins").upsert(
    {
      chat_id: chatId,
      username: meta.username ?? null,
      first_name: meta.firstName ?? null,
      active: true,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "chat_id" },
  );

  return "ok";
}

/** /salir — desactiva el chat. No borra la fila: queda el rastro de que existio. */
export async function unlink(chatId: number): Promise<void> {
  const db = createAdminClient();
  await db
    .from("telegram_admins")
    .update({ active: false })
    .eq("chat_id", chatId);
}

export async function touchAdmin(chatId: number): Promise<void> {
  const db = createAdminClient();
  await db
    .from("telegram_admins")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("chat_id", chatId);
}
