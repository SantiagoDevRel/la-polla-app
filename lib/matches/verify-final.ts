// lib/matches/verify-final.ts — Cross-check entre ESPN y football-data
// antes de declarar un match como verificado para scoring.
//
// Llamado desde el sync orquestador cuando un match transiciona a
// status='finished' o cuando un match ya finished todavía no tiene
// final_verified_at.
//
// Reglas (v2, post-auditoría 2026-06-10):
//   1. Para torneos cubiertos por football-data (Mundial): la "segunda
//      fuente" es un FETCH REAL a la API de football-data — NUNCA el row
//      de DB (que pudo haberlo escrito ESPN → la verificación vieja era
//      ESPN-contra-ESPN, hallazgo crítico de la auditoría).
//   2. REGLA DE PRODUCTO: las pollas se puntúan con el marcador de los
//      90 minutos. football-data manda score.regularTime cuando hubo
//      alargue; ese es el canónico. El cierre va por el RPC
//      finalize_match_result (migración 063), que permite corrección a
//      la baja (bypass del guard monotónico) y dispara el scoring con
//      los scores ya escritos.
//   3. Si las fuentes discrepan → notificar al admin UNA SOLA VEZ por
//      match (track via final_verification_notes con "alerted").
//   4. Si solo una fuente dice finished → no verificamos todavía, retry
//      next tick.
//   5. Tournaments ESPN-only (libertadores, etc.): single-source, igual
//      que antes — pero NUNCA auto-verifican si hay señal de alargue.

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

const FD_COMPETITION_BY_TOURNAMENT: Record<string, number> = Object.fromEntries(
  COMPETITIONS.map((c) => [c.tournament, c.id]),
);

// Señales de que el partido fue a alargue/penales. Si alguna está presente,
// JAMÁS auto-verificamos sin la confirmación de football-data (que trae el
// regularTime de los 90).
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

/**
 * Normalizador para comparar nombres entre nuestra DB (openfootball) y
 * football-data. Espejo TS de los aliases de public.normalize_team_name
 * (migración 061) — mantener en sync.
 */
