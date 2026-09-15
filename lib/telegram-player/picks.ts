// lib/telegram-player/picks.ts — Pronosticar desde Telegram.
//
// Un partido (o una pregunta) por mensaje, con botones grandes: la persona toca
// quién gana, o los goles de cada equipo (0–9), y el bot pasa solo al siguiente
// que le falta. Todo se guarda con saveCasaPicks (lib/casa/picks-save.ts), el
// mismo camino de la web: mismas reglas de inscripción, cierre de 5 minutos y
// partidos anulados. Antes de mostrar o guardar se vuelve a leer el estado real
// del partido: un botón viejo nunca guarda un pronóstico cerrado.

import { getMyEntry, getMyPicks, getPollaById, getPollaMatches, getPollaQuestions } from "@/lib/casa/queries";
import { formatMatchTime } from "@/lib/casa/format";
import { entryCanPick, pollaAcceptsPicks, saveCasaPicks, type CasaPickInput } from "@/lib/casa/picks-save";
import { canEditCasaMatch, hasCasaMatchStarted } from "@/lib/casa/match-rules";
import { isPollaOpen, LOCK_MINUTES, type CasaPick, type CasaPolla, type CasaQuestion } from "@/lib/casa/types";
import { cb, longId, shortId } from "./ids";
import { COPY } from "./copy";
import { buttonText, clearFlow, esc, sendScreen, setFlow, show, type Keyboard, type PlayerCtx } from "./context";
import { backToPolla, showPollaDetail } from "./pollas";

type PollaMatch = Awaited<ReturnType<typeof getPollaMatches>>[number];

/** "Manchester City FC" → "Manchester City" (mismo criterio que PicksBoard). */
export function shortTeam(name: string): string {
  return name.replace(/\s+(FC|CF|AFC|SC|AC|SAD)$/i, "").replace(/^(FC|CF|AFC|SC|AC)\s+/i, "").trim();
}

function pickLabel(polla: Pick<CasaPolla, "scoring_mode">, match: PollaMatch, pick: CasaPick | undefined): string | null {
  if (!pick) return null;
  if (polla.scoring_mode === "marcador") {
    return pick.home_score != null && pick.away_score != null
      ? `${shortTeam(match.home_team)} ${pick.home_score} - ${pick.away_score} ${shortTeam(match.away_team)}`
      : null;
  }
  if (pick.pick_1x2 === "L") return `gana ${shortTeam(match.home_team)}`;
  if (pick.pick_1x2 === "V") return `gana ${shortTeam(match.away_team)}`;
  if (pick.pick_1x2 === "E") return "empate";
  return null;
}

async function loadPickContext(ctx: PlayerCtx, polla: CasaPolla) {
  const [entry, matches, picks] = await Promise.all([
    getMyEntry(polla.id, ctx.account.userId),
    getPollaMatches(polla.id),
    getMyPicks(polla.id, ctx.account.userId),
  ]);
  const byMatch = new Map(picks.filter((p) => p.match_id).map((p) => [p.match_id as string, p]));
  return { entry, matches, byMatch };
}

/** Guardas de entrada comunes: inscripción y polla que recibe pronósticos. */
/** Por qué esta inscripción todavía no puede pronosticar, en palabras de la persona. */
export function cannotPickReason(entry: { status: string; proof_path: string | null } | null, verb: "pronosticar" | "responder"): string {
  if (!entry) return `Para ${verb} primero tienes que inscribirte y enviar el comprobante.`;
  if (entry.status === "rechazada") return `Tu pago fue rechazado. Envía el comprobante correcto para volver a ${verb}; lo que ya guardaste se conserva.`;
  return `Tu comprobante no alcanzó a guardarse. Envíalo de nuevo para ${verb}; si ya transferiste, no repitas el pago.`;
}

