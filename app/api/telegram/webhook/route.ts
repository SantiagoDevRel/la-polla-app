// app/api/telegram/webhook/route.ts — el panel de admin de Tama, en Telegram.
//
// Seguridad, en orden:
//   1. Telegram firma cada request con el header X-Telegram-Bot-Api-Secret-Token,
//      que fijamos al registrar el webhook. Sin ese header, 401 y no se lee nada.
//   2. Ningun comando responde hasta que el chat este VINCULADO. Vincularse pide
//      el codigo de admin, con rate limit de 5 intentos / 15 min por chat.
//   3. La autorizacion posterior es el chat_id, no el codigo: el codigo viaja
//      una sola vez en la vida del chat.
//
// El contenido de los mensajes es DATO, nunca instruccion: no se evalua nada
// que venga de Telegram, solo se compara contra comandos conocidos.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  answerCallback,
  editCaption,
  esc,
  sendMessage,
  type InlineButton,
} from "@/lib/telegram/bot";
import {
  isLinkedAdmin,
  touchAdmin,
  tryLink,
  unlink,
} from "@/lib/telegram/admin";
import { formatCop, timeLeft } from "@/lib/casa/format";
import { getPot, listAllPollas, listPendingProofs } from "@/lib/casa/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const AYUDA = [
  "<b>Panel de La Polla</b>",
  "",
  "/pendientes — pagos esperando que los revises",
  "/pollas — las pollas y como va el pozo de cada una",
  "/cerrar &lt;slug&gt; — cierra las inscripciones de una polla",
  "/resolver &lt;slug&gt; — calcula puntos y reparte el pozo",
  "/salir — desvincula este chat del panel",
].join("\n");

export async function POST(req: NextRequest) {
  // ── 1. Firma del webhook ────────────────────────────────────────────────
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const given = req.headers.get("x-telegram-bot-api-secret-token");
  if (!secret || given !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: true }); // basura: la tiramos en silencio
  }

  try {
    if (update.callback_query) {
      await handleCallback(update.callback_query);
    } else if (update.message) {
      await handleMessage(update.message);
    }
  } catch (err) {
    // Nunca devolvemos != 200: Telegram reintenta en loop si fallamos.
    console.error("[telegram] update fallido:", (err as Error).message);
  }

  return NextResponse.json({ ok: true });
}

/* ═════════════════════════ mensajes de texto ═════════════════════════ */

async function handleMessage(msg: TelegramMessage) {
  const chatId = msg.chat.id;
  const text = (msg.text ?? "").trim();
  if (!text) return;

  const linked = await isLinkedAdmin(chatId);

  // ── Sin vincular: lo unico que se acepta es /start y el codigo ──────────
  if (!linked) {
    if (/^\/start\b/i.test(text)) {
      await sendMessage(
        chatId,
        [
          "<b>Panel de La Polla Colombiana</b>",
          "",
          "Este bot es solo para el admin.",
          "Mandame el código de acceso para entrar.",
        ].join("\n"),
      );
      return;
    }

    const result = await tryLink(chatId, text, {
      username: msg.from?.username,
      firstName: msg.from?.first_name,
    });

    if (result === "bloqueado") {
      await sendMessage(
        chatId,
        "Demasiados intentos. Esperá 15 minutos y volvé a probar.",
      );
      return;
    }
    if (result === "codigo_malo") {
      // Respuesta deliberadamente pobre: no confirma si el bot existe ni
      // cuantos intentos quedan.
      await sendMessage(chatId, "Código incorrecto.");
      return;
    }

    await sendMessage(
      chatId,
      [
        `Listo ${esc(msg.from?.first_name ?? "")} 👊 quedaste conectado al panel.`,
        "",
        AYUDA,
      ].join("\n"),
    );
    return;
  }

  // ── Vinculado: comandos ────────────────────────────────────────────────
  await touchAdmin(chatId);

  if (/^\/(start|ayuda|help)\b/i.test(text)) {
    await sendMessage(chatId, AYUDA);
    return;
  }

  if (/^\/salir\b/i.test(text)) {
    await unlink(chatId);
    await sendMessage(
      chatId,
      "Listo, este chat quedó desvinculado. Mandá el código otra vez si querés volver.",
    );
    return;
  }

  if (/^\/pendientes\b/i.test(text)) {
    await sendPending(chatId);
    return;
  }

  if (/^\/pollas\b/i.test(text)) {
    await sendPollas(chatId);
    return;
  }

  if (/^\/cerrar\b/i.test(text)) {
    await closePolla(chatId, text.replace(/^\/cerrar\s*/i, "").trim());
    return;
  }

  if (/^\/resolver\b/i.test(text)) {
    await settlePolla(chatId, text.replace(/^\/resolver\s*/i, "").trim());
    return;
  }

  await sendMessage(chatId, `No entendí eso.\n\n${AYUDA}`);
}

