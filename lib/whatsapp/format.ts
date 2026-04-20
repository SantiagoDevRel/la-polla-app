// lib/whatsapp/format.ts — helpers for WhatsApp UI copy (row titles, etc.)

// WhatsApp list rows cap the title at 24 chars. "vs" + 2 spaces = 4 chars,
// leaving 20 chars total for both team names combined.
const WA_ROW_TITLE_MAX = 24;

// Tokens we strip from official team names because they add no signal for a
// fan glancing at a WhatsApp list row. We keep diacritics intact so names
// like "München" render correctly.
const NOISE_TOKENS = new Set([
  "fc",
  "f.c.",
  "cf",
  "c.f.",
  "club",
  "de",
  "futbol",
  "fútbol",
  "football",
  "afc",
  "sc",
  "s.c.",
  "ac",
  "a.c.",
  "ssc",
  "asc",
]);

/**
 * Shortens an official team name for compact display.
 * Keeps diacritics. Strips "FC", "Club", "de", etc., but only when they
 * appear as separate tokens so mid-word matches like "Saint" are preserved.
 */
export function shortTeamName(name: string): string {
  const cleaned = name
    .split(/\s+/)
    .filter((tok) => tok.length > 0 && !NOISE_TOKENS.has(tok.toLowerCase()))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : name.trim();
}

/**
 * Builds a "Home vs Away" title that fits WhatsApp's 24-char row limit.
 * Falls back progressively: full short names, then first word of each side,
 * then hard truncate with an ellipsis.
 */
export function shortMatchTitle(home: string, away: string): string {
  const full = `${shortTeamName(home)} vs ${shortTeamName(away)}`;
  if (full.length <= WA_ROW_TITLE_MAX) return full;

  const firstWord = (s: string) => shortTeamName(s).split(" ")[0] || s;
  const short = `${firstWord(home)} vs ${firstWord(away)}`;
  if (short.length <= WA_ROW_TITLE_MAX) return short;

  // Last resort: hard truncate, keep the ellipsis inside the limit.
  return short.slice(0, WA_ROW_TITLE_MAX - 1) + "…";
}