async function guard(ctx: PlayerCtx, polla: CasaPolla, entry: Awaited<ReturnType<typeof getMyEntry>>): Promise<boolean> {
  if (!entryCanPick(entry)) {
    await showPollaDetail(ctx, polla, cannotPickReason(entry, "pronosticar"));
    return false;
  }
  if (!pollaAcceptsPicks(polla)) {
    await showPollaDetail(ctx, polla, "Esta polla ya no recibe pronósticos.");
    return false;
  }
  return true;
}

function nextPendingMatch(matches: PollaMatch[], byMatch: Map<string, CasaPick>, afterId?: string | null): PollaMatch | null {
  const pending = matches.filter((m) => canEditCasaMatch(m) && !byMatch.has(m.id));
  if (pending.length === 0) return null;
  if (!afterId) return pending[0];
  const afterIndex = matches.findIndex((m) => m.id === afterId);
  return pending.find((m) => matches.indexOf(m) > afterIndex) ?? pending.find((m) => m.id !== afterId) ?? pending[0];
}

async function renderMatch(ctx: PlayerCtx, polla: CasaPolla, matches: PollaMatch[], match: PollaMatch, pick: CasaPick | undefined, notice?: string): Promise<void> {
  const P = shortId(polla.id);
  const M = shortId(match.id);
  const index = matches.findIndex((m) => m.id === match.id) + 1;
  const current = pickLabel(polla, match, pick);
  const header = [
    notice ? `${notice}\n` : null,
    `<b>${esc(polla.name)}</b> · partido ${index} de ${matches.length}`,
    "",
    `<b>${esc(match.home_team)} vs ${esc(match.away_team)}</b>`,
    `📅 ${esc(formatMatchTime(match.scheduled_at, match.scheduled_at_confirmed !== false))}`,
    `<i>Se cierra ${LOCK_MINUTES} minutos antes de empezar.</i>`,
    current ? `\nTu pronóstico actual: <b>${esc(current)}</b>` : null,
  ];
  const nav: Keyboard = [
    [{ text: "⏭ Saltar", callback_data: cb("sk", P, M) }, { text: "📋 Ver todos", callback_data: cb("ls", P) }],
    backToPolla(polla),
  ];
  if (polla.scoring_mode === "marcador") {
    await setFlow(ctx, "score", { p: polla.id, m: match.id });
    await show(ctx, {
      text: [...header, "", `¿Cuántos goles hace <b>${esc(shortTeam(match.home_team))}</b>?`, "<i>También puedes escribir el marcador completo, por ejemplo 2-1.</i>"]
        .filter((l) => l !== null).join("\n"),
      buttons: [...goalRows((g) => cb("h", P, M, g)), ...nav],
    });
    return;
  }
  await clearFlow(ctx);
  await show(ctx, {
    text: [...header, "", "¿Quién gana? Toca una opción:"].filter((l) => l !== null).join("\n"),
    buttons: [
      [{ text: buttonText(`🏠 Gana ${shortTeam(match.home_team)}`), callback_data: cb("x", P, M, "L") }],
      [{ text: "🤝 Empate", callback_data: cb("x", P, M, "E") }],
      [{ text: buttonText(`✈️ Gana ${shortTeam(match.away_team)}`), callback_data: cb("x", P, M, "V") }],
      ...nav,
    ],
  });
}

function goalRows(data: (goals: number) => string): Keyboard {
  return [
    [0, 1, 2, 3, 4].map((g) => ({ text: String(g), callback_data: data(g) })),
    [5, 6, 7, 8, 9].map((g) => ({ text: String(g), callback_data: data(g) })),
  ];
}

