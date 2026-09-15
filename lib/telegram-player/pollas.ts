// lib/telegram-player/pollas.ts — Pantallas de consulta: pollas abiertas, mis
// pollas, detalle, reglas, tabla de posiciones, mis pagos y ayuda.
//
// Las cifras de dinero salen SIEMPRE de SQL (getPot / getPots / umbral del
// premio fijo): aquí solo se formatean. Lo que ve cada persona es lo mismo que
// ve en la web con su sesión: la tabla muestra nombres (igual que /casa/<slug>)
// y nunca teléfonos, comprobantes ni cuentas de otras personas.

import {
  getFixedPrizeThreshold,
  getLeaderboard,
  getMyEntry,
  getPayouts,
  getPollaById,
  getPot,
  getPots,
  listPublicPollas,
} from "@/lib/casa/queries";
import { listMyPollas } from "@/lib/casa/my-pollas";
import { getPollaTournamentSlugs } from "@/lib/casa/tournaments";
import { formatCop, timeLeft } from "@/lib/casa/format";
import { entryCanPick, pollaAcceptsPicks } from "@/lib/casa/picks-save";
import { isPollaOpen, LOCK_MINUTES, pollaStatusLabel, type CasaEntry, type CasaPolla, type CasaPot } from "@/lib/casa/types";
import { formatColombiaDateTime } from "@/lib/time/colombia";
import { getTournamentName } from "@/lib/tournaments";
import { loginLinkOrigin } from "@/lib/auth/telegram-login/links";
import { cb, longId, shortId } from "./ids";
import { COPY, MENU_LABELS } from "./copy";
import { buttonText, esc, show, type Keyboard, type PlayerCtx, type Screen } from "./context";

const PAGE_SIZE = 8;

export function pollaUrl(ctx: Pick<PlayerCtx, "env">, slug: string): string {
  return `${loginLinkOrigin("es", ctx.env)}/casa/${encodeURIComponent(slug)}`;
}

/**
 * Botón con enlace solo si es https: Telegram rechaza el mensaje ENTERO si un
 * botón trae una URL que no acepta (p. ej. http://localhost en desarrollo).
 */
export function urlRow(text: string, url: string): Keyboard {
  return /^https:\/\//.test(url) ? [[{ text, url }]] : [];
}

/** Polla visible para jugadores, a partir del id corto de un botón. */
export async function loadVisiblePolla(short: string | undefined): Promise<CasaPolla | null> {
  const id = longId(short);
  if (!id) return null;
  const polla = await getPollaById(id);
  if (!polla || polla.status === "borrador" || polla.status === "anulada") return null;
  return polla;
}

