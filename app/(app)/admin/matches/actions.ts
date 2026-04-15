"use server";

import { isCurrentUserAdmin } from "@/lib/auth/admin";
import { syncCompetition } from "@/lib/football-data/sync";
import { createAdminClient } from "@/lib/supabase/admin";
import { scoreAllFinishedMatches } from "@/lib/scoring";
import { notifyMatchesClosingSoon } from "@/lib/notifications";
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
  const admin = createAdminClient();
  let scored = 0;
  try {
    const scoringResults = await scoreAllFinishedMatches(admin);
    scored = scoringResults.reduce((acc, r) => acc + r.predictionsScored, 0);
  } catch (err) {
    console.error("[syncMatchesAction] scoring pass failed (non-fatal):", err);
  }

  // Fire WA "closing in 10 min" blast for matches that just slid into the
  // 10-minute window. Idempotent via matches.notified_closing.
  let closingNotified = 0;
  try {
    closingNotified = await notifyMatchesClosingSoon(admin);
  } catch (err) {
    console.error("[syncMatchesAction] closing notify failed (non-fatal):", err);
  }

  revalidatePath("/admin/matches");
  return { ...result, scored, closingNotified };
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