async function showSummaryOrNext(ctx: PlayerCtx, polla: CasaPolla, afterId: string | null, notice?: string): Promise<void> {
  const { entry, matches, byMatch } = await loadPickContext(ctx, polla);
  if (!(await guard(ctx, polla, entry))) return;
  const next = nextPendingMatch(matches, byMatch, afterId);
  if (next) {
    await renderMatch(ctx, polla, matches, next, byMatch.get(next.id), notice);
    return;
  }
  await clearFlow(ctx);
  const P = shortId(polla.id);
  const openCount = matches.filter((m) => canEditCasaMatch(m)).length;
  await show(ctx, {
    text: [
      notice ? `${notice}\n` : null,
      `<b>${esc(polla.name)}</b>`,
      "",
      matches.length === 0
        ? "El administrador todavía no publica los partidos de esta polla."
        : openCount > 0
          ? `✅ Ya tienes pronóstico en todos los partidos abiertos. Puedes cambiarlos hasta ${LOCK_MINUTES} minutos antes de cada partido.`
          : "No hay partidos abiertos para pronosticar en este momento.",
    ].filter((l) => l !== null).join("\n"),
    buttons: [
      [{ text: "📋 Ver o cambiar mis pronósticos", callback_data: cb("ls", P) }],
      [{ text: "🏆 Tabla", callback_data: cb("tb", P) }],
      backToPolla(polla),
    ],
  });
}

/** Botón «Pronosticar»: el primer partido que te falta. */
export async function startPicks(ctx: PlayerCtx, polla: CasaPolla): Promise<void> {
  if (polla.kind === "manual") return startQuestions(ctx, polla);
  if (polla.kind !== "partidos") return showPollaDetail(ctx, polla);
  await showSummaryOrNext(ctx, polla, null);
}

export async function skipMatch(ctx: PlayerCtx, polla: CasaPolla, matchShort: string | undefined): Promise<void> {
  const matchId = longId(matchShort);
  const { entry, matches, byMatch } = await loadPickContext(ctx, polla);
  if (!(await guard(ctx, polla, entry))) return;
  const pending = matches.filter((m) => canEditCasaMatch(m) && !byMatch.has(m.id));
  const next = nextPendingMatch(matches, byMatch, matchId);
  if (next && next.id === matchId && pending.length === 1) {
    await renderMatch(ctx, polla, matches, next, undefined, "Es el único partido abierto que te falta.");
    return;
  }
  if (next) {
    await renderMatch(ctx, polla, matches, next, byMatch.get(next.id));
    return;
  }
  await showSummaryOrNext(ctx, polla, matchId);
}

/** Abrir un partido puntual (desde «Ver todos» o «Corregir»). */
export async function editMatch(ctx: PlayerCtx, polla: CasaPolla, matchShort: string | undefined): Promise<void> {
  const matchId = longId(matchShort);
  const { entry, matches, byMatch } = await loadPickContext(ctx, polla);
  if (!(await guard(ctx, polla, entry))) return;
  const match = matches.find((m) => m.id === matchId);
  if (!match || !canEditCasaMatch(match)) {
    await listPicks(ctx, polla, "Ese partido ya cerró sus pronósticos.");
    return;
  }
  await renderMatch(ctx, polla, matches, match, byMatch.get(match.id));
}

async function save(ctx: PlayerCtx, polla: CasaPolla, input: CasaPickInput, matchId: string, doneNotice: string): Promise<void> {
  const result = await saveCasaPicks(polla, ctx.account.userId, [input], ctx.db);
  if (!result.ok) {
    await showSummaryOrNext(ctx, polla, matchId, `⚠️ ${esc(result.error)}`);
    return;
  }
  await showSummaryOrNext(ctx, polla, matchId, `✅ Guardado: ${esc(doneNotice)}`);
}

export async function save1x2(ctx: PlayerCtx, polla: CasaPolla, matchShort: string | undefined, choice: string | undefined): Promise<void> {
  const matchId = longId(matchShort);
  if (!matchId || (choice !== "L" && choice !== "E" && choice !== "V") || polla.scoring_mode !== "1x2") {
    await showSummaryOrNext(ctx, polla, null, COPY.expiredButton);
    return;
  }
  const matches = await getPollaMatches(polla.id);
  const match = matches.find((m) => m.id === matchId);
  const label = !match ? "" : `${shortTeam(match.home_team)} vs ${shortTeam(match.away_team)}: ${choice === "E" ? "empate" : `gana ${shortTeam(choice === "L" ? match.home_team : match.away_team)}`}`;
  await save(ctx, polla, { matchId, pick1x2: choice }, matchId, label);
}

