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

/**
 * Calcula los puntos obtenidos por un pronóstico (5 niveles):
 * 1. Resultado exacto → pointsExact (5)
 * 2. Ganador + misma diferencia de gol → pointsGoalDiff (3)
 * 3. Ganador correcto → pointsCorrectResult (2)
 * 4. Acertar goles de al menos un equipo → pointsOneTeam (1)
 * 5. Nada → 0
 */
export function calculatePoints(
  prediction: Prediction,
  result: MatchResult,
  scoring?: PollaScoring
): number {
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
