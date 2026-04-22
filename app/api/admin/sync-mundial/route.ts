// app/api/admin/sync-mundial/route.ts — Manual football-data.org sync for
// the Mundial 2026 fixture. Intended for post-FIFA-draw moments when new
// knockout matches get published and the lazy sync has not picked them up
// yet. Uses the same syncCompetition function the admin matches page uses
// for the "Copa del Mundo 2026" row, but lives under a dedicated, clearly
// labeled button so the operator does not confuse it with the older
// openfootball sync-worldcup endpoint.
import { NextResponse } from "next/server";
import { isCurrentUserAdmin } from "@/lib/auth/admin";
import { syncCompetition } from "@/lib/football-data/sync";
import { scoreAllFinishedMatches } from "@/lib/scoring";
import { createAdminClient } from "@/lib/supabase/admin";

const MUNDIAL_COMPETITION_ID = 2000;
const MUNDIAL_TOURNAMENT_SLUG = "worldcup_2026";

export async function POST() {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const result = await syncCompetition(
      MUNDIAL_COMPETITION_ID,
      MUNDIAL_TOURNAMENT_SLUG
    );

    // Rescore finished matches after the sync. Idempotent, non-fatal.
    let scored = 0;
    try {
      const admin = createAdminClient();
      const scoringResults = await scoreAllFinishedMatches(admin);
      scored = scoringResults.reduce((acc, r) => acc + r.predictionsScored, 0);
    } catch (err) {
      console.error("[sync-mundial] scoring pass failed (non-fatal):", err);
    }

    return NextResponse.json({
      matchesSynced: result.synced,
      matchesTotal: result.total,
      errors: result.errors,
      scored,
    });
  } catch (error) {
    console.error("[sync-mundial] Error:", error);
    const msg = error instanceof Error ? error.message : "Error en sync";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