export async function chooseHomeGoals(ctx: PlayerCtx, polla: CasaPolla, matchShort: string | undefined, goals: string | undefined): Promise<void> {
  const matchId = longId(matchShort);
  const home = Number(goals);
  const { entry, matches, byMatch } = await loadPickContext(ctx, polla);
  if (!(await guard(ctx, polla, entry))) return;
  const match = matches.find((m) => m.id === matchId);
  if (!match || !Number.isInteger(home) || home < 0 || home > 9 || polla.scoring_mode !== "marcador") {
    await showSummaryOrNext(ctx, polla, null, COPY.expiredButton);
    return;
  }
  if (!canEditCasaMatch(match)) {
    await showSummaryOrNext(ctx, polla, match.id, "⚠️ Ese partido ya cerró sus pronósticos.");
    return;
  }
  const P = shortId(polla.id);
  const M = shortId(match.id);
  const current = pickLabel(polla, match, byMatch.get(match.id));
  await show(ctx, {
    text: [
      `<b>${esc(match.home_team)} vs ${esc(match.away_team)}</b>`,
      current ? `Tu pronóstico actual: ${esc(current)}` : null,
      "",
      `${esc(shortTeam(match.home_team))} <b>${home}</b> - ? ${esc(shortTeam(match.away_team))}`,
      "",
      `¿Cuántos goles hace <b>${esc(shortTeam(match.away_team))}</b>?`,
    ].filter((l) => l !== null).join("\n"),
    buttons: [
      ...goalRows((g) => cb("s", P, M, home, g)),
      [{ text: buttonText(`↩️ Corregir goles de ${shortTeam(match.home_team)}`), callback_data: cb("e", P, M) }],
      backToPolla(polla),
    ],
  });
}

export async function saveScore(ctx: PlayerCtx, polla: CasaPolla, matchShort: string | undefined, homeRaw: string | undefined, awayRaw: string | undefined): Promise<void> {
  const matchId = longId(matchShort);
  const home = Number(homeRaw);
  const away = Number(awayRaw);
  if (!matchId || polla.scoring_mode !== "marcador" || ![home, away].every((g) => Number.isInteger(g) && g >= 0 && g <= 30)) {
    await showSummaryOrNext(ctx, polla, null, COPY.expiredButton);
    return;
  }
  const matches = await getPollaMatches(polla.id);
  const match = matches.find((m) => m.id === matchId);
  const label = match ? `${shortTeam(match.home_team)} ${home} - ${away} ${shortTeam(match.away_team)}` : `${home} - ${away}`;
  await save(ctx, polla, { matchId, homeScore: home, awayScore: away }, matchId, label);
}

/** Texto "2-1" con el paso «marcador» activo. */
export async function handleScoreText(ctx: PlayerCtx, text: string): Promise<boolean> {
  // «2-1», «2 x 1», «2 a 1». Sin «:» para no leer una hora («10:30») como marcador.
  const match = /^\s*(\d{1,2})\s*(?:-|–|x|a)\s*(\d{1,2})\s*$/i.exec(text);
  if (!match) return false;
  const flow = ctx.chat.flow!;
  const polla = await getPollaById(String(flow.data.p ?? ""));
  if (!polla || polla.kind !== "partidos") {
    await clearFlow(ctx);
    await sendScreen(ctx, { text: COPY.expiredButton });
    return true;
  }
  await saveScore(ctx, polla, shortId(String(flow.data.m)), match[1], match[2]);
  return true;
}