function normalizeTeamForCompare(name: string): string {
  let v = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  const aliases: Array<[RegExp, string]> = [
    [/\busa\b|\bunited states of america\b/g, "united states"],
    [/\bczechia\b/g, "czech republic"],
    [/\bbosnia(?: and | & |-)herzegovina\b/g, "bosnia herzegovina"],
    [/\bcote d.?ivoire\b/g, "ivory coast"],
    [/\bcape verde islands\b/g, "cape verde"], // football-data
    [/\bcabo verde\b/g, "cape verde"],
    [/\bsouth korea\b|\brepublic of korea\b/g, "korea republic"],
    [/\bir iran\b/g, "iran"], // football-data
    [/\bchina pr\b/g, "china"], // football-data
    [/\bcurazao\b/g, "curacao"],
    [/\bturkiye\b/g, "turkey"],
    [/\bcongo dr\b|\bcongo-kinshasa\b|\bdemocratic republic of congo\b/g, "dr congo"],
  ];
  for (const [rx, to] of aliases) v = v.replace(rx, to);
  return v.replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Match laxo de nombres entre fuentes: igualdad normalizada o contención
 * de tokens en cualquier dirección ("Korea Republic" vs "South Korea" pasa
 * por alias; "Bayern Munich" vs "FC Bayern München" pasa por contención).
 */
function teamsLooselyMatch(a: string, b: string): boolean {
  const na = normalizeTeamForCompare(a);
  const nb = normalizeTeamForCompare(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/** Matchea un row nuestro contra la lista de matches de football-data. */
function findFdMatch(match: MatchRow, fdMatches: FDMatch[]): FDMatch | null {
  const kickMs = new Date(match.scheduled_at).getTime();
  const nh = normalizeTeamForCompare(match.home_team);
  const na = normalizeTeamForCompare(match.away_team);

  // 1. Por nombres normalizados + kickoff ±3h.
  for (const fd of fdMatches) {
    const fdMs = new Date(fd.utcDate).getTime();
    if (Math.abs(fdMs - kickMs) > 3 * 60 * 60 * 1000) continue;
    if (
      normalizeTeamForCompare(fd.homeTeam.name) === nh &&
      normalizeTeamForCompare(fd.awayTeam.name) === na
    ) {
      return fd;
    }
  }
  // 2. Fallback: candidato ÚNICO en ±2h (cubre variantes de nombre que el
  //    normalizador no conozca). Si hay 2+, ambiguo → no matchear.
  const windowed = fdMatches.filter(
    (fd) => Math.abs(new Date(fd.utcDate).getTime() - kickMs) <= 2 * 60 * 60 * 1000,
  );
  return windowed.length === 1 ? windowed[0] : null;
}

/**
 * Para cada match en `status='finished'` con `final_verified_at IS
 * NULL`, intenta verificar contra las dos fuentes y actualiza la DB.
 * Devuelve el detalle por match para logging.
 */
export async function verifyPendingFinals(): Promise<VerifyResult[]> {
  const admin = createAdminClient();

  // Solo matches recién finalizados sin verificar QUE TIENEN AL MENOS
  // UNA PREDICCIÓN ASOCIADA. Si un match no está en ninguna polla, no
  // hay scoring que ejecutar.
  const { data, error } = await admin
    .from("matches")
    .select(
      "id, external_id, espn_id, tournament, home_team, away_team, home_score, away_score, status, scheduled_at, final_verified_at, final_verification_notes, live_status_detail, regulation_home_score, regulation_away_score, predictions!inner(id)",
    )
    .eq("status", "finished")
    .is("final_verified_at", null)
    // Bound temporal: legacy finished-unverified de torneos viejos no deben
    // quemar cuota football-data cada minuto — esos van por el cron diario
    // de discrepancias + resolución manual.
    .gte("scheduled_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

  if (error) {
    console.error("[verify-final] db query failed:", error.message);
    return [];
  }
  const seen = new Set<string>();
  const candidates: MatchRow[] = [];
  for (const row of (data ?? []) as Array<MatchRow & { predictions: unknown }>) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const { predictions: _join, ...rest } = row;
    void _join;
    candidates.push(rest as MatchRow);
  }
  if (candidates.length === 0) return [];

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
    const result = await verifyOneMatch(
      match,
      fdByTournament.get(match.tournament),
      espnByTournament.get(match.tournament),
    );
    results.push(result);
  }
  return results;
}

async function verifyOneMatch(
  match: MatchRow,
  fdMatches: FDMatch[] | null | undefined,
  espnEvents: Awaited<ReturnType<typeof fetchEspnScoreboard>> | null | undefined,
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
  let espnHome: number | null = null;
  let espnAway: number | null = null;
  {
    const events = espnEvents ?? [];
    let event = match.espn_id ? events.find((e) => e.id === match.espn_id) : null;
    if (!event) {
      // Fallback por kickoff ±2h, pero VALIDANDO equipos: en jornadas con
      // kickoffs simultáneos (última fecha de grupos: 4+ a la misma hora)
      // el primer evento de la ventana puede ser OTRO partido y generar
      // una falsa discrepancia que bloquea el scoring (review 2026-06-10).
      const kickMs = new Date(match.scheduled_at).getTime();
      event = events.find((e) => {
        const eventMs = new Date(e.date).getTime();
        if (Math.abs(eventMs - kickMs) >= 2 * 60 * 60 * 1000) return false;
        const competition = e.competitions[0];
        const h = competition?.competitors.find((c) => c.homeAway === "home");
        const a = competition?.competitors.find((c) => c.homeAway === "away");
        if (!h || !a) return false;
        return (
          teamsLooselyMatch(h.team.displayName, match.home_team) &&
          teamsLooselyMatch(a.team.displayName, match.away_team)
        );
      }) ?? null;
    }
    if (event) {
      const mapped = mapEspnStatus(event.status);
      espnFinished = mapped === "finished";
      const competition = event.competitions[0];
      const home = competition?.competitors.find((c) => c.homeAway === "home");
      const away = competition?.competitors.find((c) => c.homeAway === "away");
      espnHome = parseEspnScore(home?.score);
      espnAway = parseEspnScore(away?.score);
    }
  }

  // Marker anti-spam: "alerted=<iso>" debe sobrevivir cualquier re-write
  // de notes — si se pierde, el próximo tick re-notifica al admin.
  const previousNotes = match.final_verification_notes ?? "";
  const previousAlertedMatch = previousNotes.match(/ alerted=[^ ]+/);
  const alertedSuffix = previousAlertedMatch ? previousAlertedMatch[0] : "";

  const etSignal = hasEtSignal(match);

  // ── Path A: torneo cubierto por football-data (Mundial) ─────────────
  // La segunda fuente es el fetch REAL a FD, nunca el row de DB.
  const fdCovered =
    !!FD_COMPETITION_BY_TOURNAMENT[match.tournament] &&
    !ESPN_ONLY_TOURNAMENTS.has(match.tournament);

  if (fdCovered) {
    if (fdMatches === null || fdMatches === undefined) {
      // FD caído este tick. Sin señal de ET podemos tolerar el fallback
      // legacy SOLO si ESPN confirma exactamente lo que ya está en DB
      // (mejor que congelar el scoring por horas). Con señal de ET, jamás:
      // el score de DB puede incluir goles de alargue.
      if (
        !etSignal &&
        espnFinished &&
        espnHome !== null &&
        espnAway !== null &&
        espnHome === match.home_score &&
        espnAway === match.away_score
      ) {
        result.status = "verified";
        result.notes = `Verificado (FD caído, ESPN==DB): ${espnHome}-${espnAway}.`;
        await finalize(admin, match.id, espnHome, espnAway, result.notes);
        return result;
      }
      result.status = "pending";
      result.notes = `football-data no disponible este tick${etSignal ? " (match con alargue — esperando regularTime)" : ""}.`;
      await persistNote(admin, match.id, result.notes + alertedSuffix);
      return result;
    }

    const fd = findFdMatch(match, fdMatches);
    if (!fd) {
      result.status = "pending";
      result.notes = `football-data no tiene el match aún (ESPN: ${espnHome}-${espnAway}).`;
      await persistNote(admin, match.id, result.notes + alertedSuffix);
      return result;
    }

    const fdFinished = fd.status === "FINISHED" || fd.status === "AWARDED";
    if (!fdFinished) {
      result.status = "pending";
      result.notes = `football-data aún no marca finished (fd=${fd.status}).`;
      await persistNote(admin, match.id, result.notes + alertedSuffix);
      return result;
    }

    const duration = fd.score?.duration ?? "REGULAR";
    const wentToEt = duration !== "REGULAR";
    // REGLA DE PRODUCTO: canónico = 90 minutos. Con alargue, regularTime.
    const canonHome = wentToEt
      ? fd.score?.regularTime?.home ?? null
      : fd.score?.fullTime?.home ?? null;
    const canonAway = wentToEt
      ? fd.score?.regularTime?.away ?? null
      : fd.score?.fullTime?.away ?? null;
    const ftHome = fd.score?.fullTime?.home ?? null;
    const ftAway = fd.score?.fullTime?.away ?? null;

    if (canonHome === null || canonAway === null) {
      result.status = "pending";
      result.notes = `football-data finished pero sin score canónico (duration=${duration}).`;
      await persistNote(admin, match.id, result.notes + alertedSuffix);
      return result;
    }

    // Cross-check de independencia: ESPN (si está) debe coincidir con
    // ALGUNA representación del resultado de FD. ⚠️ Para PENALTY_SHOOTOUT
    // el fullTime de FD v4 puede incluir los goles de la tanda, mientras
    // ESPN los excluye (verificado: Qatar 2022 → ESPN score 3-3, shootout
    // aparte) — comparar contra fullTime crudo daba falsa discrepancia en
    // CADA partido definido por penales. Construimos el set de scores
    // equivalentes y aceptamos match contra cualquiera.
    const etHomeRaw = fd.score?.extraTime?.home ?? null;
    const etAwayRaw = fd.score?.extraTime?.away ?? null;
    const fdEquivalents: Array<[number, number]> = [];
    if (ftHome !== null && ftAway !== null) fdEquivalents.push([ftHome, ftAway]);
    if (wentToEt && etHomeRaw !== null && etAwayRaw !== null) {
      // Según la versión de la API, extraTime puede venir acumulado o solo
      // los goles del alargue — cubrimos ambas interpretaciones.
      fdEquivalents.push([etHomeRaw, etAwayRaw]);
      fdEquivalents.push([canonHome + etHomeRaw, canonAway + etAwayRaw]);
    }
    if (wentToEt) fdEquivalents.push([canonHome, canonAway]);

    const matchesAny = (h: number | null, a: number | null): boolean =>
      h !== null && a !== null && fdEquivalents.some(([eh, ea]) => eh === h && ea === a);

    const espnAgrees =
      espnFinished && espnHome !== null && espnAway !== null
        ? matchesAny(espnHome, espnAway)
        : null;
    const dbAgrees =
      match.home_score !== null && match.away_score !== null
        ? matchesAny(match.home_score, match.away_score)
        : null;
    const agrees = espnAgrees ?? dbAgrees;

    if (agrees === false) {
      result.status = "discrepancy";
      const other = espnAgrees !== null ? `ESPN: ${espnHome}-${espnAway}` : `DB: ${match.home_score}-${match.away_score}`;
      result.notes = `DISCREPANCIA — football-data fullTime: ${ftHome}-${ftAway} (duration=${duration}), ${other}.`;
      await alertOnce(admin, match, result.notes, alertedSuffix);
      return result;
    }
    if (agrees === null) {
      // Ni ESPN (evicted del scoreboard) ni DB tienen score para comparar.
      // FD finished con score canónico es la única fuente disponible —
      // mejor finalizar single-source (con nota) que dejar el scoring
      // congelado para siempre.
      result.status = "verified";
      result.notes = `Verificado (FD single-source, sin segunda señal): ${canonHome}-${canonAway} (duration=${duration}).`;
      await finalize(admin, match.id, canonHome, canonAway, result.notes);
      return result;
    }

    result.status = "verified";
    result.notes = wentToEt
      ? `Verificado dual-source: 90' = ${canonHome}-${canonAway} (${duration}, final ${ftHome}-${ftAway} — los puntos usan el 90').`
      : `Verificado dual-source: ESPN y football-data coinciden en ${canonHome}-${canonAway}.`;
    await finalize(admin, match.id, canonHome, canonAway, result.notes);
    return result;
  }

  // ── Path B: tournaments ESPN-only (single-source legacy) ────────────
  const fdFinishedDb = match.status === "finished";
  const fdHomeDb = match.home_score;
  const fdAwayDb = match.away_score;

  if (!espnFinished) {
    if (
      ESPN_ONLY_TOURNAMENTS.has(match.tournament) &&
      fdFinishedDb &&
      fdHomeDb !== null &&
      fdAwayDb !== null &&
      !etSignal
    ) {
      result.status = "verified";
      result.notes = `Verificado (single-source ESPN): ${fdHomeDb}-${fdAwayDb}.`;
      await finalize(admin, match.id, fdHomeDb, fdAwayDb, result.notes);
      return result;
    }

    result.status = "pending";
    result.notes = `ESPN aún no marca finished (espn=${espnHome}-${espnAway}). DB: ${fdHomeDb}-${fdAwayDb}.${etSignal ? " Match con alargue — requiere confirmación." : ""}`;
    await persistNote(admin, match.id, result.notes + alertedSuffix);
    return result;
  }

  if (etSignal) {
    // ESPN-only + alargue: no hay fuente con regularTime. El snapshot
    // regulation_* (migración 063) es lo único que tenemos — verificable
    // pero mejor que el admin lo confirme: alerta una vez y queda pending.
    if (match.regulation_home_score !== null && match.regulation_away_score !== null) {
      result.status = "verified";
      result.notes = `Verificado con snapshot 90': ${match.regulation_home_score}-${match.regulation_away_score} (ET final ESPN ${espnHome}-${espnAway} — los puntos usan el 90').`;
      await finalize(admin, match.id, match.regulation_home_score, match.regulation_away_score, result.notes);
      return result;
    }
    result.status = "discrepancy";
    result.notes = `Match con alargue SIN snapshot 90' ni segunda fuente (ESPN: ${espnHome}-${espnAway}). Resolver manual en /admin/discrepancias.`;
    await alertOnce(admin, match, result.notes, alertedSuffix);
    return result;
  }

  if (espnHome === fdHomeDb && espnAway === fdAwayDb && fdFinishedDb) {
    result.status = "verified";
    result.notes = `Verificado: ESPN y DB coinciden en ${fdHomeDb}-${fdAwayDb}.`;
    await finalize(admin, match.id, fdHomeDb!, fdAwayDb!, result.notes);
    return result;
  }

  result.status = "discrepancy";
  result.notes = `DISCREPANCIA — ESPN: ${espnHome}-${espnAway}, DB: ${fdHomeDb}-${fdAwayDb}.`;
  await alertOnce(admin, match, result.notes, alertedSuffix);
  return result;
}

/** Cierra el match vía el RPC autoritativo (migración 063). */
async function finalize(
  admin: ReturnType<typeof createAdminClient>,
  matchId: string,
  homeScore: number,
  awayScore: number,
  notes: string,
): Promise<void> {
  const { error } = await admin.rpc("finalize_match_result", {
    p_match_id: matchId,
    p_home_score: homeScore,
    p_away_score: awayScore,
    p_notes: notes,
  });
  if (error) {
    console.error(`[verify-final] finalize_match_result failed for ${matchId}:`, error.message);
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
      .eq("id", match.id);
  } else {
    await admin
      .from("matches")
      .update({
        final_verification_notes: `${notes}${alertedSuffix}`,
      })
      .eq("id", match.id);
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
    .eq("id", matchId);
}
