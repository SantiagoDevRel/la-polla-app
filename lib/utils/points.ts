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
