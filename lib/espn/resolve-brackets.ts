// lib/espn/resolve-brackets.ts — Resuelve los slots codificados de knockout
// del Mundial usando los cruces YA RESUELTOS que publica ESPN, promoviéndolos
// IN-PLACE vía upsert_match_safe (mismo UUID → predicciones y match_ids
// intactos, cero filas nuevas, cero duplicados).
//
// 🚨 PENS-SAFE POR DISEÑO: solo promueve un cruce cuando ESPN lo muestra con
// los DOS equipos reales (no "Round of 32 N Winner"). ESPN llena la siguiente
// llave únicamente cuando el partido previo terminó 100% — incluyendo alargue
// y penales. Así, leer un cruce resuelto de ESPN = el avance es DEFINITIVO.
// Nunca se calcula el ganador desde el marcador de los 90'.
//
// Por qué ESPN además de football-data/openfootball: ESPN suele resolver los
// brackets antes (los 16vos 2026 los tuvo horas antes que football-data). El
// dedup del RPC (lookup #3 semántico + #3.5 por match_day) hace imposible un
// duplicado, así que sumar ESPN como fuente de promoción es seguro. La
// publicación final respeta bracket_promotion_mode (confirm → propuesta en
// /admin; auto → directo) — igual que football-data.
//
// Se llama desde resolveWorldCupBrackets() en /api/matches/discover (cron 6h)
// y se puede llamar desde el sync live para mayor inmediatez.

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchEspnScoreboardWithDates } from "./client";
import { isPlaceholderTeam, hasPlaceholderTeam } from "@/lib/matches/is-placeholder";

const TOURNAMENT = "worldcup_2026";
const LEAGUE = "fifa.world";
const KICKOFF_TOLERANCE_MS = 3 * 60 * 60 * 1000; // ±3h

interface CodedRow {
  id: string;
  match_day: number | null;
  phase: string | null;
  home_team: string;
  away_team: string;
  scheduled_at: string;
}

function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Normaliza el nombre que da ESPN a la ortografía que ya usamos en `matches`
// (ej. ESPN "Cape Verde" → "Cape Verde Islands"). Match por tokens compartidos
// — tolerante a orden de palabras y sufijos. Si no hay match, deja el de ESPN.
function toDbSpelling(espnName: string, dbNames: string[]): string {
  const target = normalize(espnName);
  const exact = dbNames.find((n) => normalize(n) === target);
  if (exact) return exact;
  const targetTokens = new Set(target.split(" ").filter((t) => t.length > 2));
  if (targetTokens.size === 0) return espnName;
  let best: { name: string; score: number } | null = null;
  for (const n of dbNames) {
    const tokens = new Set(normalize(n).split(" ").filter((t) => t.length > 2));
    if (tokens.size === 0) continue;
    let shared = 0;
    targetTokens.forEach((t) => {
      if (tokens.has(t)) shared++;
    });
    const score = shared / Math.min(targetTokens.size, tokens.size);
    if (score >= 0.5 && (!best || score > best.score)) best = { name: n, score };
  }
  return best?.name ?? espnName;
}

export interface EspnBracketResolveResult {
  codedSlots: number;
  resolvedByEspn: number;
  promoted: number;
  errors: number;
}

