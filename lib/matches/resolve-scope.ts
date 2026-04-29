// lib/matches/resolve-scope.ts — Resuelve la lista de matches que
// pertenecen a una polla según su `scope`.
//
//   - 'custom'           → matches en polla.match_ids (modelo actual,
//                          fijo al crear la polla).
//   - 'full'             → todos los matches del torneo desde
//                          polla.starts_at (o created_at) en adelante.
//   - 'regular_season'   → solo group_stage / league_stage / regular_season.
//   - 'knockouts'        → solo octavos / cuartos / semis / final /
//                          third_place / playoff.
//   - 'group_stage'      → solo group_stage / league_stage.
//
// Cuando el scope es dinámico, los matches se descubren al momento de
// la query — si más tarde aparecen octavos en el feed (cron auto-
// discover), aparecen automáticamente en la polla sin tocar nada.

import type { SupabaseClient } from "@supabase/supabase-js";
import { MATCH_COLUMNS } from "@/lib/db/columns";

const PHASE_GROUPS: Record<string, readonly string[]> = {
  full: [
    "group_stage",
    "league_stage",
    "regular_season",
    "round_of_32",
    "round_of_16",
    "quarter_finals",
    "semi_finals",
    "final",
    "third_place",
    "playoff",
    "playoffs",
  ],
  regular_season: ["group_stage", "league_stage", "regular_season"],
  group_stage: ["group_stage", "league_stage"],
  knockouts: [
    "round_of_32",
    "round_of_16",
    "quarter_finals",
    "semi_finals",
    "final",
    "third_place",
    "playoff",
    "playoffs",
  ],
};

export interface PollaForResolve {
  id: string;
  scope: string;
  tournament: string;
  match_ids: string[] | null;
  starts_at: string | null;
  created_at: string;
}

/**
 * Returns the matches that belong to this polla, ordered by
 * scheduled_at ascending. Caller passes the supabase client (admin
 * para evitar RLS) y la polla con los campos que necesitamos.
 */
export async function resolvePollaMatches(
  supabase: SupabaseClient,
  polla: PollaForResolve,
) {
  let query = supabase.from("matches").select(MATCH_COLUMNS);

  if (polla.scope === "custom" || !polla.scope) {
    // Modelo viejo: lista fija. Si no hay match_ids, devolver vacío
    // (legacy fallback al tournament-level no aplica acá — la sync
    // de matches puebla con base en match_ids).
    const ids = polla.match_ids ?? [];
    if (ids.length === 0) return { data: [], error: null };
    query = query.in("id", ids);
  } else {
    // Modelo dinámico: filtramos por tournament + fase + fecha límite.
    // Lower bound: polla.starts_at si existe, si no created_at. Eso
    // evita que matches viejos del torneo aparezcan retroactivamente.
    const lowerBound = polla.starts_at ?? polla.created_at;
    const phases = PHASE_GROUPS[polla.scope] ?? PHASE_GROUPS.full;
    query = query
      .eq("tournament", polla.tournament)
      .gte("scheduled_at", lowerBound)
      .in("phase", phases);
  }

  const { data, error } = await query.order("scheduled_at", { ascending: true });
  return { data: data || [], error };
}

/**
 * Variante "solo IDs" para los API listados que ya tienen match data
 * mapeado y solo necesitan los UUIDs aplicables al polla.
 */
export async function resolvePollaMatchIds(
  supabase: SupabaseClient,
  polla: PollaForResolve,
): Promise<string[]> {
  const { data } = await resolvePollaMatches(supabase, polla);
  return (data as Array<{ id: string }> | null)?.map((m) => m.id) ?? [];
}

export const POLLA_SCOPES = [
  "custom",
  "full",
  "regular_season",
  "group_stage",
  "knockouts",
] as const;
export type PollaScope = (typeof POLLA_SCOPES)[number];
