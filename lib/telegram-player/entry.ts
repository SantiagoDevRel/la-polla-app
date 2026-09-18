// lib/telegram-player/entry.ts — Inscribirse y enviar el comprobante desde
// Telegram.
//
// El dinero se mueve POR FUERA (Nequi, transferencia), igual que en la web: aquí
// solo se muestran los datos de la cuenta de cobro de la polla y se recibe la
// foto. La foto recorre el MISMO contrato v2 que /casa/<slug>/pagar
// (lib/casa/proof-server.ts): begin reserva el intento en SQL, el archivo va al
// bucket privado en la ruta que decidió SQL, y confirm verifica byte a byte y lo
// pone en revisión. Nada se aprueba aquí: aprueba un administrador.

import { createHash, randomUUID } from "node:crypto";
import { getActiveProofs, getMyEntry, getOutstandingTicket, getPollaById, getPot, listPublicPollas } from "@/lib/casa/queries";
import { formatCop } from "@/lib/casa/format";
import { casaErrorMessage } from "@/lib/casa/operations";
import { CASA_CONTRACT } from "@/lib/casa/contract";
import { entryCanPick } from "@/lib/casa/picks-save";
import { beginCasaProof, confirmCasaProof, failCasaProof, readOwnedProofAttempt, type ProofContentType } from "@/lib/casa/proof-server";
import { isPollaOpen, type CasaPolla } from "@/lib/casa/types";
import { PROOF_BUCKET } from "@/lib/telegram/notify";
import { redactId } from "@/lib/log";
import { cb, cbNew, longId, shortId, stableUuid } from "./ids";
import { COPY } from "./copy";
import { buttonText, clearFlow, esc, sendScreen, setFlow, show, type Keyboard, type PlayerCtx } from "./context";
import type { PlayerPhoto } from "./update";
import { backToPolla, showPollaDetail } from "./pollas";

export const MAX_PROOF_BYTES = 8 * 1024 * 1024;

function methodLabel(method: string | null): string {
  const m = (method ?? "").trim().toLowerCase();
  if (m === "nequi") return "Nequi";
  if (m === "bancolombia") return "Bancolombia";
  if (m === "daviplata") return "Daviplata";
  return (method ?? "Cuenta").toUpperCase();
}

async function paymentInstructions(ctx: PlayerCtx, polla: CasaPolla, ticket: number | null, lead: string | null): Promise<void> {
  const P = shortId(polla.id);
  // Único lugar donde el bot muestra a dónde transferir. Con la polla cerrada
  // (o una rifa que cerró mientras la persona escribía el número) casa_begin_
  // entry_proof_v2 rechaza el comprobante: nunca pedir dinero en ese estado.
  if (!isPollaOpen(polla)) {
    await clearFlow(ctx);
    await showPollaDetail(ctx, polla, "Esta polla ya no recibe inscripciones. No transfieras dinero.");
    return;
  }
  if (!polla.payout_account) {
    await show(ctx, {
      text: "Esta polla todavía no tiene cuenta de cobro. <b>No transfieras todavía</b>: escríbenos en soporte o vuelve a revisar más tarde.",
      buttons: [backToPolla(polla)],
    });
    return;
  }
  const pot = await getPot(polla.id);
  let money: string;
  if (polla.prize_kind === "objeto") {
    money = `El premio es <b>${esc(polla.prize_object)}</b>. No hay reparto de dinero.`;
  } else if (polla.pot_mode === "fijo") {
    money = `Participas por un pozo de <b>${formatCop(pot.prize_cop)}</b>${typeof polla.fixed_prize_cop === "number" ? `, con un premio mínimo garantizado de ${formatCop(polla.fixed_prize_cop)}` : ""}. Si varios ganadores empatan, se divide entre ellos.${typeof pot.projected_prize_cop === "number" && pot.projected_prize_cop > pot.prize_cop ? ` Con tu entrada, el pozo queda en ${formatCop(pot.projected_prize_cop)}.` : ""}`;
  } else if (typeof pot.entry_prize_cop === "number" && typeof pot.entry_house_cop === "number") {
    money = `De tu entrada, <b>${formatCop(pot.entry_prize_cop)}</b> van al pozo y ${formatCop(pot.entry_house_cop)} son el costo del servicio.${typeof pot.projected_prize_cop === "number" ? ` Con tu entrada el pozo queda en ${formatCop(pot.projected_prize_cop)}.` : ""}`;
  } else {
    money = `El pozo va en <b>${formatCop(pot.prize_cop)}</b>.`;
  }

  await setFlow(ctx, "proof", { p: polla.id, t: ticket });
  await show(ctx, {
    text: [
      lead ? `${lead}\n` : null,
      `<b>Inscripción · ${esc(polla.name)}</b>${ticket != null ? `\nBoleta número <b>${ticket}</b>` : ""}`,
      "",
      `<b>Paso 1.</b> Transfiere exactamente <b>${formatCop(polla.entry_price_cop)}</b> a esta cuenta:`,
      `${esc(methodLabel(polla.payout_method))}: <code>${esc(polla.payout_account)}</code>`,
      polla.payout_account_name ? `A nombre de: ${esc(polla.payout_account_name)}` : null,
      "<i>Toca el número para copiarlo.</i>",
      "",
      "<b>Paso 2.</b> Toma una captura de pantalla del comprobante de la transferencia.",
      "",
      "<b>Paso 3.</b> Envía aquí esa imagen. Toca el clip 📎, elige la foto y envíala.",
      "",
      money,
      "",
      "Revisamos el comprobante y te avisamos por este chat. Si hay un error, te decimos por qué.",
    ].filter((l) => l !== null).join("\n"),
    buttons: [[{ text: "❌ Cancelar", callback_data: cb("cx", P) }]],
  });
}