/** «Ver todos»: lista con el pronóstico, el resultado y los puntos. */
export async function listPicks(ctx: PlayerCtx, polla: CasaPolla, notice?: string): Promise<void> {
  const P = shortId(polla.id);
  const { entry, matches, byMatch } = await loadPickContext(ctx, polla);
  if (!entryCanPick(entry)) {
    await showPollaDetail(ctx, polla, "Para ver tus pronósticos primero tienes que inscribirte.");
    return;
  }
  await clearFlow(ctx);
  const lines: string[] = [];
  if (notice) lines.push(notice, "");
  lines.push(`<b>Tus pronósticos · ${esc(polla.name)}</b>`, "");
  // Regla del dueño: se pronostica desde que se envía el comprobante, pero los
  // puntos cuentan en la tabla cuando se aprueba el pago (casa_leaderboard solo
  // suma inscripciones pagadas; casa_score_polla puntúa todos los picks, así
  // que al aprobar los puntos aparecen retroactivos).
  if (entry?.status === "pendiente") lines.push(COPY.pendingPoints, "");
  const buttons: Keyboard = [];
  const acceptsPicks = pollaAcceptsPicks(polla);
  matches.slice(0, 40).forEach((m, i) => {
    const pick = byMatch.get(m.id);
    const label = pickLabel(polla, m, pick);
    const parts: string[] = [label ? `Tu pronóstico: ${esc(label)}` : "Sin pronóstico"];
    if (m.voided_at) {
      parts.push("anulado (0 puntos)");
    } else if (m.final_verified_at && m.home_score != null && m.away_score != null) {
      // Los puntos solo valen con el resultado verificado (points_earned=0 es
      // ambiguo antes de eso).
      parts.push(`terminó ${m.home_score}-${m.away_score}`, pick ? `+${pick.points_earned} ${pick.points_earned === 1 ? "punto" : "puntos"}` : "0 puntos");
    } else if (hasCasaMatchStarted(m)) {
      parts.push(m.status === "live" && m.home_score != null && m.away_score != null ? `en juego ${m.home_score}-${m.away_score}` : "esperando resultado");
    } else if (canEditCasaMatch(m)) {
      parts.push("abierto");
      if (acceptsPicks && buttons.length < 20) {
        buttons.push([{ text: buttonText(`✏️ ${i + 1}. ${shortTeam(m.home_team)} vs ${shortTeam(m.away_team)}`), callback_data: cb("e", P, shortId(m.id)) }]);
      }
    } else {
      parts.push("cerrado");
    }
    lines.push(`${i + 1}. <b>${esc(shortTeam(m.home_team))} vs ${esc(shortTeam(m.away_team))}</b>`, `   ${parts.join(" · ")}`);
  });
  if (matches.length === 0) lines.push("El administrador todavía no publica los partidos.");
  if (acceptsPicks && matches.some((m) => canEditCasaMatch(m) && !byMatch.has(m.id))) {
    buttons.unshift([{ text: "⚽ Pronosticar los que faltan", callback_data: cb("pk", P) }]);
  }
  buttons.push([{ text: "🏆 Tabla", callback_data: cb("tb", P) }]);
  buttons.push(backToPolla(polla));
  await show(ctx, { text: lines.join("\n").slice(0, 4000), buttons });
}

// ── Preguntas (pollas manuales) ─────────────────────────────────────────────

function answerLabel(question: CasaQuestion, pick: CasaPick | undefined): string | null {
  if (!pick) return null;
  if (pick.option_id) return question.options?.find((o) => o.id === pick.option_id)?.label ?? null;
  return pick.free_text?.trim() || null;
}

async function loadQuestions(ctx: PlayerCtx, polla: CasaPolla) {
  const [entry, questions, picks] = await Promise.all([
    getMyEntry(polla.id, ctx.account.userId),
    getPollaQuestions(polla.id),
    getMyPicks(polla.id, ctx.account.userId),
  ]);
  const byQuestion = new Map(picks.filter((p) => p.question_id).map((p) => [p.question_id as string, p]));
  return { entry, questions, byQuestion };
}

