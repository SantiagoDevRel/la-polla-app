// lib/utils/points.ts — Lógica de cálculo de puntos estilo Golpredictor (5 niveles)
// Los valores default se pueden sobreescribir con los de la polla

export interface Prediction {
  homeScore: number;
  awayScore: number;
}

export interface MatchResult {
  homeScore: number;
  awayScore: number;
}

export interface PollaScoring {
  pointsExact?: number;       // default 5
  pointsGoalDiff?: number;    // default 3
  pointsCorrectResult?: number; // default 2
  pointsOneTeam?: number;     // default 1
}

// Modos de puntaje. 'classic' = el de toda la app (PollaScoring de arriba).
// 'goles_v2' = escalera de 6 niveles votada por la Polla Mundialista de Pipe
// (ver migración 072). Fija, no usa las columnas numéricas de la polla.
export type ScoringMode = "classic" | "goles_v2";

/**
 * Escalera goles_v2 (decisión Santiago 2026-06-17):
 *   5  marcador exacto
 *   4  ganador + diferencia de gol (mismo diff, no exacto)
 *   3  ganador + un marcador (acertaste el gol de un equipo, diff distinta)
 *   2  ganador solo (ni diff ni marcador)
 *   1  un marcador (ganador errado)
 *   0  nada
 * Debe quedar 1:1 con public.calc_points_goles_v2 en la DB.
 */
export function calculatePointsGolesV2(
  prediction: Prediction,
  result: MatchResult
): number {
  if (
    prediction.homeScore === result.homeScore &&
    prediction.awayScore === result.awayScore
  ) {
    return 5;
  }

  const predOutcome = Math.sign(prediction.homeScore - prediction.awayScore);
  const resultOutcome = Math.sign(result.homeScore - result.awayScore);
  const oneTeam =
    prediction.homeScore === result.homeScore ||
    prediction.awayScore === result.awayScore;

  if (predOutcome === resultOutcome) {
    const predDiff = prediction.homeScore - prediction.awayScore;
    const resultDiff = result.homeScore - result.awayScore;
    if (predDiff === resultDiff) return 4; // ganador + diferencia
    if (oneTeam) return 3; // ganador + un marcador
    return 2; // ganador solo
  }

  if (oneTeam) return 1; // un marcador (ganador errado)
  return 0;
}

/**
 * Calcula los puntos obtenidos por un pronóstico (5 niveles):
 * 1. Resultado exacto → pointsExact (5)
 * 2. Ganador + misma diferencia de gol → pointsGoalDiff (3)
 * 3. Ganador correcto → pointsCorrectResult (2)
 * 4. Acertar goles de al menos un equipo → pointsOneTeam (1)
 * 5. Nada → 0
 *
 * Si `mode === 'goles_v2'`, delega en calculatePointsGolesV2 e ignora los
 * valores numéricos de la polla.
 */
export function calculatePoints(
  prediction: Prediction,
  result: MatchResult,
  scoring?: PollaScoring,
  mode: ScoringMode = "classic"
): number {
  if (mode === "goles_v2") {
    return calculatePointsGolesV2(prediction, result);
  }

  const pts = {
    exact: scoring?.pointsExact ?? 5,
    goalDiff: scoring?.pointsGoalDiff ?? 3,
    correctResult: scoring?.pointsCorrectResult ?? 2,
    oneTeam: scoring?.pointsOneTeam ?? 1,
  };

  // 1. Resultado exacto
  if (
    prediction.homeScore === result.homeScore &&
    prediction.awayScore === result.awayScore
  ) {
    return pts.exact;
  }

  const predOutcome = Math.sign(prediction.homeScore - prediction.awayScore);
  const resultOutcome = Math.sign(result.homeScore - result.awayScore);

  // 2. Ganador + misma diferencia de gol
  if (predOutcome === resultOutcome) {
    const predDiff = prediction.homeScore - prediction.awayScore;
    const resultDiff = result.homeScore - result.awayScore;
    if (predDiff === resultDiff) {
      return pts.goalDiff;
    }
    // 3. Ganador correcto (diferencia distinta)
    return pts.correctResult;
  }

  // 4. Acertar goles de al menos un equipo
  if (
    prediction.homeScore === result.homeScore ||
    prediction.awayScore === result.awayScore
  ) {
    return pts.oneTeam;
  }

  // 5. Nada
  return 0;
}

/**
 * Fases donde los puntos valen el DOBLE cuando una polla aprobó la encuesta
 * `double_from_octavos` (migración 074). El doble cuenta DESDE OCTAVOS en
 * adelante — round_of_32 (16vos) y group_stage NO se doblan. Debe quedar
 * 1:1 con el multiplicador de public.score_match / public.rescore_polla en
 * la DB. El Mundial 48 es el único torneo con round_of_32 antes de octavos,
 * por eso hay que distinguir explícitamente.
 */
export const OCTAVOS_PLUS_PHASES: ReadonlySet<string> = new Set([
  "round_of_16",
  "quarter_finals",
  "semi_finals",
  "third_place",
  "final",
]);

/**
 * Multiplicador de puntaje por fase: 2 si la polla tiene el doble activo y
 * el partido es de octavos en adelante; 1 en cualquier otro caso. Envuelve
 * el scorer base (classic o goles_v2).
 */
