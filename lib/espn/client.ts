// lib/espn/client.ts — Cliente para la public scoreboard API de ESPN.
//
// ESPN expone JSON sin auth en site.api.espn.com/apis/site/v2/sports/
// soccer/{league}/scoreboard. Lo usa su propia web/app y muchas apps de
// terceros desde hace años. Estable, gratis, sub-minuto de lag para
// scores en vivo.
//
// Esta capa es solo fetch + types. La lógica de matching contra
// nuestra DB vive en lib/espn/sync.ts.

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";

// ─────────────────────────────────────────────────────────────────────
// Mapeo de nuestro tournament slug → código ESPN.
// ─────────────────────────────────────────────────────────────────────
//
// Cuando agreguemos torneos, mapearlos acá. Si un torneo no está en
// este map, ESPN no se consulta para él (la sync skipea silenciosa).
export const ESPN_LEAGUE_BY_TOURNAMENT: Record<string, string> = {
  champions_2025: "uefa.champions",
  worldcup_2026: "fifa.world",
  // futuros: laliga_2025 → "esp.1", premier_2025 → "eng.1", etc.
};

// ─────────────────────────────────────────────────────────────────────
// Tipos parciales — solo modelamos los campos que consumimos. ESPN
// devuelve mucho más (broadcasts, odds, etc.) pero no nos sirve.
// ─────────────────────────────────────────────────────────────────────

export interface ESPNStatusType {
  /** "STATUS_SCHEDULED" | "STATUS_FIRST_HALF" | "STATUS_HALFTIME" |
   *  "STATUS_SECOND_HALF" | "STATUS_END_OF_PERIOD" |
   *  "STATUS_END_OF_REGULATION" | "STATUS_FULL_TIME" | "STATUS_FINAL" |
   *  "STATUS_POSTPONED" | "STATUS_CANCELED" | "STATUS_DELAYED" | … */
  name: string;
  state: string; // "pre" | "in" | "post"
  completed: boolean;
}

export interface ESPNStatus {
  type: ESPNStatusType;
  /** "12'" | "HT" | "FT" | "" */
  displayClock?: string;
  /** 1 = first half, 2 = second half, 3+ = extra time/pens */
  period?: number;
}

export interface ESPNCompetitor {
  homeAway: "home" | "away";
  score: string; // "0", "1", … (string in ESPN payload)
  team: {
    id: string;
    displayName: string;
    shortDisplayName: string;
    abbreviation: string;
  };
}

export interface ESPNCompetition {
  id: string;
  competitors: ESPNCompetitor[];
}

export interface ESPNEvent {
  /** Globally unique: "s:600~l:775~e:401862893". */
  uid: string;
  /** Per-league event id: "401862893". */
  id: string;
  /** "Bayern Munich at Paris Saint-Germain". */
  name: string;
  /** ISO timestamp of kickoff. */
  date: string;
  status: ESPNStatus;
  competitions: ESPNCompetition[];
}

export interface ESPNScoreboard {
  events?: ESPNEvent[];
}

// ─────────────────────────────────────────────────────────────────────
// Status mapper: ESPN → nuestro enum
// ─────────────────────────────────────────────────────────────────────
//
// Nuestro enum: 'scheduled' | 'live' | 'finished' | 'cancelled' |
// 'awarded' (este último solo viene de admin, no de feed).

export function mapEspnStatus(status: ESPNStatus): "scheduled" | "live" | "finished" | "cancelled" | null {
  const name = status.type.name;
  // Pre-match
  if (name === "STATUS_SCHEDULED" || name === "STATUS_DELAYED") return "scheduled";
  // In-play
  if (
    name === "STATUS_FIRST_HALF" ||
    name === "STATUS_HALFTIME" ||
    name === "STATUS_SECOND_HALF" ||
    name === "STATUS_END_OF_PERIOD" ||
    name === "STATUS_OVERTIME" ||
    name === "STATUS_FIRST_HALF_EXTRA_TIME" ||
    name === "STATUS_SECOND_HALF_EXTRA_TIME" ||
    name === "STATUS_END_OF_EXTRA_TIME" ||
    name === "STATUS_SHOOTOUT"
  ) {
    return "live";
  }
  // Final
  if (
    name === "STATUS_FULL_TIME" ||
    name === "STATUS_FINAL" ||
    name === "STATUS_END_OF_REGULATION"
  ) {
    return "finished";
  }
  // Cancelled / no-play
  if (
    name === "STATUS_POSTPONED" ||
    name === "STATUS_CANCELED" ||
    name === "STATUS_FORFEIT" ||
    name === "STATUS_ABANDONED"
  ) {
    return "cancelled";
  }
  // Estado desconocido — no tocamos el row.
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Parser del minuto: ESPN devuelve string como "12'", "HT", "45+2'".
// Nosotros guardamos integer en `matches.elapsed`. HT no es un número
// natural — durante HT podemos guardar 45 (final del primer tiempo).
// ─────────────────────────────────────────────────────────────────────

export function parseEspnMinute(displayClock: string | undefined, period: number | undefined): number | null {
  if (!displayClock) return null;
  const trimmed = displayClock.trim();
  if (!trimmed) return null;
  // "HT" → fin del primer tiempo.
  if (trimmed.toUpperCase() === "HT") return 45;
  // "FT" → fin del partido. Devolvemos null y el status='finished'
  // ya describe el estado.
  if (trimmed.toUpperCase() === "FT") return null;
  // "45+2'" o "45'+2" → tomamos el base + el adicional.
  const match = trimmed.match(/^(\d+)(?:\s*\+\s*(\d+))?'?$/);
  if (!match) return null;
  const base = Number.parseInt(match[1], 10);
  const extra = match[2] ? Number.parseInt(match[2], 10) : 0;
  if (Number.isNaN(base)) return null;
  // Período 2 sin formato compuesto: ya viene como 75' por ejemplo,
  // así que base + extra es suficiente. period se ignora salvo HT.
  void period;
  return base + extra;
}

// ─────────────────────────────────────────────────────────────────────
// Score parser. ESPN devuelve string. Empty → null.
// ─────────────────────────────────────────────────────────────────────

export function parseEspnScore(score: string | undefined | null): number | null {
  if (score === undefined || score === null) return null;
  const trimmed = String(score).trim();
  if (!trimmed) return null;
  const n = Number.parseInt(trimmed, 10);
  return Number.isFinite(n) ? n : null;
}

// ─────────────────────────────────────────────────────────────────────
// Fetch principal. Devuelve [] si la liga no está mapeada (silencioso),
// throws si la red/HTTP falla (lo captura sync.ts y deja fallback a
// football-data).
// ─────────────────────────────────────────────────────────────────────

export async function fetchEspnScoreboard(tournamentSlug: string): Promise<ESPNEvent[]> {
  const leagueCode = ESPN_LEAGUE_BY_TOURNAMENT[tournamentSlug];
  if (!leagueCode) return [];
  const url = `${ESPN_BASE}/${leagueCode}/scoreboard`;
  const res = await fetch(url, {
    // No keys, no cookies. ESPN responde JSON público.
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`[espn] ${tournamentSlug} → HTTP ${res.status}`);
  }
  const data = (await res.json()) as ESPNScoreboard;
  return data.events ?? [];
}