async function renderQuestion(ctx: PlayerCtx, polla: CasaPolla, questions: CasaQuestion[], question: CasaQuestion, pick: CasaPick | undefined, notice?: string): Promise<void> {
  const P = shortId(polla.id);
  const Q = shortId(question.id);
  const index = questions.findIndex((q) => q.id === question.id) + 1;
  const current = answerLabel(question, pick);
  const text = [
    notice ? `${notice}\n` : null,
    `<b>${esc(polla.name)}</b> · pregunta ${index} de ${questions.length}`,
    "",
    `<b>${esc(question.prompt)}</b>`,
    `Vale ${question.points} ${question.points === 1 ? "punto" : "puntos"}.`,
    current ? `\nTu respuesta actual: <b>${esc(current)}</b>` : null,
    "",
    question.input_kind === "texto" ? "Escribe tu respuesta y envíala." : "Toca tu respuesta:",
  ].filter((l) => l !== null).join("\n");
  const nav: Keyboard = [[{ text: "⏭ Saltar", callback_data: cb("qs", P, Q) }, { text: "📋 Mis respuestas", callback_data: cb("la", P) }], backToPolla(polla)];
  if (question.input_kind === "texto") {
    await setFlow(ctx, "answer", { p: polla.id, q: question.id });
    await show(ctx, { text, buttons: nav });
    return;
  }
  await clearFlow(ctx);
  await show(ctx, {
    text,
    buttons: [
      ...(question.options ?? []).slice(0, 20).map((o) => [{ text: buttonText(o.label, 60), callback_data: cb("qo", Q, shortId(o.id)) }]),
      ...nav,
    ],
  });
}

async function nextQuestion(ctx: PlayerCtx, polla: CasaPolla, afterId: string | null, notice?: string): Promise<void> {
  const { entry, questions, byQuestion } = await loadQuestions(ctx, polla);
  if (!entryCanPick(entry)) {
    await showPollaDetail(ctx, polla, cannotPickReason(entry, "responder"));
    return;
  }
  if (!isPollaOpen(polla)) {
    await showPollaDetail(ctx, polla, notice ?? "Esta polla ya cerró. Tus respuestas quedaron guardadas.");
    return;
  }
  const open = questions.filter((q) => !q.resolved_at);
  const pending = open.filter((q) => !answerLabel(q, byQuestion.get(q.id)));
  const afterIndex = afterId ? questions.findIndex((q) => q.id === afterId) : -1;
  const next = pending.find((q) => questions.indexOf(q) > afterIndex) ?? pending.find((q) => q.id !== afterId) ?? null;
  if (next) {
    await renderQuestion(ctx, polla, questions, next, byQuestion.get(next.id), notice);
    return;
  }
  await clearFlow(ctx);
  const P = shortId(polla.id);
  await show(ctx, {
    text: [notice ? `${notice}\n` : null, `<b>${esc(polla.name)}</b>`, "", open.length ? "✅ Ya respondiste todas las preguntas abiertas. Puedes cambiarlas hasta el cierre." : "No hay preguntas abiertas en este momento."]
      .filter((l) => l !== null).join("\n"),
    buttons: [[{ text: "📋 Ver o cambiar mis respuestas", callback_data: cb("la", P) }], backToPolla(polla)],
  });
}

export async function startQuestions(ctx: PlayerCtx, polla: CasaPolla): Promise<void> {
  await nextQuestion(ctx, polla, null);
}

export async function skipQuestion(ctx: PlayerCtx, polla: CasaPolla, questionShort: string | undefined): Promise<void> {
  await nextQuestion(ctx, polla, longId(questionShort));
}

export async function editQuestion(ctx: PlayerCtx, polla: CasaPolla, questionShort: string | undefined): Promise<void> {
  const questionId = longId(questionShort);
  const { entry, questions, byQuestion } = await loadQuestions(ctx, polla);
  if (!entryCanPick(entry) || !isPollaOpen(polla)) {
    await nextQuestion(ctx, polla, null);
    return;
  }
  const question = questions.find((q) => q.id === questionId && !q.resolved_at);
  if (!question) {
    await listAnswers(ctx, polla, "Esa pregunta ya fue resuelta.");
    return;
  }
  await renderQuestion(ctx, polla, questions, question, byQuestion.get(question.id));
}

