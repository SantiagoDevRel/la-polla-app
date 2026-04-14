// scripts/run-scoring.ts — CLI para correr el scoring sobre todos los
// partidos finalizados. Idempotente.
//
// Uso:
//   npx tsx scripts/run-scoring.ts                       # todos los finished
//   MATCH_ID=<uuid> npx tsx scripts/run-scoring.ts       # solo un partido
//
// Antes de correr: asegurate de que los partidos tengan home_score/away_score
// y status='finished' (vía sync automático o el setter de abajo).
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { scoreMatch, scoreAllFinishedMatches } from "../lib/scoring";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Missing supabase env");
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const targetMatch = process.env.MATCH_ID;
  if (targetMatch) {
    console.log(`[score] scoring single match ${targetMatch}`);
    const r = await scoreMatch(targetMatch, admin);
    console.log(`[score] ✓ ${JSON.stringify(r)}`);
    return;
  }

  console.log(`[score] scanning all finished matches…`);
  const results = await scoreAllFinishedMatches(admin);
  if (!results.length) {
    console.log(`[score] nothing to do (no finished matches with predictions).`);
    return;
  }
  for (const r of results) {
    console.log(`[score] ✓ match=${r.matchId.slice(0, 8)}  predictions=${r.predictionsScored}  pollas=${r.pollasRecomputed}${r.skipped ? `  skipped=${r.skipped}` : ""}`);
  }
  console.log(`[score] done · ${results.length} match(es)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
