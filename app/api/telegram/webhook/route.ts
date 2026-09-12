import { notifyCasaReview } from "@/lib/casa/review-notify";
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
import { z } from "zod";
import { casaErrorMessage } from "@/lib/casa/operations";
import { settlementMessage, type CasaSettlement } from "@/lib/casa/contract";
import { signedProofUrl } from "@/lib/telegram/notify";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  answerCallback,
  editCaption,
  esc,
  sendMessage,
  sendPhoto,
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
        `Quedaste conectado al panel.`,
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
    const [slug, questionId, ...palabras] = resto.split(/\s+/);
    await resolveFreeText(chatId, slug ?? "", questionId ?? "", palabras.join(" "));
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

  if (action === "q2") {
    await resolveQuestion(chatId, cb.id, parts[1] ?? "");
    return;
  }
  if (["ok", "no", "q"].includes(action)) {
    await answerCallback(cb.id, "Este botón es anterior a la actualización. Abre /pendientes o /resolver de nuevo.");
    return;
  }
  const attemptId = parts[1];
  if (!["ok2", "no2"].includes(action) || parts.length !== 2 || !z.string().uuid().safeParse(attemptId).success) {
    await answerCallback(cb.id); return;
  }
  const db = createAdminClient();
  const aprobado = action === "ok2";
  const { data, error } = await db.rpc("casa_review_attempt_v2", {
    p_attempt_id: attemptId, p_decision: aprobado ? "pagada" : "rechazada",
    p_reason: aprobado ? null : "Rechazado desde el panel de Telegram", p_contract: 2, p_chat_id: chatId,
  });
  if (error) { await answerCallback(cb.id, casaErrorMessage(error)); return; }
  await answerCallback(cb.id, data.changed ? (aprobado ? "Pago aprobado" : "Comprobante rechazado") : "La revisión ya estaba registrada.");
  if (!data.changed) return;
  await notifyCasaReview(data.entry_id, data.polla_id, aprobado);
  const { data: polla } = await db.from("casa_pollas").select("name").eq("id", data.polla_id).single();
  if (cb.message?.message_id) await editCaption(chatId, cb.message.message_id,
    `${aprobado ? "✅ APROBADO" : "❌ RECHAZADO"}\n${esc(polla?.name ?? "Polla")}\nLa revisión de este comprobante quedó registrada.`);
}