/* ═════════════════════════ botones (callbacks) ═══════════════════════ */

async function handleCallback(cb: TelegramCallbackQuery) {
  const chatId = cb.message?.chat.id;
  if (!chatId) return;

  if (!(await isLinkedAdmin(chatId))) {
    await answerCallback(cb.id, "Este chat no está autorizado.");
    return;
  }

  const [action, entryId] = (cb.data ?? "").split(":");
  if (!entryId || (action !== "ok" && action !== "no")) {
    await answerCallback(cb.id);
    return;
  }

  const db = createAdminClient();
  const { data: entry } = await db
    .from("casa_entries")
    .select("id, polla_id, user_id, status, amount_cop, ticket_number")
    .eq("id", entryId)
    .maybeSingle();

  if (!entry) {
    await answerCallback(cb.id, "Esa inscripción ya no existe.");
    return;
  }

  // Idempotencia: si otro admin ya decidio, no se pisa.
  if (entry.status !== "pendiente") {
    await answerCallback(cb.id, `Ya estaba ${entry.status}.`);
    if (cb.message?.message_id) {
      await editCaption(
        chatId,
        cb.message.message_id,
        `Esta ya estaba <b>${entry.status}</b>.`,
      );
    }
    return;
  }

  const aprobado = action === "ok";

  await db
    .from("casa_entries")
    .update({
      status: aprobado ? "pagada" : "rechazada",
      reviewed_at: new Date().toISOString(),
      reject_reason: aprobado ? null : "Rechazado desde el panel de Telegram",
    })
    .eq("id", entryId)
    .eq("status", "pendiente"); // guard anti doble-tap

  const [{ data: polla }, pot] = await Promise.all([
    db
      .from("casa_pollas")
      .select("name, slug")
      .eq("id", entry.polla_id)
      .maybeSingle(),
    getPot(entry.polla_id),
  ]);

  const { data: user } = await db
    .from("users")
    .select("display_name")
    .eq("id", entry.user_id)
    .maybeSingle();

  await answerCallback(cb.id, aprobado ? "Aprobado ✅" : "Rechazado ❌");

  if (cb.message?.message_id) {
    await editCaption(
      chatId,
      cb.message.message_id,
      [
        aprobado ? "✅ <b>APROBADO</b>" : "❌ <b>RECHAZADO</b>",
        "",
        `${esc(user?.display_name ?? "Alguien")} · ${esc(polla?.name ?? "")}`,
        `Valor: ${formatCop(entry.amount_cop)}`,
        aprobado ? `Pozo ahora: <b>${formatCop(pot.prize_cop)}</b>` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
}

/* ═════════════════════════ comandos ══════════════════════════════════ */

async function sendPending(chatId: number) {
  const pending = await listPendingProofs(10);
  if (pending.length === 0) {
    await sendMessage(chatId, "No hay pagos esperando. Todo al día 👊");
    return;
  }

  const db = createAdminClient();
  for (const entry of pending) {
    const [{ data: user }, { data: polla }] = await Promise.all([
      db
        .from("users")
        .select("display_name")
        .eq("id", entry.user_id)
        .maybeSingle(),
      db
        .from("casa_pollas")
        .select("name")
        .eq("id", entry.polla_id)
        .maybeSingle(),
    ]);

    const buttons: InlineButton[][] = [
      [
        { text: "✅ Aprobar", callback_data: `ok:${entry.id}` },
        { text: "❌ Rechazar", callback_data: `no:${entry.id}` },
      ],
    ];

    await sendMessage(
      chatId,
      [
        `<b>${esc(user?.display_name ?? "Sin nombre")}</b>`,
        `Polla: ${esc(polla?.name ?? "?")}`,
        entry.ticket_number != null ? `Boleta: #${entry.ticket_number}` : null,
        `Valor: <b>${formatCop(entry.amount_cop)}</b>`,
      ]
        .filter(Boolean)
        .join("\n"),
      buttons,
    );
  }
}

async function sendPollas(chatId: number) {
  const pollas = await listAllPollas();
  const vivas = pollas.filter(
    (p) => p.status === "abierta" || p.status === "cerrada",
  );

  if (vivas.length === 0) {
    await sendMessage(chatId, "No hay pollas abiertas ahora mismo.");
    return;
  }

  const bloques = await Promise.all(
    vivas.slice(0, 10).map(async (p) => {
      const pot = await getPot(p.id);
      return [
        `<b>${esc(p.name)}</b>  <code>${esc(p.slug)}</code>`,
        `${p.status === "abierta" ? `cierra en ${timeLeft(p.closes_at)}` : "cerrada"} · ${pot.paid_entries} jugando`,
        `Pozo: <b>${formatCop(pot.prize_cop)}</b> · casa: ${formatCop(pot.house_cop)}`,
      ].join("\n");
    }),
  );

  await sendMessage(chatId, bloques.join("\n\n"));
}

async function closePolla(chatId: number, slug: string) {
  if (!slug) {
    await sendMessage(chatId, "Decime cuál: <code>/cerrar nombre-de-la-polla</code>");
    return;
  }
  const db = createAdminClient();
  const { data, error } = await db
    .from("casa_pollas")
    .update({ status: "cerrada" })
    .eq("slug", slug)
    .eq("status", "abierta")
    .select("name")
    .maybeSingle();

  if (error || !data) {
    await sendMessage(chatId, `No pude cerrar <code>${esc(slug)}</code>. ¿Existe y está abierta?`);
    return;
  }
  await sendMessage(chatId, `🔒 <b>${esc(data.name)}</b> quedó cerrada. Ya nadie más entra ni cambia pronósticos.`);
}

async function settlePolla(chatId: number, slug: string) {
  if (!slug) {
    await sendMessage(chatId, "Decime cuál: <code>/resolver nombre-de-la-polla</code>");
    return;
  }
  const db = createAdminClient();
  const { data: polla } = await db
    .from("casa_pollas")
    .select("id, name")
    .eq("slug", slug)
    .maybeSingle();

  if (!polla) {
    await sendMessage(chatId, `No encontré <code>${esc(slug)}</code>.`);
    return;
  }

  const { data, error } = await db.rpc("casa_settle_polla", {
    p_polla_id: polla.id,
  });

  if (error) {
    await sendMessage(chatId, `No pude resolverla: ${esc(error.message)}`);
    return;
  }

  const r = data as {
    prize_cop: number;
    winners: number;
    each_cop: number;
    top_points: number;
  };

  await sendMessage(
    chatId,
    [
      `🏁 <b>${esc(polla.name)}</b> resuelta.`,
      "",
      `Pozo repartido: <b>${formatCop(r.prize_cop)}</b>`,
      `Ganadores: <b>${r.winners}</b>${r.winners > 1 ? " (empataron)" : ""}`,
      `A cada uno: <b>${formatCop(r.each_cop)}</b>`,
      r.top_points != null ? `Puntaje ganador: ${r.top_points}` : "",
      "",
      "Los pagos los hacés vos por fuera; acá queda el registro de a quién y cuánto.",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

/* ═════════════════════════ tipos del update ══════════════════════════ */

interface TelegramUpdate {
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}
interface TelegramMessage {
  chat: { id: number };
  text?: string;
  from?: { username?: string; first_name?: string };
}
interface TelegramCallbackQuery {
  id: string;
  data?: string;
  message?: { message_id: number; chat: { id: number } };
}