export function phaseScoreMultiplier(
  phase: string | null | undefined,
  doubleFromOctavos: boolean | null | undefined
): number {
  return doubleFromOctavos && !!phase && OCTAVOS_PLUS_PHASES.has(phase) ? 2 : 1;
}

// ─────────────────────────────────────────────────────────────────────
// Modo "120' + avance" por polla (migración 077). Espejo 1:1 de
// public.score_match / public.rescore_polla. Componible con goles_v2 +
// double_from_octavos.
//
//   eff_score = score_120 activo ? COALESCE(fulltime_120, 90') : 90'
//   base      = scorer(pred, eff_score)              // classic o goles_v2
//   total     = base * multiplicador_octavos + (1 si acertó quién avanza)
//
// El +1 de avance es PLANO (por fuera del x2). Solo knockouts (16vos+) y
// solo después del cutoff kc_mode_changed_at (no retroactivo).
// ─────────────────────────────────────────────────────────────────────

/** Fases de knockout (16vos en adelante) donde aplica el +1 de "quién avanza". */
export const KNOCKOUT_PHASES: ReadonlySet<string> = new Set([
  "round_of_32",
  "round_of_16",
  "quarter_finals",
  "semi_finals",
  "third_place",
  "final",
]);

/** Datos de resultado del match relevantes para el modo 120'/avance. */
export interface MatchOutcome {
  homeScore: number; // matches.home_score (canónico 90')
  awayScore: number;
  fulltimeHome?: number | null; // matches.fulltime_home_score (120', incl. alargue)
  fulltimeAway?: number | null;
  advancer?: "home" | "away" | null; // matches.advancer (quién avanzó, incl. penales)
  scheduledAt?: string | null;
  phase?: string | null;
}

/** Flags del modo en la polla (migración 077). Cutoffs SEPARADOS: score_120
 *  arranca en kcModeChangedAt; el +1 de avance en advanceBonusFrom (puede ser
 *  posterior). */
export interface KnockoutScoring {
  score120?: boolean | null;
  advanceBonus?: boolean | null;
  kcModeChangedAt?: string | null;
  advanceBonusFrom?: string | null;
}

/** El modo aplica si el flag está activo Y el kickoff es >= el cutoff (no retro). */
function kcModeActive(
  changedAt: string | null | undefined,
  scheduledAt: string | null | undefined
): boolean {
  return !!changedAt && !!scheduledAt && new Date(scheduledAt) >= new Date(changedAt);
}

/**
 * Marcador efectivo para puntuar: el de 120' si score_120 está activo (y pasó
 * el cutoff), si no el de 90'. COALESCE al 90' si no se capturó el 120'.
 * Espejo del subselect `src.eff_home/eff_away` en score_match.
 */
export function effectiveResult(match: MatchOutcome, kc?: KnockoutScoring): MatchResult {
  const isKnockout = !!match.phase && KNOCKOUT_PHASES.has(match.phase);
  const use120 =
    !!kc?.score120 && isKnockout && kcModeActive(kc?.kcModeChangedAt, match.scheduledAt);
  if (use120) {
    return {
      homeScore: match.fulltimeHome ?? match.homeScore,
      awayScore: match.fulltimeAway ?? match.awayScore,
    };
  }
  return { homeScore: match.homeScore, awayScore: match.awayScore };
}

/**
 * Quién avanzó: la captura (matches.advancer) o, si falta, el derivado del
 * marcador decisivo (120' si lo hay, si no 90'). Un empate sin captura → null
 * (se fue a penales y no sabemos quién ganó → sin bonus). Espejo de
 * `src.eff_advancer`.
 */
export function effectiveAdvancer(match: MatchOutcome): "home" | "away" | null {
  if (match.advancer === "home" || match.advancer === "away") return match.advancer;
  const h = match.fulltimeHome ?? match.homeScore;
  const a = match.fulltimeAway ?? match.awayScore;
  if (h === a) return null;
  return h > a ? "home" : "away";
}

/**
 * +1 PLANO por acertar quién avanza (migración 077). Solo si la polla tiene
 * advance_bonus, el match es knockout (16vos+), pasó el cutoff, el user eligió
 * y conocemos el avance. Espejo del término `+ CASE ... THEN 1 ELSE 0` de
 * score_match (va POR FUERA del x2 de octavos).
 */
export function advanceBonus(
  advancePick: "home" | "away" | null | undefined,
  match: MatchOutcome,
  kc?: KnockoutScoring
): number {
  if (!kc?.advanceBonus) return 0;
  if (!kcModeActive(kc?.advanceBonusFrom, match.scheduledAt)) return 0;
  if (!match.phase || !KNOCKOUT_PHASES.has(match.phase)) return 0;
  if (advancePick !== "home" && advancePick !== "away") return 0;
  const adv = effectiveAdvancer(match);
  return adv !== null && advancePick === adv ? 1 : 0;
}

/**
 * Calcula el total de puntos para una lista de pronósticos vs resultados.
 */
export function calculateTotalPoints(
  predictions: Prediction[],
  results: MatchResult[],
  scoring?: PollaScoring
): number {
  return predictions.reduce((total, pred, index) => {
    if (results[index]) {
      return total + calculatePoints(pred, results[index], scoring);
    }
    return total;
  }, 0);
}
