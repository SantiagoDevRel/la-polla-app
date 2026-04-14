// scripts/finalize-ucl-today.ts — One-off: set known final scores on today's
// UCL matches (Atlético 1-3 Barça, Liverpool 0-2 PSG) and mark them finished,
// then run the scoring engine. Delete after use.
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { scoreMatch } from "../lib/scoring";

const TARGETS = [
  { homeHint: "Atl",       awayHint: "Barc",  home_score: 1, away_score: 3 },
  { homeHint: "Liverpool", awayHint: "Paris", home_score: 0, away_score: 2 },
];

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Missing supabase env");
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd   = new Date(); dayEnd.setUTCHours(23, 59, 59, 999);

  const { data: matches, error: mErr } = await admin
    .from("matches")
    .select("id, home_team, away_team, scheduled_at, status, home_score, away_score")
    .eq("tournament", "champions_2025")
    .gte("scheduled_at", dayStart.toISOString())
    .lte("scheduled_at", dayEnd.toISOString());
  if (mErr) throw mErr;

  for (const t of TARGETS) {
    const m = (matches ?? []).find(
      (row) =>
        row.home_team.toLowerCase().includes(t.homeHint.toLowerCase()) &&
        row.away_team.toLowerCase().includes(t.awayHint.toLowerCase())
    );
    if (!m) {
      console.warn(`[finalize] match ${t.homeHint} vs ${t.awayHint} not found`);
      continue;
    }

    console.log(`[finalize] ${m.home_team} ${t.home_score}-${t.away_score} ${m.away_team}  [${m.id.slice(0, 8)}]`);
    const { error: updErr } = await admin
      .from("matches")
      .update({
        home_score: t.home_score,
        away_score: t.away_score,
        status: "finished",
      })
      .eq("id", m.id);
    if (updErr) throw updErr;

    const r = await scoreMatch(m.id, admin);
    console.log(`[finalize]   → predictions=${r.predictionsScored}  pollas=${r.pollasRecomputed}${r.skipped ? `  skipped=${r.skipped}` : ""}`);
  }

  console.log(`[finalize] done.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
