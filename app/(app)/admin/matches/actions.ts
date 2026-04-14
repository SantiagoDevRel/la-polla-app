"use server";

import { isCurrentUserAdmin } from "@/lib/auth/admin";
import { syncCompetition } from "@/lib/football-data/sync";
import { createAdminClient } from "@/lib/supabase/admin";
import { scoreAllFinishedMatches } from "@/lib/scoring";
import { revalidatePath } from "next/cache";

export async function syncMatchesAction(
  competitionId: number,
  tournament: string
) {
  if (!(await isCurrentUserAdmin())) {
    throw new Error("No autorizado");
  }

  const result = await syncCompetition(competitionId, tournament);

  // After a sync, rescore any match that's now finished. Idempotent — safe
  // alongside the Postgres trigger, covers cases where the trigger didn't run
  // (seeded pollas, manual score edits, etc.).
  let scored = 0;
  try {
    const scoringResults = await scoreAllFinishedMatches(createAdminClient());
    scored = scoringResults.reduce((acc, r) => acc + r.predictionsScored, 0);
  } catch (err) {
    console.error("[syncMatchesAction] scoring pass failed (non-fatal):", err);
  }

  revalidatePath("/admin/matches");
  return { ...result, scored };
}

export async function purgeMatchesAction() {
  if (!(await isCurrentUserAdmin())) {
    throw new Error("No autorizado");
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("matches")
    .delete()
    .lt("scheduled_at", "2026-01-01T00:00:00Z")
    .select("id");

  if (error) throw new Error(error.message);

  const deleted = data?.length || 0;
  revalidatePath("/admin/matches");
  return { deleted };
}
