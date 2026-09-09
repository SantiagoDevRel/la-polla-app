// lib/matches/verify-final.ts — Cross-check entre ESPN y football-data
// antes de declarar un match como verificado para scoring.
//
// Llamado desde el sync orquestador cuando un match transiciona a
// status='finished' o cuando un match ya finished todavía no tiene
// final_verified_at.
//
// Provider contract (2026-09-09): strict identity; 90-minute scoring;
// disagreement vetoes; a lone provider requires two separate observations.
// Stored DB scores are not independent corroboration. API-Football's cached
// response is one observation regardless of how many requests reread it.
// Extras + final score commit together through finalize_verified_match_result
// (093), which serializes against live writes and refuses an already verified row.

import { normalizeResultTeam, findEspnResult } from './result-identity';
import { fdPlayedScore, fdRegulationScore } from '@/lib/football-data/scores';
import { matchesEnJuego } from "./en-juego";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ESPN_LEAGUE_BY_TOURNAMENT,
  ESPN_ONLY_TOURNAMENTS,
  fetchEspnScoreboard,
  mapEspnStatus,
  parseEspnScore,
} from "@/lib/espn/client";
import { COMPETITIONS } from "@/lib/football-data/sync";
import { fetchCompetitionMatches, type FDMatch } from "@/lib/football-data/client";
import { notifyAdmin } from "@/lib/notifications/admin-alert";
import { apiFootballFinalsEnabled, loadDailyResults, type DailyResults } from "@/lib/api-football/daily-results";
import { confirmedObservation, findResultFixture, readFinalResult, resultTeamKey, scorePair } from "@/lib/api-football/results";

export interface VerifyResult {
  match_id: string;
  external_id: string | null;
  espn_id: string | null;
  status: "verified" | "pending" | "discrepancy" | "error";
  notes: string;
}

interface MatchRow {
  id: string;
  external_id: string | null;
  espn_id: string | null;
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
}

// Fases de knockout (16vos en adelante). Solo para estos partidos
// capturamos el marcador de 120', los penales y quién avanzó (migración
// 077): un cruce eliminatorio tiene un ganador inequívoco y puede ir a
// alargue/penales; la fase de grupos no.
const KNOCKOUT_PHASES = new Set([
  "round_of_32",
  "round_of_16",
  "quarter_finals",
  "semi_finals",
  "third_place",
  "final",
]);

/** Datos de cierre extendidos de un knockout, capturados de ESPN (migración 077). */
interface KnockoutExtras {
  fulltime_home_score: number | null; // marcador a los 120' (incluye alargue)
  fulltime_away_score: number | null;
  penalty_home: number | null; // tanda de penales
  penalty_away: number | null;
  advancer: "home" | "away" | null; // quién avanzó (incluidos penales)
}

const FD_COMPETITION_BY_TOURNAMENT: Record<string, number> = Object.fromEntries(
  COMPETITIONS.map((c) => [c.tournament, c.id]),
);

// Señales de que el partido fue a alargue/penales. Si alguna está presente,
// Exigen un marcador explícito de 90 minutos o un snapshot de fin reglamentario.
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

function hasEtSignal(match: MatchRow): boolean {
  return (
    match.regulation_home_score !== null ||
    (match.live_status_detail !== null && ET_STATUS_DETAILS.has(match.live_status_detail))
  );
}

/** Matchea un row nuestro contra la lista de matches de football-data. */
function findFdMatch(match: MatchRow, fdMatches: FDMatch[]): FDMatch | null {
  const kickMs = new Date(match.scheduled_at).getTime();
  const nh = normalizeResultTeam(match.home_team);
  const na = normalizeResultTeam(match.away_team);

  const found = fdMatches.filter((fd) => {
    const fdMs = new Date(fd.utcDate).getTime();
    if (Math.abs(fdMs - kickMs) > 3 * 60 * 60 * 1000) return false;
    return (
      normalizeResultTeam(fd.homeTeam.name) === nh &&
      normalizeResultTeam(fd.awayTeam.name) === na
    );
  });
  // A unique kickoff alone is not proof of identity across providers.
  return found.length === 1 ? found[0] : null;
}

