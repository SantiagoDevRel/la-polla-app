import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { CasaPolla } from "./types";

type TournamentPolla = Pick<CasaPolla, "id" | "kind" | "tournament" | "status">;
type MatchTournament = { tournament: string | null };
type TournamentLink = {
  polla_id: string;
  match: MatchTournament | MatchTournament[] | null;
};

/** Match links are authoritative; the legacy field is only a fallback. */
export function resolveTournamentSlugs(
  polla: Pick<CasaPolla, "kind" | "tournament">,
  matches: readonly MatchTournament[],
): string[] {
  if (polla.kind !== "partidos") return [];
  const slugs = [...new Set(matches.flatMap((match) => match.tournament ? [match.tournament] : []))];
  return slugs.length > 0 ? slugs : polla.tournament ? [polla.tournament] : [];
}

/**
 * Public competition metadata only, scoped to the published pollas the caller
 * already resolved. No participant, payment, score or prediction data is read.
 */
export async function getPollaTournamentSlugs(
  pollas: readonly TournamentPolla[],
): Promise<Record<string, string[]>> {
  const published = pollas.filter((polla) =>
    polla.status !== "borrador" && polla.status !== "anulada",
  );
  const matchPollas = published.filter((polla) => polla.kind === "partidos");
  const byPolla = new Map<string, MatchTournament[]>();

  if (matchPollas.length > 0) {
    const db = createAdminClient();
    const pageSize = 500;
    // Keep URLs bounded, and paginate links below PostgREST's 1000-row cap.
    for (let start = 0; start < matchPollas.length; start += 100) {
      const ids = matchPollas.slice(start, start + 100).map((polla) => polla.id);
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await db
          .from("casa_polla_matches")
          .select("polla_id, match:matches(tournament)")
          .in("polla_id", ids)
          .order("polla_id")
          .order("order_index")
          .order("match_id")
          .range(offset, offset + pageSize - 1);
        if (error) throw error;

        const links = (data ?? []) as unknown as TournamentLink[];
        for (const link of links) {
          if (!link.match) continue;
          const bucket = byPolla.get(link.polla_id) ?? [];
          bucket.push(...(Array.isArray(link.match) ? link.match : [link.match]));
          byPolla.set(link.polla_id, bucket);
        }
        if (links.length < pageSize) break;
      }
    }
  }

  return Object.fromEntries(published.map((polla) => [
    polla.id,
    resolveTournamentSlugs(polla, byPolla.get(polla.id) ?? []),
  ]));
}
