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
  "/resolver &lt;slug&gt; — resuelve las preguntas y reparte el pozo",
  "/numero &lt;slug&gt; &lt;n&gt; — cierra una rifa con el número que salió",
  "/respuesta &lt;slug&gt; &lt;id&gt; &lt;texto&gt; — responde una pregunta libre",
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
          "Mándame el código de acceso para entrar.",
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
        "Demasiados intentos. Espera 15 minutos y vuelve a probar.",
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
      "Listo, este chat quedó desvinculado. Manda el código otra vez si quieres volver.",
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

  if (/^\/numero\b/i.test(text)) {
    const [slug, n] = text
      .replace(/^\/numero\s*/i, "")
      .trim()
      .split(/\s+/);
    await setDrawnNumber(chatId, slug ?? "", Number(n));
    return;
  }

  // /respuesta <slug> <pregunta12> <la respuesta que sea>
  // Para las preguntas de texto libre, donde no hay botones que ofrecer.
  if (/^\/respuesta\b/i.test(text)) {
    const resto = text.replace(/^\/respuesta\s*/i, "").trim();
    const [, qPrefix, ...palabras] = resto.split(/\s+/);
    await resolveFreeText(chatId, qPrefix ?? "", palabras.join(" "));
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

  const parts = (cb.data ?? "").split(":");
  const action = parts[0];

  // Resolver una pregunta manual: q:<pregunta12>:<opcion12>
  // Se mandan solo los primeros 12 hex de cada uuid porque callback_data topa
  // en 64 bytes y dos uuid completos no caben. 48 bits alcanzan de sobra para
  // no chocar a esta escala.
  if (action === "q") {
    await resolveQuestion(chatId, cb.id, parts[1] ?? "", parts[2] ?? "");
    return;
  }

  const entryId = parts[1];
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
    await sendMessage(chatId, "Dime cuál: <code>/cerrar nombre-de-la-polla</code>");
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
    await sendMessage(chatId, "Dime cuál: <code>/resolver nombre-de-la-polla</code>");
    return;
  }
  const db = createAdminClient();
  const { data: polla } = await db
    .from("casa_pollas")
    .select("id, name, kind, drawn_number")
    .eq("slug", slug)
    .maybeSingle();

  if (!polla) {
    await sendMessage(chatId, `No encontré <code>${esc(slug)}</code>.`);
    return;
  }

  // Rifa sin número todavía: no hay nada que repartir.
  if (polla.kind === "rifa" && polla.drawn_number == null) {
    await sendMessage(
      chatId,
      `Esa rifa todavía no tiene número ganador.
Mandame <code>/numero ${esc(slug)} 47</code> con el que salió.`,
    );
    return;
  }

  // Polla manual: primero hay que decir cuál fue la respuesta de cada pregunta.
  if (polla.kind === "manual") {
    const { data: pendientes } = await db
      .from("casa_questions")
      .select("id, prompt, input_kind, order_index")
      .eq("polla_id", polla.id)
      .is("resolved_at", null)
      .order("order_index", { ascending: true });

    if (pendientes && pendientes.length > 0) {
      await sendMessage(
        chatId,
        `<b>${esc(polla.name)}</b>
Faltan ${pendientes.length} pregunta(s) por resolver. Dime cuál fue la respuesta:`,
      );

      for (const q of pendientes as QuestionRow[]) {
        if (q.input_kind === "texto") {
          await sendMessage(
            chatId,
            `<b>${esc(q.prompt)}</b>
Esta es de respuesta libre. Mándame:
<code>/respuesta ${esc(slug)} ${q.id.slice(0, 12)} tu respuesta</code>`,
          );
          continue;
        }

        const { data: ops } = await db
          .from("casa_options")
          .select("id, label")
          .eq("question_id", q.id)
          .order("order_index", { ascending: true });

        const botones: InlineButton[][] = (ops ?? []).map(
          (o: { id: string; label: string }) => [
            {
              text: o.label.slice(0, 60),
              callback_data: `q:${q.id.slice(0, 12)}:${o.id.slice(0, 12)}`,
            },
          ],
        );

        await sendMessage(chatId, `<b>${esc(q.prompt)}</b>`, botones);
      }

      await sendMessage(
        chatId,
        `Cuando estén todas, manda <code>/resolver ${esc(slug)}</code> otra vez y reparto el pozo.`,
      );
      return;
    }
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
      "Los pagos los haces tú por fuera; acá queda el registro de a quién y cuánto.",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

/**
 * Busca una pregunta SIN RESOLVER por el prefijo de su uuid.
 *
 * Por qué no un `.like("id", "abc%")`: `casa_questions.id` es uuid y PostgREST
 * no compara uuid contra un patrón de texto — la query no falla, devuelve
 * vacío, que es la peor forma de fallar. Como las preguntas pendientes son
 * siempre un puñado, se traen todas y se matchea el prefijo acá.
 */
async function findQuestionByPrefix(prefix: string) {
  if (prefix.length < 8) return null;
  const db = createAdminClient();
  const { data } = await db
    .from("casa_questions")
    .select("id, polla_id, prompt, resolved_at")
    .is("resolved_at", null)
    .limit(500);
  return (
    (data ?? []).find((q: { id: string }) => q.id.startsWith(prefix)) ?? null
  );
}

/** Tap en "esta opción fue la que ganó". */
async function resolveQuestion(
  chatId: number,
  callbackId: string,
  qPrefix: string,
  oPrefix: string,
) {
  if (qPrefix.length < 8 || oPrefix.length < 8) {
    await answerCallback(callbackId, "Dato incompleto.");
    return;
  }

  const db = createAdminClient();
  const q = await findQuestionByPrefix(qPrefix);

  if (!q) {
    await answerCallback(callbackId, "No encontré esa pregunta (o ya se resolvió).");
    return;
  }

  const { data: ops } = await db
    .from("casa_options")
    .select("id, label")
    .eq("question_id", q.id);

  const op = (ops ?? []).find((o: { id: string }) => o.id.startsWith(oPrefix));

  if (!op) {
    await answerCallback(callbackId, "No encontré esa opción.");
    return;
  }

  await db
    .from("casa_questions")
    .update({ resolved_option_id: op.id, resolved_at: new Date().toISOString() })
    .eq("id", q.id)
    .is("resolved_at", null); // guard anti doble-tap

  // Repuntuar al toque: la tabla queda al día sin esperar el reparto.
  await db.rpc("casa_score_polla", { p_polla_id: q.polla_id });

  await answerCallback(callbackId, `Listo: ${op.label}`);
  await sendMessage(
    chatId,
    `✅ <b>${esc(q.prompt)}</b>
Respuesta: <b>${esc(op.label)}</b>`,
  );
}

/**
 * /respuesta <slug> <pregunta12> <texto> — resuelve una pregunta de respuesta
 * libre. El match contra lo que puso la gente lo hace SQL, insensible a
 * mayúsculas y espacios, así que "morelos" y "Morelos " valen igual.
 */
async function resolveFreeText(chatId: number, qPrefix: string, respuesta: string) {
  if (qPrefix.length < 8 || !respuesta.trim()) {
    await sendMessage(
      chatId,
      "Se usa así: <code>/respuesta mi-polla a1b2c3d4e5f6 Morelos</code>",
    );
    return;
  }

  const db = createAdminClient();
  const q = await findQuestionByPrefix(qPrefix);

  if (!q) {
    await sendMessage(chatId, "No encontré esa pregunta (o ya se resolvió).");
    return;
  }

  await db
    .from("casa_questions")
    .update({
      resolved_text: respuesta.trim(),
      resolved_at: new Date().toISOString(),
    })
    .eq("id", q.id)
    .is("resolved_at", null);

  await db.rpc("casa_score_polla", { p_polla_id: q.polla_id });

  await sendMessage(
    chatId,
    `✅ <b>${esc(q.prompt)}</b>\nRespuesta: <b>${esc(respuesta.trim())}</b>`,
  );
}

/** /numero <slug> <n> — cierra una rifa con el número que salió. */
async function setDrawnNumber(chatId: number, slug: string, n: number) {
  if (!slug || !Number.isFinite(n)) {
    await sendMessage(chatId, "Se usa así: <code>/numero mi-rifa 47</code>");
    return;
  }

  const db = createAdminClient();
  const { data: polla } = await db
    .from("casa_pollas")
    .select("id, name, kind, ticket_count")
    .eq("slug", slug)
    .maybeSingle();

  if (!polla || polla.kind !== "rifa") {
    await sendMessage(chatId, `<code>${esc(slug)}</code> no es una rifa.`);
    return;
  }
  if (polla.ticket_count != null && (n < 1 || n > polla.ticket_count)) {
    await sendMessage(chatId, `Esa rifa va del 1 al ${polla.ticket_count}.`);
    return;
  }

  await db.from("casa_pollas").update({ drawn_number: n }).eq("id", polla.id);
  await sendMessage(
    chatId,
    `🎟 Número ganador de <b>${esc(polla.name)}</b>: <b>${n}</b>.
Manda <code>/resolver ${esc(slug)}</code> para repartir.`,
  );
}

interface QuestionRow {
  id: string;
  prompt: string;
  input_kind: string;
  order_index: number;
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
