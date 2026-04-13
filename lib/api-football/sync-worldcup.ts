// lib/api-football/sync-worldcup.ts
// Sincroniza el calendario del Mundial 2026 desde openfootball/worldcup.json
// (fuente pública gratis), hacia la tabla `matches` de Supabase.
//
// openfootball no usa IDs estables, así que generamos external_id determinístico
// a partir de (round, team1, team2). El upsert usa external_id como onConflict.
import crypto from "crypto";
import { createAdminClient } from "../supabase/admin";

const SOURCE_URL =
  "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json";
const TOURNAMENT = "worldcup_2026";

interface OFScore {
  ft?: [number, number];
}

interface OFMatch {
  num?: number | string;
  date?: string; // "2026-06-11"
  time?: string; // "20:00" | "20:00 UTC-6"
  timezone?: string; // "UTC-6" | "UTC+3" | "America/Mexico_City"
  team1?: string | { name?: string; code?: string };
  team2?: string | { name?: string; code?: string };
  score?: OFScore;
  group?: string;
  stage?: string;
}

interface OFRound {
  name?: string;
  matches?: OFMatch[];
  rounds?: OFRound[]; // sometimes nested via stages
}

interface OFDoc {
  name?: string;
  rounds?: OFRound[];
  stages?: OFRound[];
  matches?: OFMatch[];
}

interface MatchRow {
  external_id: string;
  tournament: string;
  home_team: string;
  away_team: string;
  home_team_flag: string | null;
  away_team_flag: string | null;
  scheduled_at: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  phase: string | null;
  match_day: number | null;
  venue: string | null;
}

// Recursively extract (match, roundName) pairs from any nesting of the OF document.
function collectMatches(
  node: OFDoc | OFRound | undefined,
  parentRoundName: string | null
): Array<{ match: OFMatch; roundName: string }> {
  if (!node) return [];
  const out: Array<{ match: OFMatch; roundName: string }> = [];
  const roundName =
    ("name" in node && typeof node.name === "string" ? node.name : parentRoundName) ||
    "";

  if ("matches" in node && Array.isArray(node.matches)) {
    for (const m of node.matches) {
      out.push({ match: m, roundName });
    }
  }
  if ("rounds" in node && Array.isArray(node.rounds)) {
    for (const r of node.rounds) {
      out.push(...collectMatches(r, roundName));
    }
  }
  if ("stages" in node && Array.isArray(node.stages)) {
    for (const s of node.stages) {
      out.push(...collectMatches(s, roundName));
    }
  }
  return out;
}

function teamName(t: OFMatch["team1"]): string {
  if (!t) return "";
  if (typeof t === "string") return t;
  return t.name || t.code || "";
}

function isPlaceholderTeam(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.includes("winner") || lower.includes("path");
}

// Parse "UTC", "UTC-6", "UTC+3", "UTC-5:30" → offset minutes from UTC.
// Returns null for unrecognized formats (e.g. IANA zone names).
function parseUtcOffsetMinutes(tz: string | undefined): number | null {
  if (!tz) return null;
  const trimmed = tz.trim();
  if (trimmed === "UTC" || trimmed === "Z") return 0;
  const m = trimmed.match(/^UTC([+-])(\d{1,2})(?::(\d{2}))?$/i);
  if (!m) return null;
  const sign = m[1] === "-" ? -1 : 1;
  const hh = parseInt(m[2], 10);
  const mm = m[3] ? parseInt(m[3], 10) : 0;
  return sign * (hh * 60 + mm);
}