async function sendPending(chatId: number) {
  const pending = await listPendingProofs(10);
  if (pending.length === 0) {
    await sendMessage(chatId, "No hay pagos pendientes. Todo al día.");
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

    let attemptId = entry.current_proof_attempt_id;
    if (!attemptId) {
      const captured = await db.rpc("casa_legacy_proof_attempt_v2", { p_entry_id: entry.id, p_contract: 2, p_chat_id: chatId });
      if (captured.error) { await sendMessage(chatId, casaErrorMessage(captured.error)); continue; }
      attemptId = captured.data;
    }
    const { data: attempt, error: attemptError } = await db.from("casa_entry_proof_attempts")
      .select("proof_path").eq("id", attemptId).eq("entry_id", entry.id).single();
    if (attemptError || attempt.proof_path !== entry.proof_path) { await sendMessage(chatId, "La cola cambió. Abre /pendientes de nuevo."); continue; }
    const proofUrl = await signedProofUrl(attempt.proof_path);
    if (!proofUrl) { await sendMessage(chatId, "No pude cargar el comprobante. Revísalo en la web."); continue; }
    const buttons: InlineButton[][] = [
      [
        { text: "✅ Aprobar", callback_data: `ok2:${attemptId}` },
        { text: "❌ Rechazar", callback_data: `no2:${attemptId}` },
      ],
    ];

    await sendPhoto(
      chatId, proofUrl,
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
        p.prize_kind === "objeto" ? `Premio: <b>${esc(p.prize_object ?? "Objeto")}</b>` : `Pozo: <b>${formatCop(pot.prize_cop)}</b> · casa: ${formatCop(pot.house_cop)}`,
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
  const { data: polla, error: readError } = await db.from("casa_pollas").select("id, name").eq("slug", slug).is("archived_at", null).maybeSingle();
  if (readError || !polla) { await sendMessage(chatId, "No se pudo encontrar la polla."); return; }
  const { error } = await db.rpc("casa_change_status_v2", { p_polla_id: polla.id, p_action: "cerrar", p_contract: 2, p_chat_id: chatId });
  await sendMessage(chatId, error ? casaErrorMessage(error) : `🔒 <b>${esc(polla.name)}</b> quedó cerrada.`);
}

async function settlePolla(chatId: number, slug: string) {
  if (!slug) {
    await sendMessage(chatId, "Dime cuál: <code>/resolver nombre-de-la-polla</code>");
    return;
  }
  const db = createAdminClient();
  const { data: polla } = await db
    .from("casa_pollas")
    .select("id, name, kind, drawn_number, status")
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
Envíame <code>/numero ${esc(slug)} 47</code> con el número que salió.`,
    );
    return;
  }

  // Polla manual: primero hay que decir cuál fue la respuesta de cada pregunta.
  if (polla.kind === "manual" && ["abierta", "cerrada"].includes(polla.status)) {
    const { data: pendientes, error: questionsError } = await db
      .from("casa_questions")
      .select("id, prompt, input_kind, order_index")
      .eq("polla_id", polla.id)
      .is("resolved_at", null)
      .order("order_index", { ascending: true });

    if (questionsError) { await sendMessage(chatId, casaErrorMessage(questionsError)); return; }
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
<code>/respuesta ${esc(slug)} ${q.id} tu respuesta</code>`,
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
              callback_data: `q2:${o.id}`,
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

  const { data, error } = await db.rpc("casa_settle_polla_v2", { p_polla_id: polla.id, p_contract: 2, p_chat_id: chatId });
  if (error) { await sendMessage(chatId, casaErrorMessage(error)); return; }
  const result = data as CasaSettlement;
  const next = result.outcome === "object_draw_pending" || result.outcome === "object_awarded"
    ? `\n\nContinúa en la ficha para ${result.outcome === "object_draw_pending" ? "registrar el sorteo y su evidencia" : "registrar la entrega"}: ${process.env.NEXT_PUBLIC_APP_URL ?? "https://lapollacolombiana.com"}/casa/${slug}` : "";
  await sendMessage(chatId, `<b>${esc(polla.name)}</b>\n${esc(settlementMessage(result))}${esc(next)}`);
}

async function resolveQuestion(chatId: number, callbackId: string, optionId: string) {
  if (!z.string().uuid().safeParse(optionId).success) { await answerCallback(callbackId, "Opción inválida."); return; }
  const db = createAdminClient();
  const { data: option, error: optionError } = await db.from("casa_options").select("id, question_id, label").eq("id", optionId).single();
  if (optionError || !option) { await answerCallback(callbackId, "No se pudo leer la opción."); return; }
  const { data: question, error: questionError } = await db.from("casa_questions").select("polla_id").eq("id", option.question_id).single();
  if (questionError || !question) { await answerCallback(callbackId, "No se pudo leer la pregunta."); return; }
  const { error } = await db.rpc("casa_resolve_question_v2", { p_polla_id: question.polla_id,
    p_question_id: option.question_id, p_option_id: option.id, p_text: null, p_contract: 2, p_chat_id: chatId });
  await answerCallback(callbackId, error ? casaErrorMessage(error) : "Respuesta y puntajes guardados.");
}

async function resolveFreeText(chatId: number, slug: string, questionId: string, respuesta: string) {
  if (!slug || !z.string().uuid().safeParse(questionId).success || !respuesta.trim() || respuesta.length > 120) {
    await sendMessage(chatId, "Abre /resolver para obtener el comando con el identificador completo de la pregunta."); return;
  }
  const db = createAdminClient();
  const { data: polla, error: readError } = await db.from("casa_pollas").select("id").eq("slug", slug).is("archived_at", null).maybeSingle();
  if (readError || !polla) { await sendMessage(chatId, "No se pudo encontrar la polla."); return; }
  const { error } = await db.rpc("casa_resolve_question_v2", { p_polla_id: polla.id,
    p_question_id: questionId, p_option_id: null, p_text: respuesta.trim(), p_contract: 2, p_chat_id: chatId });
  await sendMessage(chatId, error ? casaErrorMessage(error) : "Respuesta y puntajes guardados.");
}

async function setDrawnNumber(chatId: number, slug: string, n: number) {
  if (!slug || !Number.isInteger(n) || n < 1) { await sendMessage(chatId, "Se usa así: <code>/numero mi-rifa 47</code>"); return; }
  const db = createAdminClient();
  const { data: polla, error: readError } = await db.from("casa_pollas").select("id, name").eq("slug", slug).is("archived_at", null).maybeSingle();
  if (readError || !polla) { await sendMessage(chatId, "No se pudo encontrar la rifa."); return; }
  const { error } = await db.rpc("casa_set_drawn_number_v2", { p_polla_id: polla.id, p_number: n, p_contract: 2, p_chat_id: chatId });
  await sendMessage(chatId, error ? casaErrorMessage(error) : `Número ${n} registrado en <b>${esc(polla.name)}</b>. Usa /resolver para adjudicar el premio.`);
}

interface QuestionRow {
  id: string;
  prompt: string;
  input_kind: string;
  order_index: number;
}

/**
 * Le avisa al jugador que su pago se aprobó (o no). Best-effort a propósito:
 * la decisión de Tama ya quedó escrita en la DB antes de llegar acá, así que
 * si WhatsApp está caído se pierde el aviso, no la aprobación.
 */

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