export function formatDateTime(iso: string): string {
  return formatColombiaDateTime(iso, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
}

export function kindLabel(polla: Pick<CasaPolla, "kind" | "scoring_mode">): string {
  if (polla.kind === "rifa") return "Rifa";
  if (polla.kind === "manual") return "Preguntas";
  return polla.scoring_mode === "marcador" ? "Partidos · adivina el marcador" : "Partidos · adivina quién gana";
}

function prizeLine(polla: CasaPolla, pot: CasaPot | undefined): string {
  if (polla.prize_kind === "objeto") return `🏆 Premio: <b>${esc(polla.prize_object)}</b>`;
  const base = `🏆 Pozo: <b>${pot ? formatCop(pot.prize_cop) : "por confirmar"}</b>`;
  if (polla.pot_mode !== "fijo" || typeof polla.fixed_prize_cop !== "number") return base;
  return pot && pot.prize_cop > polla.fixed_prize_cop
    ? `${base} (mínimo garantizado ${formatCop(polla.fixed_prize_cop)})`
    : `${base} (garantizado)`;
}

export function backToPolla(polla: Pick<CasaPolla, "id">): Keyboard[number] {
  return [{ text: "⬅️ Volver a la polla", callback_data: cb("p", shortId(polla.id)) }];
}

// ── Listas ──────────────────────────────────────────────────────────────────

export async function showOpenPollas(ctx: PlayerCtx, page = 0): Promise<void> {
  const pollas = (await listPublicPollas()).filter((p) => isPollaOpen(p));
  if (pollas.length === 0) {
    await show(ctx, {
      text: "<b>Pollas abiertas</b>\n\nAhora no hay pollas abiertas. El administrador publica las pollas de cada fin de semana: vuelve a revisar pronto.",
      buttons: [[{ text: MENU_LABELS.mias, callback_data: cb("ml", 0) }]],
    });
    return;
  }
  const safePage = Math.min(Math.max(0, page), Math.ceil(pollas.length / PAGE_SIZE) - 1);
  const slice = pollas.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const pots = await getPots(slice.map((p) => p.id));
  const lines = slice.map((p) => {
    const prize = p.prize_kind === "objeto" ? esc(p.prize_object) : formatCop(pots[p.id]?.prize_cop ?? 0);
    return `• <b>${esc(p.name)}</b>\n   Entrada ${formatCop(p.entry_price_cop)} · ${p.prize_kind === "objeto" ? "Premio" : "Pozo"} ${prize} · cierra en ${timeLeft(p.closes_at)}`;
  });
  const buttons: Keyboard = slice.map((p) => [
    { text: buttonText(`${p.name} · ${formatCop(p.entry_price_cop)}`), callback_data: cb("p", shortId(p.id)) },
  ]);
  const nav = [];
  if (safePage > 0) nav.push({ text: "⬅️ Anteriores", callback_data: cb("ol", safePage - 1) });
  if ((safePage + 1) * PAGE_SIZE < pollas.length) nav.push({ text: "Más pollas ➡️", callback_data: cb("ol", safePage + 1) });
  if (nav.length) buttons.push(nav);
  await show(ctx, {
    text: ["<b>Pollas abiertas</b>", "Toca una para ver el premio, las reglas y cómo inscribirte.", "", ...lines].join("\n"),
    buttons,
  });
}

export async function showMyPollas(ctx: PlayerCtx, page = 0): Promise<void> {
  const mine = await listMyPollas(ctx.account.userId);
  if (mine.length === 0) {
    await show(ctx, {
      text: "<b>Mis pollas</b>\n\nTodavía no estás inscrito en ninguna polla. Mira las pollas abiertas para participar.",
      buttons: [[{ text: MENU_LABELS.abiertas, callback_data: cb("ol", 0) }]],
    });
    return;
  }
  const safePage = Math.min(Math.max(0, page), Math.ceil(mine.length / PAGE_SIZE) - 1);
  const slice = mine.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const lines = slice.map((p) => {
    const state = p.status === "resuelta" ? "finalizada" : p.status === "cerrada" ? "cerrada" : `cierra en ${timeLeft(p.closes_at)}`;
    // listMyPollas no distingue un comprobante en revisión de una carga sin
    // terminar: «pendiente» sirve para los dos (el detalle dice cuál es).
    const pay = p.entry_status === "pagada" ? "✅ pago confirmado" : "⏳ pago pendiente";
    return `• <b>${esc(p.name)}</b>\n   ${pay} · ${state}`;
  });
  const buttons: Keyboard = slice.map((p) => [
    { text: buttonText(`${p.entry_status === "pagada" ? "✅" : "⏳"} ${p.name}`), callback_data: cb("p", shortId(p.id)) },
  ]);
  const nav = [];
  if (safePage > 0) nav.push({ text: "⬅️ Anteriores", callback_data: cb("ml", safePage - 1) });
  if ((safePage + 1) * PAGE_SIZE < mine.length) nav.push({ text: "Más ➡️", callback_data: cb("ml", safePage + 1) });
  if (nav.length) buttons.push(nav);
  await show(ctx, {
    text: ["<b>Mis pollas</b>", "Toca una para pronosticar, ver la tabla o las reglas.", "", ...lines].join("\n"),
    buttons,
  });
}

// ── Detalle ─────────────────────────────────────────────────────────────────

type TicketRow = { ticket_number: number | null; status: string; proof_path: string | null; reject_reason: string | null };

export async function myTickets(ctx: PlayerCtx, pollaId: string): Promise<TicketRow[]> {
  const { data, error } = await ctx.db.from("casa_entries")
    .select("ticket_number, status, proof_path, reject_reason")
    .eq("polla_id", pollaId).eq("user_id", ctx.account.userId)
    .not("ticket_number", "is", null)
    .order("ticket_number").limit(50);
  if (error) throw error;
  return (data ?? []) as TicketRow[];
}

export function ticketStateLabel(t: TicketRow): string {
  if (t.status === "pagada") return "✅ pagada";
  if (t.status === "pendiente" && t.proof_path) return "⏳ en revisión";
  if (t.status === "rechazada") return `❌ rechazada${t.reject_reason ? `: ${esc(t.reject_reason)}` : ""}`;
  return "⚠️ falta el comprobante";
}

export function entryStatusLine(entry: CasaEntry | null): string {
  if (!entry) return "Todavía no estás inscrito.";
  if (entry.status === "pagada") return "✅ <b>Estás inscrito.</b> Tu pago está confirmado.";
  if (entry.status === "pendiente" && entry.proof_path) return "⏳ <b>Tu comprobante está en revisión.</b> Te avisamos por este chat cuando lo confirmemos.";
  if (entry.status === "rechazada") return `❌ <b>Tu pago fue rechazado.</b>${entry.reject_reason ? ` Motivo: ${esc(entry.reject_reason)}.` : ""} Revisa y envía el comprobante correcto.`;
  return "⚠️ <b>Tu comprobante no se guardó.</b> Si ya transferiste, no repitas el pago: solo envía la foto de nuevo.";
}

export async function pollaDetailScreen(ctx: PlayerCtx, polla: CasaPolla, notice?: string): Promise<Screen> {
  const P = shortId(polla.id);
  const [pot, entry, tournaments, payouts] = await Promise.all([
    getPot(polla.id),
    polla.kind === "rifa" ? Promise.resolve(null) : getMyEntry(polla.id, ctx.account.userId),
    getPollaTournamentSlugs([polla]),
    polla.status === "resuelta" ? getPayouts(polla.id) : Promise.resolve([]),
  ]);
  const tickets = polla.kind === "rifa" ? await myTickets(ctx, polla.id) : [];
  const open = isPollaOpen(polla);
  const names = (tournaments[polla.id] ?? []).map((slug) => getTournamentName(slug));

  const lines: Array<string | null> = [
    notice ? `${notice}\n` : null,
    `<b>${esc(polla.name)}</b>`,
    `${esc(kindLabel(polla))}${names.length ? ` · ${esc(names.join(", "))}` : ""}`,
    "",
    prizeLine(polla, pot),
    `🎟 Entrada: <b>${formatCop(polla.entry_price_cop)}</b>`,
    `👥 Inscritos: ${pot.paid_entries}`,
    open
      ? `⏰ Inscripciones hasta: ${esc(formatDateTime(polla.closes_at))} (faltan ${timeLeft(polla.closes_at)})`
      : `Estado: ${esc(pollaStatusLabel(polla).text)}`,
  ];
  if (payouts.length > 0) {
    const winners = payouts.map((w) => `${esc(w.display_name ?? "Sin nombre")}${w.prize_kind === "objeto" ? "" : ` (${formatCop(w.amount_cop)})`}`);
    lines.push(`🏆 ${payouts.length === 1 ? "Ganó" : "Ganaron"}: ${winners.join(", ")}`);
  }
  if (polla.settlement_outcome === "house_retained_zero_points") lines.push("Todos terminaron con cero puntos: no se adjudicó el premio.");
  lines.push("");
  if (polla.kind === "rifa") {
    lines.push(tickets.length === 0
      ? "Todavía no tienes boletas en esta rifa."
      : `Tus boletas: ${tickets.map((t) => `${t.ticket_number} (${ticketStateLabel(t)})`).join(", ")}`);
    if (polla.drawn_number != null) lines.push(`Número sorteado: <b>${polla.drawn_number}</b>`);
  } else {
    lines.push(entryStatusLine(entry));
  }

  const buttons: Keyboard = [];
  const inscrito = entryCanPick(entry);
  if (polla.kind !== "rifa" && open && !inscrito) {
    buttons.push([{ text: entry ? "📸 Enviar comprobante" : `✅ Inscribirme · ${formatCop(polla.entry_price_cop)}`, callback_data: cb("j", P) }]);
  }
  if (polla.kind === "rifa" && open) {
    // Una boleta sin pago confirmado ni comprobante en revisión (rechazada o
    // sin comprobante) se completa primero: igual que casa_begin_entry_proof_v2.
    const pendingTicket = tickets.find((t) => t.status !== "pagada" && !(t.status === "pendiente" && t.proof_path));
    const inReview = tickets.some((t) => t.status === "pendiente" && t.proof_path);
    if (pendingTicket?.ticket_number != null) {
      buttons.push([{ text: `📸 Enviar comprobante de la boleta ${pendingTicket.ticket_number}`, callback_data: cb("rt", P, pendingTicket.ticket_number) }]);
    } else if (!inReview) {
      // Las rifas admiten varias boletas por persona (casa_entries_ticket_unique).
      const hasPaid = tickets.some((t) => t.status === "pagada");
      buttons.push([{ text: hasPaid ? "🎟 Comprar otra boleta" : "🎟 Comprar una boleta", callback_data: cb("rb", P) }]);
    }
  }
  if (polla.kind === "partidos" && inscrito) {
    if (pollaAcceptsPicks(polla)) buttons.push([{ text: "⚽ Pronosticar", callback_data: cb("pk", P) }]);
    buttons.push([{ text: "📋 Mis pronósticos", callback_data: cb("ls", P) }]);
  }
  if (polla.kind === "manual" && inscrito) {
    if (open) buttons.push([{ text: "📝 Responder preguntas", callback_data: cb("q", P) }]);
    buttons.push([{ text: "📋 Mis respuestas", callback_data: cb("la", P) }]);
  }
  const infoRow = [{ text: "ℹ️ Reglas e info", callback_data: cb("if", P) }];
  if (polla.kind !== "rifa") infoRow.unshift({ text: "🏆 Tabla", callback_data: cb("tb", P) });
  buttons.push(infoRow);
  buttons.push(...urlRow("🌐 Ver en la página", pollaUrl(ctx, polla.slug)));
  return { text: lines.filter((l) => l !== null).join("\n"), buttons };
}

export async function showPollaDetail(ctx: PlayerCtx, polla: CasaPolla, notice?: string): Promise<void> {
  await show(ctx, await pollaDetailScreen(ctx, polla, notice));
}

// ── Reglas ──────────────────────────────────────────────────────────────────

function pts(n: number): string {
  return `${n} ${n === 1 ? "punto" : "puntos"}`;
}

export async function showInfo(ctx: PlayerCtx, polla: CasaPolla): Promise<void> {
  const money = polla.prize_kind !== "objeto";
  const threshold = money ? await getFixedPrizeThreshold(polla) : null;
  const lines: string[] = [`<b>Reglas · ${esc(polla.name)}</b>`];
  if (polla.description) lines.push("", esc(polla.description));

  if (polla.kind === "partidos") {
    lines.push("", "<b>Cómo sumas puntos</b>");
    if (polla.scoring_mode === "marcador") {
      lines.push(`• Marcador exacto: ${pts(polla.points_exact)}.`, `• Goles de un solo equipo: ${pts(polla.points_one_team)}.`, "• No se suman entre sí. Sin aciertos, 0 puntos.");
    } else {
      lines.push("• Eliges si gana el local, hay empate o gana el visitante.", `• Si aciertas: ${pts(polla.points_result)}. Si no, 0 puntos.`);
    }
  }
  if (polla.kind === "manual") lines.push("", "<b>Cómo sumas puntos</b>", "• Cada pregunta indica cuántos puntos vale.", "• Una respuesta incorrecta suma 0 puntos.");

  lines.push("", "<b>Premio y ganadores</b>");
  if (money && polla.pot_mode === "fijo" && typeof polla.fixed_prize_cop === "number") {
    lines.push(`• Premio mínimo garantizado: ${formatCop(polla.fixed_prize_cop)}.`);
    if (threshold?.entriesToGrow != null && threshold.entryPrizeCop > 0) {
      const n = threshold.entriesToGrow;
      lines.push(`• Si más de ${n} ${n === 1 ? "persona se inscribe" : "personas se inscriben"}, el pozo crece ${formatCop(threshold.entryPrizeCop)} por cada persona adicional.`);
    }
  }
  if (polla.kind === "rifa") {
    lines.push("• Gana la boleta que coincida con el número del sorteo anunciado.");
    if (polla.draw_method) lines.push(`• ${esc(polla.draw_method)}`);
  } else if (money) {
    lines.push("• Gana quien sume más puntos.", "• Si hay empate en el primer puesto, el pozo se divide en partes iguales, incluidos los pesos del redondeo.");
  } else {
    lines.push(`• El premio es ${esc(polla.prize_object)}. Gana quien sume más puntos.`, "• Si hay empate en el primer puesto, se sortea entre los empatados.", "• El premio no se divide ni se cambia por dinero.");
  }
  if (polla.kind !== "rifa") lines.push("• Necesitas al menos 1 punto para ganar. Si todos terminan con 0, no se entrega el premio.");

  if (polla.kind === "partidos") {
    lines.push(
      "", "<b>Hasta cuándo puedes pronosticar</b>",
      `• Cada partido se cierra ${LOCK_MINUTES} minutos antes de empezar.`,
      "• Desde ese momento no puedes agregar ni cambiar su pronóstico.",
      "• El cierre de inscripciones no cambia ese plazo.",
      "", "<b>Qué marcador cuenta</b>",
      "• Los 90 minutos más el tiempo de adición. No cuentan el alargue ni los penales.",
      "", "<b>Si se suspende un partido</b>",
      "• Lo revisa la administración: puede anularlo (0 puntos para todos en ese partido) o mantenerlo si se juega.",
    );
  }
  lines.push("", money ? "<b>¿Cómo me pagan?</b>" : "<b>Cómo recibes tu premio</b>");
  lines.push(money
    ? "• Si ganas, te enviamos el dinero a tu cuenta Nequi o Bancolombia. Registra tu cuenta en 👤 Mi perfil para que el pago no se demore."
    : "• Si ganas, el administrador coordina contigo la entrega.");

  const P = shortId(polla.id);
  const buttons: Keyboard = [];
  if (money) buttons.push([{ text: "💰 Registrar cuenta para premios", callback_data: "pay" }]);
  buttons.push([{ text: "⬅️ Volver a la polla", callback_data: cb("p", P) }]);
  await show(ctx, { text: lines.join("\n").slice(0, 4000), buttons });
}

// ── Tabla ───────────────────────────────────────────────────────────────────

const MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

export async function showTable(ctx: PlayerCtx, polla: CasaPolla): Promise<void> {
  const [rows, entry] = await Promise.all([
    getLeaderboard(polla.id),
    polla.kind === "rifa" ? Promise.resolve(null) : getMyEntry(polla.id, ctx.account.userId),
  ]);
  const P = shortId(polla.id);
  const lines = [`<b>Tabla de posiciones · ${esc(polla.name)}</b>`];
  // La tabla solo muestra pagos confirmados: quien está en revisión no se ve
  // y tiene que saber por qué.
  if (entry?.status === "pendiente" && entry.proof_path) lines.push("", COPY.pendingPoints);
  if (rows.length === 0) {
    lines.push("", "Todavía no hay inscritos con pago confirmado.");
  } else {
    lines.push(`${rows.length} ${rows.length === 1 ? "participante" : "participantes"}`, "");
    for (const row of rows.slice(0, 15)) {
      const mark = MEDALS[row.puesto] ?? `${row.puesto}.`;
      const me = row.user_id === ctx.account.userId ? " ← tú" : "";
      lines.push(`${mark} ${esc(row.display_name ?? "Sin nombre")} — ${pts(row.points)}${me}`);
    }
    const mine = rows.filter((r) => r.user_id === ctx.account.userId);
    if (mine.length > 0 && !rows.slice(0, 15).some((r) => r.user_id === ctx.account.userId)) {
      const best = mine[0];
      lines.push("…", `Tú: puesto ${best.puesto} de ${rows.length} · ${pts(best.points)}`);
    }
    if (rows.every((r) => r.points === 0)) lines.push("", "La tabla se mueve cuando terminen y se verifiquen los primeros partidos.");
  }
  await show(ctx, {
    text: lines.join("\n"),
    buttons: [[{ text: "🔄 Actualizar", callback_data: cb("tb", P) }], [{ text: "⬅️ Volver a la polla", callback_data: cb("p", P) }]],
  });
}

// ── Mis pagos ───────────────────────────────────────────────────────────────

type PaymentRow = {
  id: string;
  polla_id: string;
  status: string;
  proof_path: string | null;
  reject_reason: string | null;
  ticket_number: number | null;
  entry_number?: number | null;
  created_at: string;
  casa_pollas: { name: string; status: string; kind: string; archived_at: string | null } | Array<{ name: string; status: string; kind: string; archived_at: string | null }> | null;
};

export async function showPayments(ctx: PlayerCtx): Promise<void> {
  const { data, error } = await ctx.db.from("casa_entries")
    .select("id, polla_id, status, proof_path, reject_reason, ticket_number, entry_number, created_at, casa_pollas!inner(name, status, kind, archived_at)")
    .eq("user_id", ctx.account.userId)
    .is("casa_pollas.archived_at", null)
    .in("casa_pollas.status", ["abierta", "cerrada", "resuelta"])
    .order("created_at", { ascending: false })
    .limit(15);
  if (error) {
    console.warn("[telegram-player] pagos no leídos:", error.code);
    await show(ctx, { text: COPY.failure });
    return;
  }
  const rows = (data ?? []) as PaymentRow[];
  if (rows.length === 0) {
    await show(ctx, {
      text: "<b>Mis pagos</b>\n\nTodavía no has enviado comprobantes. Cuando te inscribas a una polla, aquí ves si ya confirmamos tu pago.",
      buttons: [[{ text: MENU_LABELS.abiertas, callback_data: cb("ol", 0) }]],
    });
    return;
  }
  const lines = ["<b>Mis pagos</b>", ""];
  const buttons: Keyboard = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const polla = Array.isArray(row.casa_pollas) ? row.casa_pollas[0] : row.casa_pollas;
    if (!polla) continue;
    // Migración 131: varias participaciones por persona se distinguen por número.
    const label = `${esc(polla.name)}${row.ticket_number != null ? ` (boleta ${row.ticket_number})` : row.entry_number != null && rows.some((other) => other !== row && other.polla_id === row.polla_id && other.ticket_number == null) ? ` (cupo ${row.entry_number})` : ""}`;
    let state: string;
    let actionable = false;
    if (row.status === "pagada") state = "✅ confirmado";
    else if (row.status === "pendiente" && row.proof_path) state = "⏳ en revisión";
    else if (row.status === "rechazada") { state = `❌ rechazado${row.reject_reason ? `: ${esc(row.reject_reason)}` : ""}`; actionable = true; }
    else { state = "⚠️ falta el comprobante"; actionable = true; }
    lines.push(`• ${label}\n   ${state}`);
    if (!seen.has(row.polla_id)) {
      seen.add(row.polla_id);
      buttons.push([{ text: buttonText(`${actionable && polla.status === "abierta" ? "📸" : "👉"} ${polla.name}`), callback_data: cb("p", shortId(row.polla_id)) }]);
    }
  }
  lines.push("", "Revisamos cada comprobante a mano. Cuando lo confirmemos o haya un problema, te avisamos por este chat.");
  await show(ctx, { text: lines.join("\n").slice(0, 4000), buttons: buttons.slice(0, 10) });
}