/**
 * Para cada match en `status='finished'` con `final_verified_at IS
 * NULL`, intenta verificar contra las dos fuentes y actualiza la DB.
 * Devuelve el detalle por match para logging.
 */
export async function verifyPendingFinals(): Promise<VerifyResult[]> {
  const admin = createAdminClient();

  // Solo matches recién finalizados sin verificar QUE ESTÁN EN ALGUNA POLLA.
  // Si un match no lo juega nadie, no hay scoring que ejecutar y no vale
  // quemarle cuota a football-data.
  //
  // 🚨 (2026-09-02) SON DOS CONSULTAS, Y ESO NO ES UN CAPRICHO.
  // Hasta hoy había una sola, con `predictions!inner(id)` — o sea el modelo
  // P2P viejo. Un partido que SOLO vive en una polla de la casa se relaciona
  // por `casa_polla_matches`, nunca tiene filas en `predictions`, y el INNER
  // JOIN lo descartaba en silencio. Consecuencia en cadena:
  //   sin candidato -> nunca se escribe final_verified_at
  //   -> casa_score_polla devuelve 0 (082_casa_scoring_and_pot.sql:79 corta
  //      con `WHEN m.final_verified_at IS NULL THEN 0`)
  //   -> el trigger de la 086 tampoco dispara, porque dispara EN esa
  //      transición
  // O sea: ninguna polla de la casa habría puntuado jamás, y el único
  // desbloqueo era llamar finalize_match_result a mano por SQL.
  //
  // No se puede hacer con un OR: PostgREST no sabe expresar "inner join con A
  // O inner join con B" en un solo select. Se piden las dos listas y se
  // fusionan por id — el `seen` de abajo ya estaba preparado para deduplicar.
  const COLS =
    "id, external_id, espn_id, tournament, phase, home_team, away_team, home_score, away_score, status, scheduled_at, final_verified_at, final_verification_notes, live_status_detail, regulation_home_score, regulation_away_score";
  // Bound temporal: legacy finished-unverified de torneos viejos no deben
  // quemar cuota football-data cada minuto — esos van por el cron diario
  // de discrepancias + resolución manual.
  const desde = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { filas: candidates, errores } = await matchesEnJuego<MatchRow>(
    admin,
    COLS,
    (q) =>
      q
        .in("status", apiFootballFinalsEnabled() ? ["finished", "live", "scheduled"] : ["finished"])
        .or(`status.eq.finished,scheduled_at.gte.${new Date(Date.now() - 86400000).toISOString().slice(0, 10)}T00:00:00Z`)
        .is("final_verified_at", null)
        .lte("scheduled_at", new Date(Date.now() - (apiFootballFinalsEnabled() ? 105 * 60000 : 0)).toISOString())
        .gte("scheduled_at", desde),
  );
  if (errores.length > 0) {
    console.error("[verify-final] db query:", errores.join(" | "));
    if (candidates.length === 0) return [];
  }

  if (candidates.length === 0) return [];

  const apiFootballByDate = await loadDailyResults(candidates);

  // UN fetch a football-data por torneo por tick (no por match) — cubre
  // a todos los candidatos del torneo y respeta el rate limit de 10/min.
  const fdByTournament = new Map<string, FDMatch[] | null>();
  const uniqueTournaments = Array.from(new Set(candidates.map((c) => c.tournament)));
  for (const tournament of uniqueTournaments) {
    const compId = FD_COMPETITION_BY_TOURNAMENT[tournament];
    if (!compId || ESPN_ONLY_TOURNAMENTS.has(tournament)) continue;
    const dates = candidates
      .filter((c) => c.tournament === tournament)
      .map((c) => new Date(c.scheduled_at).getTime());
    const dateFrom = new Date(Math.min(...dates) - 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const dateTo = new Date(Math.max(...dates) + 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    try {
      fdByTournament.set(
        tournament,
        await fetchCompetitionMatches(compId, undefined, dateFrom, dateTo),
      );
    } catch (err) {
      console.error(`[verify-final] football-data fetch failed for ${tournament}:`, err);
      fdByTournament.set(tournament, null); // null = FD caído este tick
    }
  }

  // UN fetch a ESPN por torneo por tick (memoizado — antes era 1 fetch por
  // candidato y la última fecha de grupos tiene 4+ finales simultáneas).
  const espnByTournament = new Map<string, Awaited<ReturnType<typeof fetchEspnScoreboard>> | null>();
  for (const tournament of uniqueTournaments) {
    if (!ESPN_LEAGUE_BY_TOURNAMENT[tournament]) continue;
    try {
      espnByTournament.set(tournament, await fetchEspnScoreboard(tournament));
    } catch (err) {
      console.error(`[verify-final] espn fetch failed for ${tournament}:`, err);
      espnByTournament.set(tournament, null);
    }
  }

  const results: VerifyResult[] = [];
  for (const match of candidates) {
    const daily = apiFootballByDate.get(new Date(match.scheduled_at).toISOString().slice(0, 10));
    // A delayed ESPN status must not hide a final from API-Football. Without
    // an actual final response, scheduled/live rows never enter legacy scoring.
    if (match.status !== "finished") {
      const fixture = daily ? findResultFixture(match, daily.fixtures) : null;
      if (!fixture || !readFinalResult(fixture)) continue;
    }
    try {
      const result = await verifyOneMatch(
      match,
      fdByTournament.get(match.tournament),
      espnByTournament.get(match.tournament),
      daily,
    );
    results.push(result);
    } catch {
      results.push({match_id: match.id, external_id: match.external_id, espn_id: match.espn_id,
        status: "error", notes: "No se pudo guardar la verificación; se reintentará."});
    }
  }
  return results;
}

async function verifyOneMatch(
  match: MatchRow,
  fdMatches: FDMatch[] | null | undefined,
  espnEvents: Awaited<ReturnType<typeof fetchEspnScoreboard>> | null | undefined,
  daily?: DailyResults,
): Promise<VerifyResult> {
  const result: VerifyResult = {
    match_id: match.id,
    external_id: match.external_id,
    espn_id: match.espn_id,
    status: "pending",
    notes: "",
  };

  const admin = createAdminClient();

  const espnLeague = ESPN_LEAGUE_BY_TOURNAMENT[match.tournament];
  if (!espnLeague) {
    result.status = "error";
    result.notes = `No hay mapeo ESPN para tournament=${match.tournament}`;
    await persistNote(admin, match.id, result.notes);
    return result;
  }

  // 1. ESPN — buscar el evento en el scoreboard (memoizado por torneo).
  let espnFinished = false;
  let espnEt = false;
  let espnHome: number | null = null;
  let espnAway: number | null = null;
  // Extras de knockout (migración 077): el `score` de ESPN es el marcador de
  // los 120' (incluye alargue, EXCLUYE penales); shootoutScore es la tanda;
  // winner marca quién avanzó. Se capturan acá y se persisten al finalizar.
  let espnAdvancer: "home" | "away" | null = null;
  let espnPenHome: number | null = null;
  let espnPenAway: number | null = null;
  {
    const events = espnEvents ?? [];
    const event = findEspnResult(match, events);
    if (event) {
      const mapped = mapEspnStatus(event.status);
      espnFinished = mapped === "finished";
      espnEt = ET_STATUS_DETAILS.has(event.status.type.name);
      const competition = event.competitions[0];
      const home = competition?.competitors.find((c) => c.homeAway === "home");
      const away = competition?.competitors.find((c) => c.homeAway === "away");
      espnHome = parseEspnScore(home?.score);
      espnAway = parseEspnScore(away?.score);
      // Quién avanzó / tanda de penales (solo se usan en knockouts más abajo).
      if (home?.winner) espnAdvancer = "home";
      else if (away?.winner) espnAdvancer = "away";
      espnPenHome = typeof home?.shootoutScore === "number" ? home.shootoutScore : null;
      espnPenAway = typeof away?.shootoutScore === "number" ? away.shootoutScore : null;
    }
  }

  // Extras a persistir SOLO en knockouts. fulltime = score de 120' de ESPN
  // (para partidos sin alargue es el de 90', idéntico al canónico). Si ESPN
  // no apareció, quedan null y score_match degrada seguro (cae al 90' y
  // deriva el avance del marcador decisivo). Ver migración 077.
  // Solo capturamos si ESPN marcó el partido como FINISHED: si no, espnHome/away
  // sería un score en vivo/parcial (no el de 120') y el winner aún no es
  // definitivo. Sin espnFinished → null → score_match cae al 90' / snapshot.
  const knockoutExtras: KnockoutExtras | null =
    espnFinished && match.phase !== null && KNOCKOUT_PHASES.has(match.phase)
      ? {
          fulltime_home_score: espnHome,
          fulltime_away_score: espnAway,
          penalty_home: espnPenHome,
          penalty_away: espnPenAway,
          advancer: espnAdvancer,
        }
      : null;

  // Marker anti-spam: "alerted=<iso>" debe sobrevivir cualquier re-write
  // de notes — si se pierde, el próximo tick re-notifica al admin.
  const previousNotes = match.final_verification_notes ?? "";
  const previousAlertedMatch = previousNotes.match(/ alerted=[^ ]+/);
  const alertedSuffix = previousAlertedMatch ? previousAlertedMatch[0] : "";

  const afFixture = daily ? findResultFixture(match, daily.fixtures) : null;
  const etSignal = hasEtSignal(match) || espnEt || (afFixture !== null && ['AET','PEN'].includes(afFixture.fixture.status.short));
  const af = afFixture ? readFinalResult(afFixture) : null;
  if (af && afFixture && daily) {
    // FD must match BOTH team names here. Provider numeric IDs are unrelated.
    const fdCandidates = (fdMatches ?? []).filter(f => f.status === "FINISHED"
      && Math.abs(Date.parse(f.utcDate) - Date.parse(match.scheduled_at)) <= 2 * 3600000
      && resultTeamKey(f.homeTeam.name) === resultTeamKey(match.home_team)
      && resultTeamKey(f.awayTeam.name) === resultTeamKey(match.away_team));
    const fd = fdCandidates.length === 1 ? fdCandidates[0] : null;
    const fd90 = fd ? fdRegulationScore(fd.score, etSignal) : null;
    const signals: Array<{home: number; away: number}> = [];
    if (scorePair(fd90)) signals.push(fd90);
    const snapshot = {home: match.regulation_home_score, away: match.regulation_away_score};
    if (scorePair(snapshot)) signals.push(snapshot);
    if (espnFinished && !espnEt && !etSignal && !af.wentToExtraTime && scorePair({home: espnHome, away: espnAway})) {
      signals.push({home: espnHome!, away: espnAway!});
    }
    const fulltimeConflict = espnFinished && af.fulltime && espnHome !== null && espnAway !== null
      && (af.fulltime.home !== espnHome || af.fulltime.away !== espnAway);
    const fdPlayed = fd ? fdPlayedScore(fd.score) : null;
    const fdPlayedConflict = af.fulltime && fdPlayed && (af.fulltime.home !== fdPlayed.home || af.fulltime.away !== fdPlayed.away);
    const penaltySources = [fd?.score.penalties, espnFinished ? {home:espnPenHome,away:espnPenAway} : null].filter(scorePair);
    const penaltyConflict = af.penalty && penaltySources.some(p=>p.home!==af.penalty!.home || p.away!==af.penalty!.away);
    if (fulltimeConflict || fdPlayedConflict || penaltyConflict || signals.some(s => s.home !== af.home || s.away !== af.away)) {
      result.status = "discrepancy";
      result.notes = `DISCREPANCIA — API-Football 90': ${af.home}-${af.away}; otra fuente no coincide. No se puntúa.`;
      await alertOnce(admin, match, result.notes, alertedSuffix);
      return result;
    }
    if (signals.length === 0 && !confirmedObservation(previousNotes, afFixture.fixture.id, af.home, af.away, daily.fetchedAt)) {
      result.notes = `API-Football 90': ${af.home}-${af.away}; esperando otra lectura del proveedor.`;
      // Keep the FIRST observation of this score until an actual new fetch arrives.
      const marker = ` afseen=${afFixture.fixture.id}:${af.home}-${af.away}@${daily.fetchedAt}`;
      await persistNote(admin, match.id, result.notes + marker + alertedSuffix);
      return result;
    }
    const isKnockout = match.phase !== null && KNOCKOUT_PHASES.has(match.phase);
    let afAdvancer: "home" | "away" | null = null;
    if (isKnockout) {
      if (!af.fulltime || (afFixture.fixture.status.short === "PEN" && !af.penalty)) {
        result.notes = "API-Football: faltan el marcador completo o los penales; esperando confirmación.";
        await persistNote(admin, match.id, result.notes + alertedSuffix);
        return result;
      }
      // Match winner != aggregate qualifier. Only ESPN's established advance
      // signal or a decisive shootout supplies advancer; never teams.winner.
      afAdvancer = espnFinished ? espnAdvancer : af.penalty && af.penalty.home !== af.penalty.away
        ? af.penalty.home > af.penalty.away ? "home" : "away" : null;
    }
    result.notes = `Verificado API-Football: 90' ${af.home}-${af.away}, 1X2=${af.outcome}; ${signals.length ? "corroborado" : "dos lecturas del proveedor"}.`;
    const {data: finalized, error} = await admin.rpc("finalize_verified_match_result", {
      p_match_id: match.id, p_home_score: af.home, p_away_score: af.away, p_notes: result.notes,
      p_fulltime_home: isKnockout ? af.fulltime?.home ?? null : null,
      p_fulltime_away: isKnockout ? af.fulltime?.away ?? null : null,
      p_penalty_home: isKnockout ? af.penalty?.home ?? null : null,
      p_penalty_away: isKnockout ? af.penalty?.away ?? null : null,
      p_advancer: afAdvancer,
    });
    if (error) throw new Error("API-Football finalization failed");
    result.status = finalized === true ? "verified" : "pending";
    if (finalized !== true) result.notes = "Otro proceso ya verificó el partido o dejó de estar disponible.";
    return result;
  }

  // Extras are written only inside the locked finalization transaction.

  // ── Path A: torneo cubierto por football-data (Mundial) ─────────────
  // La segunda fuente es el fetch REAL a FD, nunca el row de DB.
  const fdCovered =
    !!FD_COMPETITION_BY_TOURNAMENT[match.tournament] &&
    !ESPN_ONLY_TOURNAMENTS.has(match.tournament);

  if (fdCovered) {
    // FD es CORROBORADOR, no bloqueante (v3, 2026-06-11): extraemos lo que
    // FD tenga este tick; si trae score canónico se usa para cross-check
    // (y puede vetar), pero su ausencia/lag/flap ya no congela el scoring.
    let fdCanonHome: number | null = null;
    let fdCanonAway: number | null = null;
    let fdFtHome: number | null = null;
    let fdFtAway: number | null = null;
    let fdDuration = "REGULAR";
    let fdWentToEt = false;
    const fdEquivalents: Array<[number, number]> = [];
    let fdState: string;
    if (fdMatches === null || fdMatches === undefined) {
      fdState = "fetch caído";
    } else {
      const fd = findFdMatch(match, fdMatches);
      if (!fd) {
        fdState = "match no encontrado";
      } else if (fd.status !== "FINISHED") {
        fdState = `status=${fd.status}`;
      } else {
        fdDuration = fd.score?.duration ?? "REGULAR";
        fdWentToEt = fdDuration !== "REGULAR" || etSignal;
        // REGLA DE PRODUCTO: canónico = 90 minutos. Con alargue, regularTime.
        fdCanonHome = fdWentToEt
          ? fd.score?.regularTime?.home ?? null
          : fd.score?.fullTime?.home ?? null;
        fdCanonAway = fdWentToEt
          ? fd.score?.regularTime?.away ?? null
          : fd.score?.fullTime?.away ?? null;
        fdFtHome = fd.score?.fullTime?.home ?? null;
        fdFtAway = fd.score?.fullTime?.away ?? null;
        if (fdCanonHome === null || fdCanonAway === null) {
          // Visto en vivo el 2026-06-11: FINISHED con fullTime {null,null}.
          fdState = `finished sin score canónico (duration=${fdDuration})`;
          fdCanonHome = null;
          fdCanonAway = null;
        } else {
          fdState = "scored";
          const played = fdPlayedScore(fd.score);
          if (played) fdEquivalents.push([played.home, played.away]);
        }
      }
    }

    // ── Caso 1: FD trae score canónico → dual-source clásico. FD manda el
    // 90'; ESPN debe coincidir con el marcador jugado (sin penales).
    if (fdState === "scored" && fdCanonHome !== null && fdCanonAway !== null) {
      const matchesAny = (h: number | null, a: number | null): boolean =>
        h !== null && a !== null && fdEquivalents.some(([eh, ea]) => eh === h && ea === a);

      // Con ET y fullTime null (flap parcial de FD: regularTime presente,
      // fullTime aún vacío), ESPN y DB traen scores ET-inclusive que no se
      // pueden comparar contra el canon de 90' — tratarlos como "sin
      // segunda señal" (→ single-source FD), no como veto espurio.
      const etIncomparable = fdWentToEt && fdEquivalents.length === 0;
      const espnAgrees =
        !etIncomparable && espnFinished && espnHome !== null && espnAway !== null
          ? matchesAny(espnHome, espnAway)
          : null;
      // The database may contain this same FD response; it cannot corroborate it.
      const snapshotAgrees = match.regulation_home_score !== null && match.regulation_away_score !== null
        ? match.regulation_home_score === fdCanonHome && match.regulation_away_score === fdCanonAway : null;
      const agrees = snapshotAgrees === false || espnAgrees === false ? false : snapshotAgrees ?? espnAgrees;

      if (agrees === false) {
        result.status = "discrepancy";
        const other = espnAgrees !== null ? `ESPN: ${espnHome}-${espnAway}` : `DB: ${match.home_score}-${match.away_score}`;
        result.notes = `DISCREPANCIA — football-data fullTime: ${fdFtHome}-${fdFtAway} (duration=${fdDuration}), ${other}.`;
        await alertOnce(admin, match, result.notes, alertedSuffix);
        return result;
      }

      if (agrees === null) {
        const seen = previousNotes.match(/ fdseen=(\d+)-(\d+)@(\S+)/);
        const same = seen !== null && Number(seen[1]) === fdCanonHome && Number(seen[2]) === fdCanonAway;
        if (!same || Date.now() - Date.parse(seen![3]) < 50_000) {
          result.notes = "football-data: esperando segunda lectura independiente del proveedor.";
          const marker = same ? seen![0] : ` fdseen=${fdCanonHome}-${fdCanonAway}@${new Date().toISOString()}`;
          await persistNote(admin, match.id, result.notes + marker + alertedSuffix);
          return result;
        }
      }
      result.status = "verified";
      result.notes =
        agrees === null
          ? `Verificado (FD, dos lecturas separadas): ${fdCanonHome}-${fdCanonAway} (duration=${fdDuration}).`
          : fdWentToEt
            ? `Verificado dual-source: 90' = ${fdCanonHome}-${fdCanonAway} (${fdDuration}, final ${fdFtHome}-${fdFtAway} — los puntos usan el 90').`
            : `Verificado dual-source: ESPN y football-data coinciden en ${fdCanonHome}-${fdCanonAway}.`;
      await finalize(admin, match.id, fdCanonHome, fdCanonAway, result, knockoutExtras);
      return result;
    }

    // ── Caso 2: FD sin score utilizable y SIN señal de alargue (ni nuestra
    // ni de FD — si FD dice duration != REGULAR, este path se bloquea
    // aunque la row no tenga señal: el score de ESPN incluiría el ET) →
    // ESPN-primario con guard de 2 ticks.
    if (!etSignal && !fdWentToEt) {
      if (
        espnFinished &&
        espnHome !== null &&
        espnAway !== null &&
        espnHome === match.home_score &&
        espnAway === match.away_score
      ) {
        // Guard de 2 ticks: sync live y verify corren en el MISMO request,
        // así que ESPN==row recién al pitazo es UNA sola lectura. Exigimos
        // haber visto el mismo score finished en un tick anterior (marker
        // `espnseen=` en notes, >=50s) antes de finalizar — un flap de
        // un tick de ESPN no queda grabado en un match inmutable.
        const seen = previousNotes.match(/ espnseen=(\d+)-(\d+)@(\S+)/);
        const sameScoreSeen =
          seen !== null && Number(seen[1]) === espnHome && Number(seen[2]) === espnAway;
        if (sameScoreSeen && Date.now() - new Date(seen![3]).getTime() >= 50_000) {
          result.status = "verified";
          result.notes = `Verificado ESPN-primario (FD ${fdState}): ${espnHome}-${espnAway}, mismo score en 2 ticks separados.`;
          await finalize(admin, match.id, espnHome, espnAway, result, knockoutExtras);
          return result;
        }
        const marker = sameScoreSeen
          ? ` espnseen=${seen![1]}-${seen![2]}@${seen![3]}` // no resetear el reloj
          : ` espnseen=${espnHome}-${espnAway}@${new Date().toISOString()}`;
        result.status = "pending";
        result.notes = `ESPN finished ${espnHome}-${espnAway} — esperando tick de confirmación (FD ${fdState}).`;
        await persistNote(admin, match.id, result.notes + marker + alertedSuffix);
        return result;
      }
      result.status = "pending";
      result.notes = `Esperando confirmación — ESPN ${espnFinished ? "finished" : "no finished"} (${espnHome ?? "?"}-${espnAway ?? "?"}), DB: ${match.home_score}-${match.away_score}, FD ${fdState}.`;
      await persistNote(admin, match.id, result.notes + alertedSuffix);
      return result;
    }

    // ── Caso 3: señal de alargue sin regularTime de FD este tick → el
    // snapshot 90' propio (migración 063) es el canónico. Sin snapshot,
    // alerta y resolución manual — jamás puntuar con score que incluya ET.
    if (
      espnFinished &&
      match.regulation_home_score !== null &&
      match.regulation_away_score !== null
    ) {
      result.status = "verified";
      result.notes = `Verificado con snapshot 90' (FD ${fdState}): ${match.regulation_home_score}-${match.regulation_away_score} (ET final ESPN ${espnHome}-${espnAway} — los puntos usan el 90').`;
      await finalize(admin, match.id, match.regulation_home_score, match.regulation_away_score, result, knockoutExtras);
      return result;
    }
    if (!espnFinished) {
      result.status = "pending";
      result.notes = `Match con alargue — esperando full-time de ESPN o regularTime de FD (FD ${fdState}).`;
      await persistNote(admin, match.id, result.notes + alertedSuffix);
      return result;
    }
    result.status = "discrepancy";
    result.notes = `Match con alargue SIN snapshot 90' ni regularTime de FD (ESPN: ${espnHome}-${espnAway}, FD ${fdState}). Resolver manual en /admin/discrepancias.`;
    await alertOnce(admin, match, result.notes, alertedSuffix);
    return result;
  }

  // ── Path B: tournaments ESPN-only (single-source legacy) ────────────
  const fdFinishedDb = match.status === "finished";
  const fdHomeDb = match.home_score;
  const fdAwayDb = match.away_score;

  if (!espnFinished) {

    result.status = "pending";
    result.notes = `ESPN aún no marca finished (espn=${espnHome}-${espnAway}). DB: ${fdHomeDb}-${fdAwayDb}.${etSignal ? " Match con alargue — requiere confirmación." : ""}`;
    await persistNote(admin, match.id, result.notes + alertedSuffix);
    return result;
  }

  if (etSignal) {
    // ESPN-only + alargue: no hay fuente con regularTime. El snapshot
    // regulation_* (migración 063) es lo único que tenemos: si existe,
    // verificamos con él; sin snapshot, alerta una vez y resolución manual.
    if (match.regulation_home_score !== null && match.regulation_away_score !== null) {
      result.status = "verified";
      result.notes = `Verificado con snapshot 90': ${match.regulation_home_score}-${match.regulation_away_score} (ET final ESPN ${espnHome}-${espnAway} — los puntos usan el 90').`;
      await finalize(admin, match.id, match.regulation_home_score, match.regulation_away_score, result, knockoutExtras);
      return result;
    }
    result.status = "discrepancy";
    result.notes = `Match con alargue SIN snapshot 90' ni segunda fuente (ESPN: ${espnHome}-${espnAway}). Resolver manual en /admin/discrepancias.`;
    await alertOnce(admin, match, result.notes, alertedSuffix);
    return result;
  }

  if (espnHome === fdHomeDb && espnAway === fdAwayDb && fdFinishedDb) {
    if (espnHome === null || espnAway === null) return result;
    const seen = previousNotes.match(/ espnseen=(\d+)-(\d+)@(\S+)/);
    const same = seen !== null && Number(seen[1]) === espnHome && Number(seen[2]) === espnAway;
    if (!same || Date.now() - Date.parse(seen![3]) < 50_000) {
      result.notes = "ESPN: esperando segundo tick de confirmación.";
      const marker = same ? seen![0] : ` espnseen=${espnHome}-${espnAway}@${new Date().toISOString()}`;
      await persistNote(admin, match.id, result.notes + marker + alertedSuffix);
      return result;
    }
    result.status = "verified";
    result.notes = `Verificado ESPN: ${fdHomeDb}-${fdAwayDb}, dos ticks separados.`;
    await finalize(admin, match.id, fdHomeDb!, fdAwayDb!, result, knockoutExtras);
    return result;
  }

  result.status = "discrepancy";
  result.notes = `DISCREPANCIA — ESPN: ${espnHome}-${espnAway}, DB: ${fdHomeDb}-${fdAwayDb}.`;
  await alertOnce(admin, match, result.notes, alertedSuffix);
  return result;
}

/** Extras and regulation score are written atomically under the same row lock. */
async function finalize(
  admin: ReturnType<typeof createAdminClient>,
  matchId: string,
  homeScore: number,
  awayScore: number,
  result: VerifyResult,
  extras: KnockoutExtras | null = null,
): Promise<void> {
  const { data, error } = await admin.rpc("finalize_verified_match_result", {
    p_match_id: matchId, p_home_score: homeScore, p_away_score: awayScore, p_notes: result.notes,
    p_fulltime_home: extras?.fulltime_home_score ?? null, p_fulltime_away: extras?.fulltime_away_score ?? null,
    p_penalty_home: extras?.penalty_home ?? null, p_penalty_away: extras?.penalty_away ?? null,
    p_advancer: extras?.advancer ?? null,
  });
  if (error) throw new Error("Finalization failed");
  if (data !== true) {
    result.status = "pending";
    result.notes = "Otro proceso ya verificó el partido o dejó de estar disponible.";
  }
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
          `\n\nMatch ID: ${match.id}\nKickoff: ${match.scheduled_at}\n\nResolvé desde /admin/discrepancias.`,
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