// Build an ISO-8601 string in UTC given a local date + time + (optional) UTC offset.
function buildScheduledAtUtc(
  date: string,
  time: string | undefined,
  timezone: string | undefined
): string | null {
  if (!date) return null;

  // time may embed the tz: "20:00 UTC-6"
  let hhmm = "00:00";
  let tz = timezone;
  if (time) {
    const parts = time.trim().split(/\s+/);
    hhmm = parts[0];
    if (parts.length > 1) tz = parts.slice(1).join(" ");
  }

  const offsetMin = parseUtcOffsetMinutes(tz);
  // If timezone is missing or IANA, assume UTC (best-effort — openfootball mixes formats).
  const offsetLabel =
    offsetMin === null
      ? "Z"
      : (offsetMin >= 0 ? "+" : "-") +
        String(Math.floor(Math.abs(offsetMin) / 60)).padStart(2, "0") +
        ":" +
        String(Math.abs(offsetMin) % 60).padStart(2, "0");

  const iso = `${date}T${hhmm.length === 5 ? hhmm : hhmm + ":00"}:00${offsetLabel}`.replace(
    /:00:00/,
    ":00"
  );
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function buildExternalId(roundName: string, team1: string, team2: string): string {
  const raw = `${roundName}|${team1}|${team2}`;
  const hash = crypto.createHash("sha1").update(raw).digest("hex").substring(0, 16);
  return `wc2026_${hash}`; // fits in varchar(50)
}

function mapPhase(roundName: string, stage: string | undefined): string | null {
  const src = (stage || roundName || "").toLowerCase();
  if (src.includes("final") && !src.includes("quarter") && !src.includes("semi") && !src.includes("round")) return "final";
  if (src.includes("third")) return "third_place";
  if (src.includes("semi")) return "semi_finals";
  if (src.includes("quarter")) return "quarter_finals";
  if (src.includes("round of 16") || src.includes("r16") || src.includes("round-of-16")) return "round_of_16";
  if (src.includes("round of 32") || src.includes("r32")) return "round_of_32";
  if (src.includes("group") || src.includes("matchday")) return "group_stage";
  return null;
}

function parseMatchDay(roundName: string): number | null {
  const m = roundName.match(/matchday\s*(\d+)/i) || roundName.match(/round\s*(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

export async function syncWorldCup2026(): Promise<{
  fetched: number;
  synced: number;
  skipped: number;
  errors: number;
}> {
  console.log("[wc2026] Fetching openfootball fixtures…");

  const res = await fetch(SOURCE_URL, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`openfootball fetch failed: ${res.status} ${res.statusText}`);
  }
  const doc = (await res.json()) as OFDoc;

  const entries = collectMatches(doc, null);
  console.log(`[wc2026] ${entries.length} entries in source document`);

  const supabase = createAdminClient();
  let synced = 0;
  let skipped = 0;
  let errors = 0;

  for (const { match, roundName } of entries) {
    const home = teamName(match.team1);
    const away = teamName(match.team2);

    if (!home || !away) {
      skipped++;
      continue;
    }
    if (isPlaceholderTeam(home) || isPlaceholderTeam(away)) {
      skipped++;
      continue;
    }

    const scheduledAt = buildScheduledAtUtc(match.date || "", match.time, match.timezone);
    if (!scheduledAt) {
      console.warn(`[wc2026] Skipping ${home} vs ${away}: invalid date/time`, {
        date: match.date,
        time: match.time,
        timezone: match.timezone,
      });
      skipped++;
      continue;
    }

    const externalId = buildExternalId(roundName, home, away);
    const ft = match.score?.ft;
    const hasFt = Array.isArray(ft) && ft.length === 2;
    const row: MatchRow = {
      external_id: externalId,
      tournament: TOURNAMENT,
      home_team: home,
      away_team: away,
      home_team_flag: null,
      away_team_flag: null,
      scheduled_at: scheduledAt,
      status: hasFt ? "finished" : "scheduled",
      home_score: hasFt ? ft![0] : null,
      away_score: hasFt ? ft![1] : null,
      phase: mapPhase(roundName, match.stage),
      match_day: parseMatchDay(roundName),
      venue: null,
    };

    try {
      const { error } = await supabase
        .from("matches")
        .upsert(row, { onConflict: "external_id" });
      if (error) {
        console.error(`[wc2026] Upsert failed for ${externalId}:`, error.message);
        errors++;
      } else {
        synced++;
      }
    } catch (err) {
      console.error(
        `[wc2026] Unexpected error for ${externalId}:`,
        err instanceof Error ? err.message : err
      );
      errors++;
    }
  }

  const summary = { fetched: entries.length, synced, skipped, errors };
  console.log("[wc2026] Sync completed:", summary);
  return summary;
}