// ── Ayuda e inicio ──────────────────────────────────────────────────────────

export async function showHelp(ctx: PlayerCtx): Promise<void> {
  const support = `${loginLinkOrigin("es", ctx.env)}/soporte`;
  await show(ctx, {
    text: [
      "<b>Cómo funciona</b>",
      "",
      `1. Toca <b>${MENU_LABELS.abiertas}</b> y elige una polla.`,
      "2. Toca <b>Inscribirme</b>, transfiere el valor de la entrada a la cuenta que te mostramos y envía aquí la foto del comprobante.",
      "3. Revisamos tu pago y te avisamos por este chat.",
      `4. Pronostica antes de cada partido: se cierra ${LOCK_MINUTES} minutos antes de empezar.`,
      "5. Mira la tabla de posiciones cuando quieras.",
      "",
      `En <b>${MENU_LABELS.pagos}</b> ves si tu pago ya fue confirmado. En <b>${MENU_LABELS.perfil}</b> cambias tu nombre, tu pollito y la cuenta donde recibes premios.`,
      "",
      `¿Tienes un problema? Escríbenos en ${esc(support)}`,
    ].join("\n"),
    buttons: [[{ text: MENU_LABELS.abiertas, callback_data: cb("ol", 0) }], ...urlRow("🌐 Soporte", support)],
  });
}
