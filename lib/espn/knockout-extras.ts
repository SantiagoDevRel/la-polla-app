// lib/espn/knockout-extras.ts — Extrae los datos de cierre extendidos de un
// knockout desde ESPN: marcador de 120' (competitor.score), penales
// (shootoutScore) y quién avanzó (winner). Migración 077.
//
// Lo usa la resolución MANUAL de discrepancias (app/api/admin/discrepancias)
// para que un knockout resuelto a mano también capture el 120'/avance (el path
// automático lo hace en lib/matches/verify-final.ts, que tiene su propia lógica
// inline equivalente). Solo devuelve datos si ESPN marcó el match FINISHED.

import {
  ESPN_LEAGUE_BY_TOURNAMENT,
  fetchEspnScoreboardWithDates,
  mapEspnStatus,
  parseEspnScore,
  type ESPNEvent,
} from "./client";

export interface KnockoutExtras {
  fulltime_home_score: number | null; // 120' (incluye alargue)
  fulltime_away_score: number | null;
  penalty_home: number | null; // tanda de penales
  penalty_away: number | null;
  advancer: "home" | "away" | null; // quién avanzó (incluidos penales)
}

// Aliases de nombres de equipos entre proveedores. Espejo (subset) de
// lib/matches/verify-final.ts:normalizeTeamForCompare — mantener en sync. Sin
// esto, el fallback por kickoff (cuando no hay espn_id) falla en selecciones
// con variantes de nombre (USA, Corea, Costa de Marfil, Turquía, DR Congo…).
const TEAM_ALIASES: Array<[RegExp, string]> = [
  [/\busa\b|\bunited states of america\b/g, "united states"],
  [/\bczechia\b/g, "czech republic"],
  [/\bbosnia(?: and | & |-)herzegovina\b/g, "bosnia herzegovina"],
  [/\bcote d.?ivoire\b/g, "ivory coast"],
  [/\bcape verde islands\b/g, "cape verde"],
  [/\bcabo verde\b/g, "cape verde"],
  [/\bsouth korea\b|\brepublic of korea\b/g, "korea republic"],
  [/\bir iran\b/g, "iran"],
  [/\bchina pr\b/g, "china"],
  [/\bcurazao\b/g, "curacao"],
  [/\bturkiye\b/g, "turkey"],
  [/\bcongo dr\b|\bcongo-kinshasa\b|\bdemocratic republic of congo\b/g, "dr congo"],
];

/** Normaliza para comparar nombres (lower, sin acentos, aliases). */
function norm(s: string): string {
  let v = s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  for (const [rx, to] of TEAM_ALIASES) v = v.replace(rx, to);
  return v.replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function loosely(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

function espnDate(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Extrae los extras de un evento ESPN si está FINISHED (si no, null). */
export function extractKnockoutExtrasFromEvent(event: ESPNEvent): KnockoutExtras | null {
  if (mapEspnStatus(event.status) !== "finished") return null;
  const comp = event.competitions[0];
  const home = comp?.competitors.find((c) => c.homeAway === "home");
  const away = comp?.competitors.find((c) => c.homeAway === "away");
  if (!home || !away) return null;
  let advancer: "home" | "away" | null = null;
  if (home.winner) advancer = "home";
  else if (away.winner) advancer = "away";
  return {
    fulltime_home_score: parseEspnScore(home.score),
    fulltime_away_score: parseEspnScore(away.score),
    penalty_home: typeof home.shootoutScore === "number" ? home.shootoutScore : null,
    penalty_away: typeof away.shootoutScore === "number" ? away.shootoutScore : null,
    advancer,
  };
}

/**
 * Busca el evento ESPN de un match y extrae sus extras. Consulta el scoreboard
 * con RANGO DE FECHAS alrededor del kickoff (el scoreboard sin ?dates= solo trae
 * el día actual — un knockout de ayer resuelto a mano no aparecería). Primero
 * matchea por espn_id (preciso); si no, por kickoff ±2h VALIDANDO equipos (evita
 * agarrar un partido paralelo). null si no lo encuentra o ESPN no lo marca
 * finished → el scorer degrada al 90'/avance derivado.
 */
export async function fetchKnockoutExtras(
  tournament: string,
  match: {
    espn_id: string | null;
    scheduled_at: string;
    home_team: string;
    away_team: string;
  },
): Promise<KnockoutExtras | null> {
  const leagueCode = ESPN_LEAGUE_BY_TOURNAMENT[tournament];
  if (!leagueCode) return null;

  const kickMs = new Date(match.scheduled_at).getTime();
  if (!Number.isFinite(kickMs)) return null;
  const from = espnDate(new Date(kickMs - 24 * 60 * 60 * 1000));
  const to = espnDate(new Date(kickMs + 24 * 60 * 60 * 1000));

  let events: ESPNEvent[];
  try {
    events = await fetchEspnScoreboardWithDates(leagueCode, `${from}-${to}`);
  } catch {
    return null;
  }

  let event = match.espn_id ? events.find((e) => e.id === match.espn_id) : undefined;
  if (!event) {
    event = events.find((e) => {
      if (Math.abs(new Date(e.date).getTime() - kickMs) >= 2 * 60 * 60 * 1000) return false;
      const c = e.competitions[0];
      const h = c?.competitors.find((x) => x.homeAway === "home");
      const a = c?.competitors.find((x) => x.homeAway === "away");
      if (!h || !a) return false;
      return (
        loosely(h.team.displayName, match.home_team) &&
        loosely(a.team.displayName, match.away_team)
      );
    });
  }
  if (!event) return null;
  return extractKnockoutExtrasFromEvent(event);
}
