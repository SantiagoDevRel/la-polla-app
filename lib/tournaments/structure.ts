// lib/tournaments/structure.ts — Estructura conocida de cada torneo.
//
// Para pollas scope='full', la app muestra TODAS las fases del torneo
// — incluso cuando ESPN/football-data aún no publicaron los fixtures
// reales de esa fase. Las fases sin fixtures aparecen como "Por
// confirmar" en la UI con la cantidad de partidos esperada y una
// fecha estimada.
//
// Cuando el feed externo publique el fixture real, el match aparece
// en la sección normal y el conteo de "Por confirmar" decrementa
// automático.
//
// Esta config NO crea rows en DB — es solo metadata para visualización.
// Para predicciones tempranas en placeholders ver Fase 2 (futuro).

export type PhaseSlug =
  | "regular_season"
  | "league_stage"
  | "group_stage"
  | "playoff"
  | "round_of_32"
  | "round_of_16"
  | "quarter_finals"
  | "semi_finals"
  | "third_place"
  | "final";

export interface TournamentPhase {
  phase: PhaseSlug;
  /** Etiqueta amistosa en español. */
  label: string;
  /**
   * Cantidad esperada de partidos en esta fase. null = variable
   * (depende del torneo, ej. liga regular). Para variable, no
   * mostramos placeholder explícito.
   */
  slots: number | null;
  /**
   * Fecha estimada del inicio de la fase. Se muestra al user como
   * "~mayo 30". null = sin estimación.
   */
  estimatedDate: string | null;
}

export interface TournamentStructure {
  /** Fases en orden cronológico. */
  phases: TournamentPhase[];
}

export const TOURNAMENT_STRUCTURE: Record<string, TournamentStructure> = {
  champions_2025: {
    phases: [
      { phase: "league_stage", label: "Fase de liga", slots: null, estimatedDate: null },
      { phase: "playoff", label: "Playoffs", slots: 16, estimatedDate: "2026-02-12" },
      { phase: "round_of_16", label: "Octavos", slots: 16, estimatedDate: "2026-03-04" },
      { phase: "quarter_finals", label: "Cuartos", slots: 8, estimatedDate: "2026-04-07" },
      { phase: "semi_finals", label: "Semifinales", slots: 4, estimatedDate: "2026-04-28" },
      { phase: "final", label: "Final", slots: 1, estimatedDate: "2026-05-30" },
    ],
  },
  worldcup_2026: {
    phases: [
      { phase: "group_stage", label: "Fase de grupos", slots: 72, estimatedDate: "2026-06-11" },
      { phase: "round_of_32", label: "Dieciseisavos", slots: 16, estimatedDate: "2026-06-29" },
      { phase: "round_of_16", label: "Octavos", slots: 8, estimatedDate: "2026-07-04" },
      { phase: "quarter_finals", label: "Cuartos", slots: 4, estimatedDate: "2026-07-09" },
      { phase: "semi_finals", label: "Semifinales", slots: 2, estimatedDate: "2026-07-14" },
      { phase: "third_place", label: "Tercer puesto", slots: 1, estimatedDate: "2026-07-18" },
      { phase: "final", label: "Final", slots: 1, estimatedDate: "2026-07-19" },
    ],
  },
  // Ligas regulares europeas: solo regular_season, sin playoffs.
  laliga_2025: {
    phases: [{ phase: "regular_season", label: "Liga regular", slots: null, estimatedDate: null }],
  },
  premier_2025: {
    phases: [{ phase: "regular_season", label: "Liga regular", slots: null, estimatedDate: null }],
  },
  seriea_2025: {
    phases: [{ phase: "regular_season", label: "Liga regular", slots: null, estimatedDate: null }],
  },
  // CONMEBOL: estructura típica (puede variar año a año).
  libertadores_2026: {
    phases: [
      { phase: "group_stage", label: "Fase de grupos", slots: 96, estimatedDate: "2026-04-01" },
      { phase: "round_of_16", label: "Octavos", slots: 16, estimatedDate: "2026-08-12" },
      { phase: "quarter_finals", label: "Cuartos", slots: 8, estimatedDate: "2026-09-15" },
      { phase: "semi_finals", label: "Semifinales", slots: 4, estimatedDate: "2026-10-20" },
      { phase: "final", label: "Final", slots: 1, estimatedDate: "2026-11-28" },
    ],
  },
  sudamericana_2026: {
    phases: [
      { phase: "group_stage", label: "Fase de grupos", slots: 96, estimatedDate: "2026-04-08" },
      { phase: "round_of_16", label: "Octavos", slots: 16, estimatedDate: "2026-08-05" },
      { phase: "quarter_finals", label: "Cuartos", slots: 8, estimatedDate: "2026-09-08" },
      { phase: "semi_finals", label: "Semifinales", slots: 4, estimatedDate: "2026-10-13" },
      { phase: "final", label: "Final", slots: 1, estimatedDate: "2026-11-21" },
    ],
  },
  // Liga BetPlay 2026-I (Apertura): formato NUEVO según Dimayor 2026.
  // Adiós cuadrangulares — ahora es eliminación directa ida-vuelta.
  // 19 jornadas todos contra todos → top 8 → cuartos (4 llaves × 2 =
  // 8 partidos) → semis (2 × 2 = 4) → final (1 × 2 = 2). Total
  // playoffs: 14 partidos.
  // Fechas oficiales 2026-I:
  //   - Cuartos ida 9-10 mayo / vuelta 13-14 mayo
  //   - Semis  ida 16-17 mayo / vuelta 23-24 mayo
  //   - Final  ida 2 junio    / vuelta 6 junio
  betplay_2026: {
    phases: [
      { phase: "regular_season", label: "Todos contra todos", slots: null, estimatedDate: null },
      { phase: "quarter_finals", label: "Cuartos de final", slots: 8, estimatedDate: "2026-05-09" },
      { phase: "semi_finals", label: "Semifinales", slots: 4, estimatedDate: "2026-05-16" },
      { phase: "final", label: "Final", slots: 2, estimatedDate: "2026-06-02" },
    ],
  },
};

export interface PendingPhase {
  phase: PhaseSlug;
  label: string;
  expected: number;
  confirmed: number;
  pending: number;
  estimatedDate: string | null;
}

/**
 * Dado un tournament y sus matches actuales en DB, calcula cuántos
 * partidos por fase quedan "por confirmar". Devuelve solo fases con
 * pending > 0 (las completas no aparecen como placeholders).
 *
 * Caller pasa `matches` ya filtrados a la polla (resolvePollaMatches).
 */
export function computePendingPhases(
  tournamentSlug: string,
  matches: Array<{ phase: string | null }>,
): PendingPhase[] {
  const struct = TOURNAMENT_STRUCTURE[tournamentSlug];
  if (!struct) return [];

  // Cuenta matches confirmados por fase.
  const confirmedByPhase = new Map<string, number>();
  for (const m of matches) {
    if (!m.phase) continue;
    confirmedByPhase.set(m.phase, (confirmedByPhase.get(m.phase) ?? 0) + 1);
  }

  const out: PendingPhase[] = [];
  for (const ph of struct.phases) {
    if (ph.slots === null) continue; // fase variable, no aplica placeholder
    const confirmed = confirmedByPhase.get(ph.phase) ?? 0;
    const pending = Math.max(0, ph.slots - confirmed);
    if (pending === 0) continue;
    out.push({
      phase: ph.phase,
      label: ph.label,
      expected: ph.slots,
      confirmed,
      pending,
      estimatedDate: ph.estimatedDate,
    });
  }
  return out;
}
