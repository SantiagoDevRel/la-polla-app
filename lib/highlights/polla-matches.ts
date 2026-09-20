import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { colombiaTodayWindow, type HighlightMatch } from "./matching";

export interface HighlightScope { slug?: string; matchId?: string }

/** Public Casa catalog only, after authentication; no member data is read. */
export async function listHighlightMatches(userId: string, scope: HighlightScope, now = new Date()): Promise<HighlightMatch[]> {
  if (!userId) throw new Error("Authenticated user required");
  const db = createAdminClient();
  const window = colombiaTodayWindow(now);
  const matches = new Map<string, HighlightMatch>();
  for (let offset = 0; ; offset += 500) {
    let query = db.from("casa_polla_matches")
      .select("match:matches!inner(id,home_team,away_team,tournament,scheduled_at,scheduled_at_confirmed,status),polla:casa_pollas!inner(id,slug)")
      .is("voided_at", null)
      .eq("polla.kind", "partidos")
      .in("polla.status", ["abierta", "cerrada", "resuelta"])
      .is("polla.archived_at", null)
      .neq("polla.publication_mode", "oculta")
      .lte("polla.opens_at", now.toISOString())
      .eq("match.status", "finished")
      .order("match_id", { ascending: true }).order("polla_id", { ascending: true })
      .range(offset, offset + 499);
    if (scope.slug) query = query.eq("polla.slug", scope.slug);
    if (scope.matchId) query = query.eq("match_id", scope.matchId);
    else query = query.gte("match.scheduled_at", window.start).lt("match.scheduled_at", window.end);
    const { data, error } = await query;
    if (error) throw new Error("Could not read highlight matches");
    for (const row of data ?? []) {
      const match = (Array.isArray(row.match) ? row.match[0] : row.match) as HighlightMatch | undefined;
      if (match && match.status === "finished" && match.scheduled_at_confirmed !== false) matches.set(match.id, match);
    }
    if (!data || data.length < 500) break;
  }
  return [...matches.values()];
}
