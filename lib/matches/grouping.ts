// lib/matches/grouping.ts — Shared match-list grouping helpers.
//
// Consumed by the invite preview page and the Partidos tab inside the polla
// detail page. Both surfaces render the same "Por fase / Por fecha" toggle
// and need identical labels, ordering, and bucket keys so UX stays in sync.
// The helpers take a narrow structural type so each call site can pass its
// own MatchRow shape without a shared DB interface.

export interface GroupableMatch {
  id: string;
  scheduled_at: string;
  phase: string | null;
}

export interface MatchGroup<T extends GroupableMatch> {
  key: string;
  label: string;
  matches: T[];
}

export type GroupedMatches<T extends GroupableMatch> = Array<MatchGroup<T>>;

export const PHASE_LABELS: Record<string, string> = {
  group_stage: "Fase de grupos",
  league_stage: "Fase de liga",
  regular_season: "Temporada regular",
  round_of_32: "Dieciseisavos",
  round_of_16: "Octavos de final",
  quarter_finals: "Cuartos de final",
  semi_finals: "Semifinales",
  third_place: "Tercer puesto",
  final: "Final",
  playoff: "Playoffs",
};

export function formatPhaseLabel(phase: string | null): string {
  if (!phase) return "Partidos";
  if (PHASE_LABELS[phase]) return PHASE_LABELS[phase];
  const spaced = phase.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// Colombia-timezone formatters: one produces a sort-stable YYYY-MM-DD bucket
// key, the other produces the human-readable "jue, 11 de jun" header label.
const DATE_KEY_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Bogota",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const DATE_LABEL_FMT = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  weekday: "short",
  day: "numeric",
  month: "short",
});

export function groupMatchesByPhase<T extends GroupableMatch>(
  matches: T[]
): GroupedMatches<T> {
  const map = new Map<string, T[]>();
  for (const m of matches) {
    const key = m.phase ?? "__none__";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(m);
  }
  const groups: GroupedMatches<T> = Array.from(map.entries()).map(
    ([key, ms]) => ({
      key,
      label: formatPhaseLabel(key === "__none__" ? null : key),
      matches: ms
        .slice()
        .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)),
    })
  );
  groups.sort((a, b) =>
    a.matches[0].scheduled_at.localeCompare(b.matches[0].scheduled_at)
  );
  return groups;
}

export function groupMatchesByDate<T extends GroupableMatch>(
  matches: T[]
): GroupedMatches<T> {
  const map = new Map<string, { label: string; matches: T[] }>();
  for (const m of matches) {
    const d = new Date(m.scheduled_at);
    const key = DATE_KEY_FMT.format(d);
    const label = DATE_LABEL_FMT.format(d);
    if (!map.has(key)) map.set(key, { label, matches: [] });
    map.get(key)!.matches.push(m);
  }
  const groups: GroupedMatches<T> = Array.from(map.entries()).map(
    ([key, { label, matches: ms }]) => ({
      key,
      label,
      matches: ms
        .slice()
        .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)),
    })
  );
  groups.sort((a, b) => a.key.localeCompare(b.key));
  return groups;
}