/** Botón «Inscribirme» (pollas de partidos y de preguntas). */
export async function startJoin(ctx: PlayerCtx, polla: CasaPolla): Promise<void> {
  if (polla.kind === "rifa") {
    await startRaffle(ctx, polla);
    return;
  }
  const entry = await getMyEntry(polla.id, ctx.account.userId);
  if (entryCanPick(entry)) {
    await showPollaDetail(ctx, polla, entry!.status === "pagada" ? "Ya estás inscrito en esta polla." : "Tu comprobante ya está en revisión. No repitas el pago.");
    return;
  }
  if (!isPollaOpen(polla)) {
    await showPollaDetail(ctx, polla, "Esta polla ya no recibe inscripciones.");
    return;
  }
  // Entrada gratis (migración 143): no hay transferencia ni comprobante. El
  // mismo botón inscribe aquí mismo, igual que «Unirme» en la app — si no, el
  // bot seguiría pidiendo el pantallazo de una transferencia de $0.
  if (polla.entry_price_cop === 0) {
    const { error } = await ctx.db.rpc("casa_join_free_v1", {
      p_polla_id: polla.id, p_user_id: ctx.account.userId, p_contract: CASA_CONTRACT,
    });
    if (error) {
      console.warn("[telegram-player] entrada gratis:", error.message);
      await showPollaDetail(ctx, polla, "No pudimos inscribirte. Intenta de nuevo en un momento.");
      return;
    }
    await showPollaDetail(ctx, polla, "✅ Listo, ya estás inscrito. Entrar a esta polla es gratis. Ahora haz tus pronósticos.");
    return;
  }
  const lead = !entry
    ? null
    : entry.status === "rechazada"
      ? `❌ Tu comprobante anterior fue rechazado${entry.reject_reason ? `: ${esc(entry.reject_reason)}` : ""}. Si ya transferiste, no repitas el pago: solo envía el comprobante correcto.`
      : "Si ya transferiste, no repitas el pago. Solo envía la foto del comprobante.";
  await paymentInstructions(ctx, polla, null, lead);
}

// ── Rifas ───────────────────────────────────────────────────────────────────

type Availability = { tickets: Array<{ number: number; state: string }>; total: number; available: number; can_reserve: boolean; next: number | null };

async function availability(ctx: PlayerCtx, pollaId: string, from: number, limit: number): Promise<Availability | null> {
  const { data, error } = await ctx.db.rpc("casa_ticket_availability_v2", { p_polla_id: pollaId, p_user_id: ctx.account.userId, p_from: from, p_limit: limit });
  if (error || !data) {
    console.warn("[telegram-player] boletas no leídas:", error?.message);
    return null;
  }
  return data as Availability;
}

