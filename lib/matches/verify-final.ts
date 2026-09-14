// lib/matches/verify-final.ts — Verificación del resultado final antes de
// puntuar (final_verified_at).
//
// API-Football es la única fuente (2026-09-13). Las filas vinculadas a un
// fixture ('apifootball:<id>' en external_id o source_external_ids) se
// emparejan por id + competición; las viejas sin vínculo, por nombres,
// competición y saque. Un resultado exige dos lecturas separadas del proveedor
// con el mismo marcador de 90'; un snapshot guardado puede vetar, nunca
// confirmar. Releer la respuesta cacheada no es una segunda observación.
//
// Extras (120', penales, quién avanza) y marcador de 90' se escriben juntos por
// finalize_verified_match_result (093), que serializa contra el vivo y rechaza
// una fila ya verificada. Llamado desde /api/matches/sync-live cada minuto.

import { matchesEnJuego } from "./en-juego";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyAdmin } from "@/lib/notifications/admin-alert";
import {
  loadCachedDailyResults, loadDailyResults, loadFixturesByIds, type DailyResults, type FixtureObservation,
} from "@/lib/api-football/daily-results";
import {
  confirmedObservation, linkedFixtureId, readFinalResult, resolveResultFixture, scorePair,
} from "@/lib/api-football/results";
import { RESULT_LEAGUES } from "@/lib/api-football/leagues";

export interface VerifyResult {
  match_id: string;
  external_id: string | null;
  status: "verified" | "pending" | "discrepancy" | "error";
  notes: string;
}

interface MatchRow {
  id: string;
  external_id: string | null;
  tournament: string;
  phase: string | null;
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
  status: string;
  scheduled_at: string;
  final_verified_at: string | null;
  final_verification_notes: string | null;
  live_status_detail: string | null;
  regulation_home_score: number | null;
  regulation_away_score: number | null;
  source_external_ids: string[] | null;
}

// Fases de knockout (16vos en adelante). Solo para estos partidos se guardan
// el marcador de 120', los penales y quién avanzó (migración 077).
const KNOCKOUT_PHASES = new Set([
  "round_of_32",
  "round_of_16",
  "quarter_finals",
  "semi_finals",
  "third_place",
  "final",
]);

// Detalles de vivo que indican alargue/penales (los escribe live.ts; filas
// históricas los traen con el mismo vocabulario).
const ET_STATUS_DETAILS = new Set([
  "STATUS_END_OF_REGULATION",
  "STATUS_OVERTIME",
  "STATUS_FIRST_HALF_EXTRA_TIME",
  "STATUS_HALFTIME_ET",
  "STATUS_SECOND_HALF_EXTRA_TIME",
  "STATUS_END_OF_EXTRA_TIME",
  "STATUS_SHOOTOUT",
  "STATUS_FINAL_PEN",
  "STATUS_FINAL_AET",
]);

const COLS =
  "id, external_id, tournament, phase, home_team, away_team, home_score, away_score, status, scheduled_at, final_verified_at, final_verification_notes, live_status_detail, regulation_home_score, regulation_away_score, source_external_ids";
const KICKOFF_TOLERANCE_MS = 2 * 60 * 60 * 1000;
const utcDate = (iso: string) => new Date(iso).toISOString().slice(0, 10);

// Freno a cierres atascados (2026-09-14, migración 123). Un partido que no se
// logra confirmar pedía el feed de su fecha cada minuto (~940 consultas/día).
// Tras STUCK_AFTER_ATTEMPTS intentos sin cerrar, sus consultas propias se
// espacian a STUCK_SPACING_MS y el admin recibe un aviso, una sola vez por
// partido. Un intento es una lectura nueva del proveedor (no un tick que relee
// la caché dentro del TTL) y cuenta solo cuando el partido ya debería tener resultado
// (fila finished, lectura final del proveedor o saque hace más de 4 h): el
// cierre normal necesita dos lecturas y nunca llega al freno, y los minutos de
// juego o alargue no suman intentos. Mientras está espaciado sigue usando el
// feed que otro proceso ya refrescó, sin gastar cuota.
export const STUCK_AFTER_ATTEMPTS = 5;
export const STUCK_SPACING_MS = 15 * 60 * 1000;
const SHOULD_HAVE_RESULT_MS = 4 * 60 * 60 * 1000;
// fetchedAt sale del reloj del servidor y last_attempt_at del de Postgres: una
// lectura cuenta como nueva solo si es al menos 30 s posterior al último intento.
const READ_CLOCK_SKEW_MS = 30_000;
interface AttemptState { attempts: number; last_attempt_at: string }

