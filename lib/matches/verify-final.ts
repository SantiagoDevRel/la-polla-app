// lib/matches/verify-final.ts — Cross-check entre ESPN y football-data
// antes de declarar un match como verificado para scoring.
//
// Llamado desde el sync orquestador cuando un match transiciona a
// status='finished' o cuando un match ya finished todavía no tiene
// final_verified_at.
//
// Reglas (v3, 2026-06-11 — decisión de Santiago tras el inaugural del
// Mundial: FD flapeó post-pitazo (FINISHED con fullTime null / regreso a
// TIMED) y congeló el scoring de 142 predicciones; ESPN pasa a ser la
// fuente primaria y FD corroborador NO-bloqueante):
//   1. ESPN-primario: sin señal de alargue, dos lecturas de ESPN en ticks
//      SEPARADOS que coincidan verifican el match. El sync live y verify
//      corren en el MISMO request, así que "ESPN == row" recién al pitazo
//      es UNA sola lectura — el guard de 2 ticks (marker `espnseen=` en
//      final_verification_notes, >=50s) exige re-ver el mismo score un
//      tick después. Costo: ~1 min de delay. La ausencia o lag de
//      football-data ya NO detiene el scoring.
//   2. football-data corrobora cuando tiene score canónico: si coincide,
//      nota dual-source; si DISCREPA, veta (alerta al admin, no se
//      finaliza). El row de DB solo vale como proxy de la lectura ESPN al
//      cruzar contra FD (lo escribió el sync de ESPN) — nunca como fuente
//      independiente contra el MISMO proveedor que lo escribió (hallazgo
//      auditoría 2026-06-10); la separación ESPN-vs-ESPN la da el guard
//      de 2 ticks, no el row.
//   3. REGLA DE PRODUCTO: puntos = marcador de los 90 + adición. Con
//      alargue, el canónico es regularTime de FD si llegó este tick; si
//      no, el snapshot regulation_* propio (migración 063). Sin ninguno →
//      alerta y resolución manual (o espera, si ESPN aún no marcó
//      full-time). Si FD reporta duration != REGULAR, el path ESPN-
//      primario se bloquea aunque nuestra row no tenga señal de ET. El
//      cierre va SIEMPRE por el RPC finalize_match_result (migración 063).
//   4. Si las fuentes discrepan → notificar al admin UNA SOLA VEZ por
//      match (track via final_verification_notes con "alerted").
//   5. Tournaments ESPN-only (libertadores, etc.): single-source, igual
//      que antes — pero NUNCA auto-verifican si hay señal de alargue
//      sin snapshot 90'.

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
      "id, external_id, espn_id, tournament, phase, home_team, away_team, home_score, away_score, status, scheduled_at, final_verified_at, final_verification_notes, live_status_detail, regulation_home_score, regulation_away_score, predictions!inner(id)",
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
  // Extras de knockout (migración 077): el `score` de ESPN es el marcador de
  // los 120' (incluye alargue, EXCLUYE penales); shootoutScore es la tanda;
  // winner marca quién avanzó. Se capturan acá y se persisten al finalizar.
  let espnAdvancer: "home" | "away" | null = null;
  let espnPenHome: number | null = null;
  let espnPenAway: number | null = null;
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

  const etSignal = hasEtSignal(match);

  // Persistir los extras de knockout (120'/penales/avance) ANTES de cualquier
  // finalize: score_match corre al setear final_verified_at dentro de
  // finalize_match_result, así que las columnas ya tienen que estar escritas.
  // Si la escritura FALLA, NO finalizamos este tick → el match queda sin
  // verificar y reintenta el próximo (codex: no scorear sin los extras).
  // fulltime/penales como par atómico (los dos o ninguno). Migración 077.
  if (knockoutExtras) {
    const patch: Record<string, number | string> = {};
    if (
      knockoutExtras.fulltime_home_score !== null &&
      knockoutExtras.fulltime_away_score !== null
    ) {
      patch.fulltime_home_score = knockoutExtras.fulltime_home_score;
      patch.fulltime_away_score = knockoutExtras.fulltime_away_score;
    }
    if (knockoutExtras.penalty_home !== null && knockoutExtras.penalty_away !== null) {
      patch.penalty_home = knockoutExtras.penalty_home;
      patch.penalty_away = knockoutExtras.penalty_away;
    }
    if (knockoutExtras.advancer !== null) patch.advancer = knockoutExtras.advancer;
    if (Object.keys(patch).length > 0) {
      const { error: exErr } = await admin
        .from("matches")
        .update(patch)
        .eq("id", match.id);
      if (exErr) {
        console.error(`[verify-final] knockout extras update failed for ${match.id}:`, exErr.message);
        result.status = "pending";
        result.notes = `Captura de 120'/avance falló — reintenta el próximo tick.`;
        await persistNote(admin, match.id, result.notes + alertedSuffix);
        return result;
      }
    }
  }

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
      } else if (fd.status !== "FINISHED" && fd.status !== "AWARDED") {
        fdState = `status=${fd.status}`;
      } else {
        fdDuration = fd.score?.duration ?? "REGULAR";
        fdWentToEt = fdDuration !== "REGULAR";
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
          // ⚠️ Para PENALTY_SHOOTOUT el fullTime de FD v4 puede incluir los
          // goles de la tanda, mientras ESPN los excluye (verificado: Qatar
          // 2022 → ESPN score 3-3, shootout aparte) — comparar contra
          // fullTime crudo daba falsa discrepancia en CADA partido definido
          // por penales. Construimos el set de scores equivalentes y
          // aceptamos match contra cualquiera. extraTime puede venir
          // acumulado o solo los goles del alargue — cubrimos ambas.
          const etHomeRaw = fd.score?.extraTime?.home ?? null;
          const etAwayRaw = fd.score?.extraTime?.away ?? null;
          if (fdFtHome !== null && fdFtAway !== null) fdEquivalents.push([fdFtHome, fdFtAway]);
          if (fdWentToEt && etHomeRaw !== null && etAwayRaw !== null) {
            fdEquivalents.push([etHomeRaw, etAwayRaw]);
            fdEquivalents.push([fdCanonHome + etHomeRaw, fdCanonAway + etAwayRaw]);
          }
          if (fdWentToEt) fdEquivalents.push([fdCanonHome, fdCanonAway]);
        }
      }
    }

    // ── Caso 1: FD trae score canónico → dual-source clásico. FD manda el
    // 90'; ESPN (o DB como proxy) debe coincidir con algún equivalente.
    if (fdState === "scored" && fdCanonHome !== null && fdCanonAway !== null) {
      const matchesAny = (h: number | null, a: number | null): boolean =>
        h !== null && a !== null && fdEquivalents.some(([eh, ea]) => eh === h && ea === a);

      // Con ET y fullTime null (flap parcial de FD: regularTime presente,
      // fullTime aún vacío), ESPN y DB traen scores ET-inclusive que no se
      // pueden comparar contra el canon de 90' — tratarlos como "sin
      // segunda señal" (→ single-source FD), no como veto espurio.
      const etIncomparable = fdWentToEt && (fdFtHome === null || fdFtAway === null);
      const espnAgrees =
        !etIncomparable && espnFinished && espnHome !== null && espnAway !== null
          ? matchesAny(espnHome, espnAway)
          : null;
      const dbAgrees =
        !etIncomparable && match.home_score !== null && match.away_score !== null
          ? matchesAny(match.home_score, match.away_score)
          : null;
      const agrees = espnAgrees ?? dbAgrees;

      if (agrees === false) {
        result.status = "discrepancy";
        const other = espnAgrees !== null ? `ESPN: ${espnHome}-${espnAway}` : `DB: ${match.home_score}-${match.away_score}`;
        result.notes = `DISCREPANCIA — football-data fullTime: ${fdFtHome}-${fdFtAway} (duration=${fdDuration}), ${other}.`;
        await alertOnce(admin, match, result.notes, alertedSuffix);
        return result;
      }

      result.status = "verified";
      result.notes =
        agrees === null
          ? // Ni ESPN (evicted del scoreboard) ni DB tienen score para
            // comparar — FD es la única fuente. Mejor finalizar con nota
            // que congelar el scoring para siempre.
            `Verificado (FD single-source, sin segunda señal): ${fdCanonHome}-${fdCanonAway} (duration=${fdDuration}).`
          : fdWentToEt
            ? `Verificado dual-source: 90' = ${fdCanonHome}-${fdCanonAway} (${fdDuration}, final ${fdFtHome}-${fdFtAway} — los puntos usan el 90').`
            : `Verificado dual-source: ESPN y football-data coinciden en ${fdCanonHome}-${fdCanonAway}.`;
      await finalize(admin, match.id, fdCanonHome, fdCanonAway, result.notes, knockoutExtras);
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
          await finalize(admin, match.id, espnHome, espnAway, result.notes, knockoutExtras);
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
      await finalize(admin, match.id, match.regulation_home_score, match.regulation_away_score, result.notes, knockoutExtras);
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
    if (
      ESPN_ONLY_TOURNAMENTS.has(match.tournament) &&
      fdFinishedDb &&
      fdHomeDb !== null &&
      fdAwayDb !== null &&
      !etSignal
    ) {
      result.status = "verified";
      result.notes = `Verificado (single-source ESPN): ${fdHomeDb}-${fdAwayDb}.`;
      await finalize(admin, match.id, fdHomeDb, fdAwayDb, result.notes, knockoutExtras);
      return result;
    }

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
      await finalize(admin, match.id, match.regulation_home_score, match.regulation_away_score, result.notes, knockoutExtras);
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
    await finalize(admin, match.id, fdHomeDb!, fdAwayDb!, result.notes, knockoutExtras);
    return result;
  }

  result.status = "discrepancy";
  result.notes = `DISCREPANCIA — ESPN: ${espnHome}-${espnAway}, DB: ${fdHomeDb}-${fdAwayDb}.`;
  await alertOnce(admin, match, result.notes, alertedSuffix);
  return result;
}

/** Cierra el match vía el RPC autoritativo (migración 063). `extras` (knockouts)
 *  se persisten ANTES del RPC para que score_match los vea (migración 077). */
async function finalize(
  admin: ReturnType<typeof createAdminClient>,
  matchId: string,
  homeScore: number,
  awayScore: number,
  notes: string,
  extras: KnockoutExtras | null = null,
): Promise<void> {
  // Los extras de knockout (120'/penales/avance) ya se escribieron en
  // verifyOneMatch ANTES de llamar a finalize (y si fallaron, no se llega
  // hasta acá: se reintenta). Acá solo cerramos vía el RPC autoritativo.
  void extras;
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