export async function startRaffle(ctx: PlayerCtx, polla: CasaPolla): Promise<void> {
  const P = shortId(polla.id);
  if (!isPollaOpen(polla)) {
    await showPollaDetail(ctx, polla, "Esta rifa ya no vende boletas.");
    return;
  }
  const outstanding = await getOutstandingTicket(polla.id, ctx.account.userId);
  if (outstanding?.ticket_number != null) {
    if (outstanding.status === "pendiente" && outstanding.proof_path) {
      await showPollaDetail(ctx, polla, `⏳ Tu boleta ${outstanding.ticket_number} está en revisión. Espera la confirmación del pago antes de comprar otra.`);
      return;
    }
    await show(ctx, {
      text: `Tienes la boleta <b>${outstanding.ticket_number}</b> reservada sin comprobante confirmado. Complétala antes de comprar otra. Si ya transferiste, no repitas el pago.`,
      buttons: [[{ text: `📸 Enviar comprobante de la boleta ${outstanding.ticket_number}`, callback_data: cb("rt", P, outstanding.ticket_number) }], backToPolla(polla)],
    });
    return;
  }
  const summary = await availability(ctx, polla.id, 1, 1);
  if (!summary) {
    await show(ctx, { text: COPY.failure, buttons: [backToPolla(polla)] });
    return;
  }
  if (summary.available <= 0) {
    await showPollaDetail(ctx, polla, "Ya no quedan boletas disponibles en esta rifa.");
    return;
  }
  await clearFlow(ctx);
  await show(ctx, {
    text: `<b>${esc(polla.name)}</b>\n\nHay <b>${summary.available}</b> boletas disponibles de ${summary.total}. ¿Cómo quieres elegir tu número?`,
    buttons: [
      [{ text: "🎲 Dame un número al azar", callback_data: cb("rr", P) }],
      [{ text: "✍️ Quiero escribir el número", callback_data: cb("rw", P) }],
      backToPolla(polla),
    ],
  });
}

export async function randomTicket(ctx: PlayerCtx, polla: CasaPolla): Promise<void> {
  if (!isPollaOpen(polla)) {
    await showPollaDetail(ctx, polla, "Esta rifa ya no vende boletas.");
    return;
  }
  const total = polla.ticket_count ?? 0;
  const pages = Math.max(1, Math.ceil(total / 100));
  const startPage = Math.floor(Math.random() * pages);
  for (let i = 0; i < pages; i += 1) {
    const from = ((startPage + i) % pages) * 100 + 1;
    const page = await availability(ctx, polla.id, from, 100);
    if (!page) break;
    const free = page.tickets.filter((t) => t.state === "available").map((t) => t.number);
    if (free.length > 0) {
      const number = free[Math.floor(Math.random() * free.length)];
      await chooseTicket(ctx, polla, number);
      return;
    }
  }
  await showPollaDetail(ctx, polla, "Ya no quedan boletas disponibles en esta rifa.");
}

export async function askTicketNumber(ctx: PlayerCtx, polla: CasaPolla): Promise<void> {
  await setFlow(ctx, "ticket", { p: polla.id });
  await show(ctx, {
    text: `Escribe el número de boleta que quieres, entre 1 y ${polla.ticket_count ?? 0}.`,
    buttons: [[{ text: "❌ Cancelar", callback_data: cb("rb", shortId(polla.id)) }]],
  });
}

export async function handleTicketInput(ctx: PlayerCtx, text: string): Promise<void> {
  const polla = await getPollaById(String(ctx.chat.flow?.data.p ?? ""));
  if (!polla || polla.kind !== "rifa") {
    await clearFlow(ctx);
    await sendScreen(ctx, { text: COPY.expiredButton });
    return;
  }
  const n = Number(text.replace(/[^\d]/g, ""));
  if (!/\d/.test(text) || !Number.isSafeInteger(n) || n < 1 || n > (polla.ticket_count ?? 0)) {
    await sendScreen(ctx, { text: `Escribe solo el número de la boleta, entre 1 y ${polla.ticket_count ?? 0}.` });
    return;
  }
  await chooseTicket(ctx, polla, n);
}