/**
 * Candidates: in a polla (P2P or Casa), unverified, 105 min after kickoff,
 * last 7 days. Every status is resolved by API-Football alone:
 *   · d-1..d  → the shared daily feed (one reservation per date).
 *   · older, or linked but absent from its date feed → /fixtures?ids= in
 *     batches of 20 (loadFixturesByIds, reserved per fixture).
 * A tick without a fresh observation writes nothing, so the first-read marker
 * survives until the reservation TTL allows the second fetch.
 */
export async function verifyPendingFinals(): Promise<VerifyResult[]> {
  const admin = createAdminClient();
  const { filas: candidates, errores } = await matchesEnJuego<MatchRow>(admin, COLS, (q) =>
    q
      .in("status", ["finished", "live", "scheduled"])
      .is("final_verified_at", null)
      .lte("scheduled_at", new Date(Date.now() - 105 * 60000).toISOString())
      .gte("scheduled_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
  );
  if (errores.length > 0) console.error("[verify-final] db query:", errores.join(" | "));
  if (candidates.length === 0) return [];

  const today = utcDate(new Date().toISOString());
  const yesterday = utcDate(new Date(Date.now() - 86400000).toISOString());
  const attempts = await loadAttempts(admin, candidates.map((m) => m.id));
  const due = (match: MatchRow) => {
    const state = attempts.get(match.id);
    return !state || state.attempts < STUCK_AFTER_ATTEMPTS
      || Date.now() - Date.parse(state.last_attempt_at) >= STUCK_SPACING_MS;
  };
  const dueCandidates = candidates.filter(due);
  const daily: Map<string, DailyResults> = await loadDailyResults(dueCandidates);
  const spacedDates = candidates.filter((m) => !due(m)).map((m) => utcDate(m.scheduled_at)).filter((d) => !daily.has(d));
  if (spacedDates.length > 0) {
    for (const [date, feed] of await loadCachedDailyResults(spacedDates)) daily.set(date, feed);
  }
  const observed = new Map<string, FixtureObservation>();
  const byIdRequest = new Map<string, number>();
  for (const match of candidates) {
    const linked = linkedFixtureId(match);
    if (linked === "ambiguous") continue;
    const date = utcDate(match.scheduled_at);
    const feed = daily.get(date);
    const fixture = feed ? resolveResultFixture(match, feed.fixtures) : null;
    if (fixture && feed) observed.set(match.id, { fixture, fetchedAt: feed.fetchedAt });
    else if (typeof linked === "number" && due(match) && (feed || (date !== today && date !== yesterday))) {
      byIdRequest.set(match.id, linked);
    }
  }
  const byId = await loadFixturesByIds(Array.from(byIdRequest.values()));

  const results: VerifyResult[] = [];
  for (const match of candidates) {
    const linked = linkedFixtureId(match);
    const base: VerifyResult = { match_id: match.id, external_id: match.external_id, status: "pending", notes: "" };
    const alertedSuffix = (match.final_verification_notes ?? "").match(/ alerted=[^ ]+/)?.[0] ?? "";
    try {
      if (linked === "ambiguous") {
        base.status = "discrepancy";
        base.notes = "API-Football: la fila está vinculada a dos fixtures distintos. No se puntúa; resolver en /admin/discrepancias.";
        await alertOnce(admin, match, base.notes, alertedSuffix);
        results.push(base);
        continue;
      }
      const requestedId = byIdRequest.get(match.id);
      const observation = observed.get(match.id) ?? (requestedId !== undefined ? byId.get(requestedId) : undefined);
      if (!observation) {
        // No fresh provider data this tick: never overwrite notes (keeps afseen).
        if (match.status === "finished") {
          base.notes = "API-Football: sin lectura nueva en este ciclo.";
          results.push(base);
        }
        continue;
      }
      if (match.status !== "finished" && !readFinalResult(observation.fixture)) continue;
      results.push(await verifyOneMatch(admin, match, observation, typeof linked === "number", alertedSuffix));
    } catch {
      results.push({ ...base, status: "error", notes: "No se pudo guardar la verificación; se reintentará." });
    }
  }

  const verified = new Set(results.filter((r) => r.status === "verified").map((r) => r.match_id));
  const attempted = dueCandidates.filter((match) => {
    if (verified.has(match.id)) return false;
    const requestedId = byIdRequest.get(match.id);
    const observation = observed.get(match.id) ?? (requestedId !== undefined ? byId.get(requestedId) : undefined);
    // Solo cuenta una lectura NUEVA del proveedor, posterior al último intento:
    // releer la caché mientras corre el TTL de la reserva (20 min del feed en
    // Free, 1 h del detalle por id) no es un intento, ni un tick sin lectura.
    const readAt = observation?.fetchedAt ?? daily.get(utcDate(match.scheduled_at))?.fetchedAt;
    const last = attempts.get(match.id)?.last_attempt_at;
    if (!readAt || (last !== undefined && Date.parse(readAt) <= Date.parse(last) + READ_CLOCK_SKEW_MS)) return false;
    return match.status === "finished" || (observation !== undefined && readFinalResult(observation.fixture) !== null)
      || Date.now() - Date.parse(match.scheduled_at) >= SHOULD_HAVE_RESULT_MS;
  });
  await noteAttempts(admin, attempted);
  return results;
}

async function loadAttempts(
  admin: ReturnType<typeof createAdminClient>,
  ids: string[],
): Promise<Map<string, AttemptState>> {
  const map = new Map<string, AttemptState>();
  try {
    const { data } = await admin.from("api_football_verify_attempts")
      .select("match_id, attempts, last_attempt_at").in("match_id", ids);
    for (const row of (Array.isArray(data) ? data : []) as (AttemptState & { match_id: string })[]) {
      if (Number.isInteger(row.attempts) && Number.isFinite(Date.parse(row.last_attempt_at))) map.set(row.match_id, row);
    }
  } catch {
    // Sin estado se consulta como siempre: preferible gastar cuota a frenar un cierre.
  }
  return map;
}

/** Suma un intento por partido y avisa al admin una sola vez (reclamo atómico en la 123). */
async function noteAttempts(admin: ReturnType<typeof createAdminClient>, matches: MatchRow[]): Promise<void> {
  if (matches.length === 0) return;
  const ids = matches.map((m) => m.id);
  let rows: unknown = null;
  try {
    const { data, error } = await admin.rpc("note_api_football_verify_attempts", {
      p_match_ids: ids, p_alertable: ids, p_alert_after: STUCK_AFTER_ATTEMPTS,
    });
    if (!error) rows = data;
  } catch {
    return;
  }
  if (!Array.isArray(rows)) return;
  for (const row of rows as { match_id: string; attempts: number; alert: boolean }[]) {
    if (row.alert !== true) continue;
    const match = matches.find((m) => m.id === row.match_id);
    if (!match) continue;
    const lastNote = (match.final_verification_notes ?? "").replace(/ (afseen|alerted)=\S+/g, "").trim();
    try {
      await notifyAdmin({
        title: `Resultado sin confirmar: ${match.home_team} vs ${match.away_team}`,
        body: `El resultado lleva ${row.attempts} lecturas sin poder confirmarse con API-Football. `
          + `Desde ahora se consulta cada 15 minutos para cuidar la cuota.\n\nÚltima nota: ${lastNote || "sin nota"}`
          + `\n\nMatch ID: ${match.id}\nKickoff: ${match.scheduled_at}\n\nRevísalo en /admin/discrepancias.`,
        category: "verification_timeout",
      });
    } catch (err) {
      console.error("[verify-final] notifyAdmin failed:", err);
    }
  }
}

async function verifyOneMatch(
  admin: ReturnType<typeof createAdminClient>,
  match: MatchRow,
  { fixture, fetchedAt }: FixtureObservation,
  linked: boolean,
  alertedSuffix: string,
): Promise<VerifyResult> {
  const result: VerifyResult = { match_id: match.id, external_id: match.external_id, status: "pending", notes: "" };
  const previousNotes = match.final_verification_notes ?? "";
  const af = readFinalResult(fixture);
  if (!af) {
    result.notes = `API-Football todavía no entrega un resultado final utilizable (estado ${fixture.fixture.status.short}).`;
    await persistNote(admin, match.id, result.notes + alertedSuffix);
    return result;
  }
  // An id pointing at another league's fixture is a bad link, never a result
  // for this row.
  if (linked && fixture.league?.id !== RESULT_LEAGUES[match.tournament]) {
    result.status = "discrepancy";
    result.notes = `API-Football: el fixture ${fixture.fixture.id} es de otra competición (liga ${fixture.league?.id}). No se puntúa; resolver en /admin/discrepancias.`;
    await alertOnce(admin, match, result.notes, alertedSuffix);
    return result;
  }
  // An id link never skips the kickoff part of identity: a fixture played at
  // another time than the stored calendar waits for the calendar refresh.
  if (linked && Math.abs(Date.parse(fixture.fixture.date) - Date.parse(match.scheduled_at)) > KICKOFF_TOLERANCE_MS) {
    result.notes = `API-Football: el saque del fixture ${fixture.fixture.id} (${fixture.fixture.date}) no coincide con el calendario guardado; se espera su actualización.`;
    await persistNote(admin, match.id, result.notes + alertedSuffix);
    return result;
  }
  const snapshot = { home: match.regulation_home_score, away: match.regulation_away_score };
  const etStored = scorePair(snapshot) || (match.live_status_detail !== null && ET_STATUS_DETAILS.has(match.live_status_detail));
  const snapshotConflict = scorePair(snapshot) && (snapshot.home !== af.home || snapshot.away !== af.away);
  if (snapshotConflict || (etStored && !af.wentToExtraTime)) {
    result.status = "discrepancy";
    result.notes = snapshotConflict
      ? `DISCREPANCIA — API-Football 90': ${af.home}-${af.away}; marcador guardado al final de los 90': ${snapshot.home}-${snapshot.away}. No se puntúa.`
      : `DISCREPANCIA — la fila registró alargue pero API-Football reporta final en 90' (${af.home}-${af.away}). No se puntúa.`;
    await alertOnce(admin, match, result.notes, alertedSuffix);
    return result;
  }
  const isKnockout = match.phase !== null && KNOCKOUT_PHASES.has(match.phase);
  if (isKnockout && (!af.fulltime || (fixture.fixture.status.short === "PEN" && !af.penalty))) {
    result.notes = "API-Football: faltan el marcador completo o los penales; esperando confirmación.";
    await persistNote(admin, match.id, result.notes + alertedSuffix);
    return result;
  }
  if (!confirmedObservation(previousNotes, fixture.fixture.id, af.home, af.away, fetchedAt)) {
    // Keep the newest read of this same score; an older cached response never replaces it.
    const seen = previousNotes.match(/ afseen=(\d+):(\d+)-(\d+)@(\S+)/);
    const keep = seen !== null && Number(seen[1]) === fixture.fixture.id && Number(seen[2]) === af.home
      && Number(seen[3]) === af.away && Date.parse(seen[4]) > Date.parse(fetchedAt);
    const marker = keep ? seen![0] : ` afseen=${fixture.fixture.id}:${af.home}-${af.away}@${fetchedAt}`;
    result.notes = `API-Football 90': ${af.home}-${af.away}; esperando otra lectura del proveedor.`;
    await persistNote(admin, match.id, result.notes + marker + alertedSuffix);
    return result;
  }
  // Match winner != aggregate qualifier: only a decisive shootout names the advancer.
  const advancer: "home" | "away" | null = isKnockout && af.penalty && af.penalty.home !== af.penalty.away
    ? af.penalty.home > af.penalty.away ? "home" : "away" : null;
  result.notes = `Verificado API-Football: 90' ${af.home}-${af.away}, 1X2=${af.outcome}; dos lecturas del proveedor`
    + (af.wentToExtraTime && af.fulltime ? ` (${fixture.fixture.status.short}, final ${af.fulltime.home}-${af.fulltime.away} — los puntos usan el 90').` : ".");
  const { data: finalized, error } = await admin.rpc("finalize_verified_match_result", {
    p_match_id: match.id, p_home_score: af.home, p_away_score: af.away, p_notes: result.notes,
    p_fulltime_home: isKnockout ? af.fulltime?.home ?? null : null,
    p_fulltime_away: isKnockout ? af.fulltime?.away ?? null : null,
    p_penalty_home: isKnockout ? af.penalty?.home ?? null : null,
    p_penalty_away: isKnockout ? af.penalty?.away ?? null : null,
    p_advancer: advancer,
  });
  if (error) throw new Error("API-Football finalization failed");
  result.status = finalized === true ? "verified" : "pending";
  if (finalized !== true) result.notes = "Otro proceso ya verificó el partido o dejó de estar disponible.";
  return result;
}

/** Notifica al admin una sola vez por match (gate via "alerted=" en notes). */
async function alertOnce(
  admin: ReturnType<typeof createAdminClient>,
  match: MatchRow,
  notes: string,
  alertedSuffix: string,
): Promise<void> {
  const alreadyAlerted = !!alertedSuffix;
  if (!alreadyAlerted) {
    try {
      await notifyAdmin({
        title: `Discrepancia de score: ${match.home_team} vs ${match.away_team}`,
        body:
          notes +
          `\n\nMatch ID: ${match.id}\nKickoff: ${match.scheduled_at}\n\nResuélvelo desde /admin/discrepancias.`,
        category: "score_mismatch",
      });
    } catch (err) {
      console.error("[verify-final] notifyAdmin failed:", err);
    }
    await admin
      .from("matches")
      .update({
        final_verification_notes: `${notes} alerted=${new Date().toISOString()}`,
      })
      .eq("id", match.id).is("final_verified_at", null);
  } else {
    await admin
      .from("matches")
      .update({
        final_verification_notes: `${notes}${alertedSuffix}`,
      })
      .eq("id", match.id).is("final_verified_at", null);
  }
}

async function persistNote(
  admin: ReturnType<typeof createAdminClient>,
  matchId: string,
  note: string,
): Promise<void> {
  await admin
    .from("matches")
    .update({ final_verification_notes: note })
    .eq("id", matchId).is("final_verified_at", null);
}