/** Botón de una opción. La polla sale de la pregunta (no del botón). */
export async function saveOption(ctx: PlayerCtx, questionShort: string | undefined, optionShort: string | undefined): Promise<void> {
  const questionId = longId(questionShort);
  const optionId = longId(optionShort);
  if (!questionId || !optionId) {
    await show(ctx, { text: COPY.expiredButton });
    return;
  }
  const { data } = await ctx.db.from("casa_questions").select("id, polla_id").eq("id", questionId).maybeSingle();
  const polla = data ? await getPollaById((data as { polla_id: string }).polla_id) : null;
  if (!polla || polla.kind !== "manual") {
    await show(ctx, { text: COPY.expiredButton });
    return;
  }
  const result = await saveCasaPicks(polla, ctx.account.userId, [{ questionId, optionId }], ctx.db);
  await nextQuestion(ctx, polla, questionId, result.ok ? "✅ Respuesta guardada." : `⚠️ ${esc(result.error)}`);
}

/** Texto con el paso «respuesta» activo (preguntas de texto libre). */
export async function handleAnswerText(ctx: PlayerCtx, text: string): Promise<void> {
  const flow = ctx.chat.flow!;
  const polla = await getPollaById(String(flow.data.p ?? ""));
  const questionId = String(flow.data.q ?? "");
  if (!polla || polla.kind !== "manual") {
    await clearFlow(ctx);
    await sendScreen(ctx, { text: COPY.expiredButton });
    return;
  }
  const answer = text.replace(/\s+/g, " ").trim().slice(0, 120);
  const result = await saveCasaPicks(polla, ctx.account.userId, [{ questionId, freeText: answer }], ctx.db);
  await clearFlow(ctx);
  ctx.editMessageId = null;
  await nextQuestion(ctx, polla, questionId, result.ok ? `✅ Respuesta guardada: ${esc(answer)}` : `⚠️ ${esc(result.error)}`);
}

export async function listAnswers(ctx: PlayerCtx, polla: CasaPolla, notice?: string): Promise<void> {
  const P = shortId(polla.id);
  const { entry, questions, byQuestion } = await loadQuestions(ctx, polla);
  if (!entryCanPick(entry)) {
    await showPollaDetail(ctx, polla, "Para ver tus respuestas primero tienes que inscribirte.");
    return;
  }
  await clearFlow(ctx);
  const open = isPollaOpen(polla);
  const lines: string[] = [];
  if (notice) lines.push(notice, "");
  lines.push(`<b>Tus respuestas · ${esc(polla.name)}</b>`, "");
  if (entry?.status === "pendiente") lines.push(COPY.pendingPoints, "");
  const buttons: Keyboard = [];
  questions.slice(0, 30).forEach((q, i) => {
    const pick = byQuestion.get(q.id);
    const label = answerLabel(q, pick);
    const parts = [label ? `Tu respuesta: ${esc(label)}` : "Sin responder"];
    if (q.resolved_at) parts.push(pick ? `+${pick.points_earned} ${pick.points_earned === 1 ? "punto" : "puntos"}` : "0 puntos");
    else if (open && buttons.length < 20) buttons.push([{ text: buttonText(`✏️ ${i + 1}. ${q.prompt}`), callback_data: cb("qe", P, shortId(q.id)) }]);
    lines.push(`${i + 1}. <b>${esc(q.prompt)}</b>`, `   ${parts.join(" · ")}`);
  });
  if (questions.length === 0) lines.push("El administrador todavía no publica las preguntas.");
  buttons.push([{ text: "🏆 Tabla", callback_data: cb("tb", P) }]);
  buttons.push(backToPolla(polla));
  await show(ctx, { text: lines.join("\n").slice(0, 4000), buttons });
}