export async function chooseTicket(ctx: PlayerCtx, polla: CasaPolla, number: number): Promise<void> {
  const P = shortId(polla.id);
  const page = await availability(ctx, polla.id, number, 1);
  const ticket = page?.tickets.find((t) => t.number === number);
  if (!page || !ticket) {
    await show(ctx, { text: COPY.failure, buttons: [backToPolla(polla)] });
    return;
  }
  const retry: Keyboard = [[{ text: "🎲 Elegir otro número", callback_data: cb("rb", P) }], backToPolla(polla)];
  if (ticket.state === "unavailable") {
    await show(ctx, { text: `La boleta ${number} ya está reservada por otra persona. Elige otra.`, buttons: retry });
    return;
  }
  if (ticket.state === "paid" || ticket.state === "review") {
    await show(ctx, { text: `La boleta ${number} ya es tuya (${ticket.state === "paid" ? "pagada" : "en revisión"}).`, buttons: [backToPolla(polla)] });
    return;
  }
  if (ticket.state === "available" && !page.can_reserve) {
    await startRaffle(ctx, polla);
    return;
  }
  const lead = ticket.state === "available" ? null : "Si ya transferiste por esta boleta, no repitas el pago. Solo envía la foto del comprobante.";
  await paymentInstructions(ctx, polla, number, lead);
}

/** Botón «Enviar comprobante de la boleta N». */
export async function resumeTicket(ctx: PlayerCtx, polla: CasaPolla, number: number): Promise<void> {
  if (!isPollaOpen(polla)) {
    await showPollaDetail(ctx, polla, "Esta rifa ya no recibe comprobantes nuevos.");
    return;
  }
  await chooseTicket(ctx, polla, number);
}

// ── Foto del comprobante ────────────────────────────────────────────────────

function detectImage(bytes: Buffer): ProofContentType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

/** Foto sin paso activo: se pregunta de cuál polla es. */
export async function askProofPolla(ctx: PlayerCtx, photo: PlayerPhoto): Promise<void> {
  const candidates = [];
  for (const polla of (await listPublicPollas()).filter((p) => isPollaOpen(p) && p.kind !== "rifa")) {
    if (candidates.length >= 8) break;
    const entry = await getMyEntry(polla.id, ctx.account.userId);
    if (!entryCanPick(entry)) candidates.push(polla);
  }
  if (candidates.length === 0) {
    await sendScreen(ctx, {
      text: "Si es un comprobante de pago, primero elige la polla en <b>⚽ Pollas abiertas</b> y toca <b>Inscribirme</b>. Después envías la foto.",
      buttons: [[{ text: "⚽ Pollas abiertas", callback_data: cb("ol", 0) }]],
    });
    return;
  }
  await setFlow(ctx, "photo_pick", { f: photo.fileId, u: photo.fileUniqueId, s: photo.source, m: photo.mime, z: photo.size });
  await sendScreen(ctx, {
    text: "¿De cuál polla es este comprobante? Si es de una rifa, primero elige tu boleta desde la polla.",
    buttons: [
      ...candidates.map((p) => [{ text: buttonText(`${p.name} · ${formatCop(p.entry_price_cop)}`), callback_data: cb("ph", shortId(p.id)) }]),
      [{ text: "❌ No es un comprobante", callback_data: "cx" }],
    ],
  });
}

/** Tocó la polla de una foto que mandó antes. */
export async function proofForPickedPolla(ctx: PlayerCtx, pollaShort: string | undefined): Promise<void> {
  const flow = ctx.chat.flow;
  const pollaId = longId(pollaShort);
  if (!flow || flow.name !== "photo_pick" || !pollaId || typeof flow.data.f !== "string" || typeof flow.data.u !== "string") {
    await show(ctx, { text: "Esa foto ya venció. Elige la polla, toca Inscribirme y envía el comprobante otra vez." });
    return;
  }
  const photo: PlayerPhoto = {
    fileId: flow.data.f,
    fileUniqueId: flow.data.u,
    source: flow.data.s === "document" ? "document" : "photo",
    mime: typeof flow.data.m === "string" ? flow.data.m : null,
    size: typeof flow.data.z === "number" ? flow.data.z : null,
  };
  const polla = await getPollaById(pollaId);
  if (!polla || polla.kind === "rifa") {
    await clearFlow(ctx);
    await show(ctx, { text: COPY.expiredButton });
    return;
  }
  await show(ctx, { text: `Recibiendo tu comprobante para <b>${esc(polla.name)}</b>…` });
  await receiveProof(ctx, polla, null, photo);
}