export async function resolveWorldCupBracketsFromEspn(): Promise<EspnBracketResolveResult> {
  const out: EspnBracketResolveResult = {
    codedSlots: 0,
    resolvedByEspn: 0,
    promoted: 0,
    errors: 0,
  };
  const supabase = createAdminClient();

  // 1. Nuestras filas de knockout que siguen CODIFICADAS (placeholder).
  const { data: knockouts, error: kErr } = await supabase
    .from("matches")
    .select("id, match_day, phase, home_team, away_team, scheduled_at")
    .eq("tournament", TOURNAMENT)
    .gte("match_day", 73)
    .lte("match_day", 104);
  if (kErr) {
    console.error("[espn-brackets] db query failed:", kErr.message);
    out.errors++;
    return out;
  }
  const coded = ((knockouts ?? []) as CodedRow[]).filter((r) =>
    hasPlaceholderTeam(r.home_team, r.away_team),
  );
  out.codedSlots = coded.length;
  if (coded.length === 0) return out; // nada que resolver

  // 2. Nombres de equipo ya en DB (para normalizar la ortografía de ESPN).
  const { data: teamRows } = await supabase
    .from("matches")
    .select("home_team, away_team")
    .eq("tournament", TOURNAMENT)
    .eq("phase", "group_stage");
  const dbNames = Array.from(
    new Set(
      (teamRows ?? []).flatMap((r) => [r.home_team, r.away_team]).filter(Boolean),
    ),
  ) as string[];

  // 3. Cruces de ESPN en la ventana de los slots pendientes (±1 día).
  const times = coded.map((r) => new Date(r.scheduled_at).getTime()).filter(Number.isFinite);
  if (times.length === 0) return out;
  const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");
  const dates = `${fmt(Math.min(...times) - 86400000)}-${fmt(Math.max(...times) + 86400000)}`;

  let events;
  try {
    events = await fetchEspnScoreboardWithDates(LEAGUE, dates);
  } catch (err) {
    console.error("[espn-brackets] ESPN fetch failed:", err);
    out.errors++;
    return out;
  }

  for (const event of events) {
    const comp = event.competitions?.[0];
    if (!comp) continue;
    const homeRaw = comp.competitors.find((c) => c.homeAway === "home")?.team.displayName;
    const awayRaw = comp.competitors.find((c) => c.homeAway === "away")?.team.displayName;
    // 🚨 PENS-SAFE: ambos reales = el cruce está RESUELTO = los partidos
    // previos terminaron 100% (alargue/penales incluidos). Si alguno sigue
    // codificado, no damos por ganado a nadie — skip.
    if (!homeRaw || !awayRaw || isPlaceholderTeam(homeRaw) || isPlaceholderTeam(awayRaw)) {
      continue;
    }
    const eventMs = new Date(event.date).getTime();
    if (!Number.isFinite(eventMs)) continue;
    // Matchear a una de NUESTRAS filas codificadas por kickoff (±3h).
    const row = coded.find(
      (r) => Math.abs(new Date(r.scheduled_at).getTime() - eventMs) < KICKOFF_TOLERANCE_MS,
    );
    if (!row) continue; // ese cruce ya está resuelto en DB, o no es un slot nuestro
    out.resolvedByEspn++;

    const home = toDbSpelling(homeRaw, dbNames);
    const away = toDbSpelling(awayRaw, dbNames);

    // Promoción in-place vía el RPC. Pasa external_id 'espn:<id>' → el RPC
    // extrae espn_id (link para el live sync) y promueve el slot codificado
    // por match_day (lookup #3.5). En confirm mode crea propuesta en /admin;
    // en auto mode publica directo. Cero duplicados (guard NO-INSERT).
    const { error } = await supabase.rpc("upsert_match_safe", {
      p_external_id: `espn:${event.id}`,
      p_tournament: TOURNAMENT,
      p_match_day: row.match_day,
      p_phase: row.phase,
      p_home_team: home,
      p_away_team: away,
      p_home_team_flag: null,
      p_away_team_flag: null,
      p_scheduled_at: row.scheduled_at,
      p_venue: null,
      p_home_score: null,
      p_away_score: null,
      p_status: "scheduled",
      p_elapsed: null,
    });
    if (error) {
      console.error(`[espn-brackets] promote failed (md ${row.match_day}):`, error.message);
      out.errors++;
    } else {
      out.promoted++;
      console.log(`[espn-brackets] md ${row.match_day} → ${home} vs ${away} (desde ESPN)`);
    }
  }

  return out;
}