/** Foto con el paso «comprobante» activo. */
export async function receiveProofFromFlow(ctx: PlayerCtx, photo: PlayerPhoto): Promise<void> {
  const flow = ctx.chat.flow!;
  const polla = await getPollaById(String(flow.data.p ?? ""));
  const ticket = typeof flow.data.t === "number" ? flow.data.t : null;
  if (!polla || polla.status === "borrador" || polla.status === "anulada") {
    await clearFlow(ctx);
    await sendScreen(ctx, { text: "Esa polla ya no está disponible. No repitas la transferencia; escríbenos en soporte si ya pagaste." });
    return;
  }
  await receiveProof(ctx, polla, ticket, photo);
}

async function receiveProof(ctx: PlayerCtx, polla: CasaPolla, ticket: number | null, photo: PlayerPhoto): Promise<void> {
  const P = shortId(polla.id);
  const again: Keyboard = [backToPolla(polla)];
  // Una inscripción nueva solo empieza con la polla abierta (lo vuelve a exigir
  // casa_begin_entry_proof_v2): no se baja la foto si ya cerró, salvo que haya
  // una carga suya en curso (la subida falló justo al cierre y la retoma).
  if (!isPollaOpen(polla) && !(await getActiveProofs(polla.id, ctx.account.userId)).some((p) => p.ticket_number === ticket)) {
    await clearFlow(ctx);
    await sendScreen(ctx, { text: "Esta polla ya no recibe inscripciones ni comprobantes nuevos. Si ya transferiste, no repitas el pago y escríbenos en soporte.", buttons: again });
    return;
  }
  await ctx.bot.send("sendChatAction", { chat_id: ctx.chatId, action: "upload_photo" });

  if (photo.size !== null && photo.size > MAX_PROOF_BYTES) {
    await sendScreen(ctx, { text: "Esa imagen pesa más de 8 MB. Envíala como foto (no como archivo) para que Telegram la comprima." });
    return;
  }
  const bytes = await ctx.bot.download(photo.fileId, MAX_PROOF_BYTES);
  if (bytes === "too_large") {
    await sendScreen(ctx, { text: "Esa imagen pesa más de 8 MB. Envíala como foto (no como archivo) para que Telegram la comprima." });
    return;
  }
  if (!bytes || bytes.length === 0) {
    await sendScreen(ctx, { text: "No pudimos descargar la imagen. Envíala de nuevo en un momento." });
    return;
  }
  const contentType = detectImage(bytes);
  if (!contentType) {
    await sendScreen(ctx, { text: "Ese archivo no es una imagen JPG, PNG o WEBP. Toma una captura de pantalla del comprobante y envíala como foto." });
    return;
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  // Mismo archivo + misma polla/boleta = mismo intento: reenviar la foto o un
  // update que Telegram reintenta no crea otra inscripción.
  const proofInput = {
    pollaId: polla.id, userId: ctx.account.userId, ticketNumber: ticket,
    sha256, contentType, bytes: bytes.length,
  };
  let requestId = stableUuid(`tg-proof|${ctx.account.userId}|${polla.id}|${ticket ?? ""}|${sha256}`);
  // Dos rondas como máximo: la segunda solo si el archivo guardado no coincide
  // con el enviado (UPLOAD_MISMATCH), igual que lib/casa/proof-submit.ts.
  for (let round = 0; round < 2; round += 1) {
    let begun = await beginCasaProof(ctx.db, { ...proofInput, requestId });
    // El intento de ese archivo ya venció, falló o fue rechazado: la misma foto
    // puede empezar un intento nuevo (la web hace lo mismo con otro requestId).
    if (begun.error && ["UPLOAD_EXPIRED", "ATTEMPT_REPLACED"].includes(begun.error.message ?? "")) {
      requestId = randomUUID();
      begun = await beginCasaProof(ctx.db, { ...proofInput, requestId });
    }
    if (begun.error || !begun.data) {
      const code = begun.error?.message ?? "";
      if (code === "PROOF_IN_REVIEW" || code === "ALREADY_PAID") await clearFlow(ctx);
      const text = code === "TICKET_UNAVAILABLE"
        ? "Esa boleta la acaba de reservar otra persona. Elige otra boleta. Si ya transferiste, no repitas el pago: escríbenos en soporte."
        : casaErrorMessage(begun.error ?? {});
      await sendScreen(ctx, { text: esc(text), buttons: code === "TICKET_UNAVAILABLE" ? [[{ text: "🎟 Elegir otra boleta", callback_data: cb("rb", P) }], ...again] : again });
      return;
    }

    if (begun.data.state !== "confirmed") {
      const upload = await ctx.db.storage.from(PROOF_BUCKET).upload(begun.data.proof_path, bytes, { contentType, upsert: false });
      // Si ya existe (un reintento del mismo archivo), la verificación decide.
      if (upload.error && !/exist|duplicate/i.test(upload.error.message ?? "")) {
        // NO se marca el intento como fallido: queda «subiendo» 15 minutos y
        // reenviar la misma foto lo retoma, incluso si la polla cerró en medio
        // (marcarlo fallido anularía la inscripción sin forma de volver).
        console.warn("[telegram-player] subida de comprobante falló:", redactId(ctx.account.userId), upload.error.message);
        await sendScreen(ctx, { text: "No pudimos guardar la imagen. Envía la misma foto de nuevo en un momento. Si ya transferiste, no repitas el pago.", buttons: again });
        return;
      }
    }

    const { data: attempt } = await readOwnedProofAttempt(ctx.db, { pollaId: polla.id, userId: ctx.account.userId, attemptId: begun.data.attempt_id });
    if (!attempt) {
      await sendScreen(ctx, { text: COPY.failure, buttons: again });
      return;
    }
    const confirmed = await confirmCasaProof(ctx.db, polla, ctx.account.userId, attempt);
    if (!confirmed.ok) {
      if (round === 0 && confirmed.stage === "verify" && confirmed.code === "UPLOAD_MISMATCH") {
        await failCasaProof(ctx.db, { attemptId: attempt.id, userId: ctx.account.userId });
        requestId = randomUUID();
        continue;
      }
      const text = confirmed.stage === "verify" ? confirmed.message : casaErrorMessage(confirmed.error);
      console.warn("[telegram-player] confirmación de comprobante falló:", redactId(ctx.account.userId), confirmed.stage);
      await sendScreen(ctx, { text: `${esc(text)}\n\nEnvía la foto de nuevo. Si ya transferiste, no repitas el pago.`, buttons: again });
      return;
    }

    await clearFlow(ctx);
    const alreadyPaid = begun.data.entry_status === "pagada" || confirmed.data.entry_status === "pagada";
    // Botones en mensaje nuevo: esta confirmación tiene que seguir en el chat.
    const buttons: Keyboard = [];
    if (polla.kind === "partidos") buttons.push([{ text: alreadyPaid ? "⚽ Pronosticar" : "⚽ Pronosticar mientras tanto", callback_data: cbNew("pk", P) }]);
    if (polla.kind === "manual") buttons.push([{ text: "📝 Responder preguntas", callback_data: cbNew("q", P) }]);
    buttons.push([{ text: "👉 Ver la polla", callback_data: cbNew("p", P) }]);
    await sendScreen(ctx, {
      text: alreadyPaid
        ? `✅ <b>Tu pago de ${esc(polla.name)}${ticket != null ? ` (boleta ${ticket})` : ""} ya está confirmado.</b> No tienes que enviar nada más.`
        : [
          `✅ <b>Recibimos tu comprobante${ticket != null ? ` de la boleta ${ticket}` : ""}.</b>`,
          "",
          `Polla: ${esc(polla.name)}`,
          "Lo estamos revisando. Te avisamos por este chat apenas quede confirmado.",
          polla.kind === "partidos"
            ? "Mientras tanto ya puedes pronosticar; tu participación cuenta cuando confirmemos el pago."
            : polla.kind === "manual"
              ? "Mientras tanto ya puedes responder las preguntas; tu participación cuenta cuando confirmemos el pago."
              : null,
        ].filter((l) => l !== null).join("\n"),
      buttons,
    });
    return;
  }
}
