// lib/utils/points.ts — Lógica de cálculo de puntos para los pronósticos de la polla
export interface Prediction {
  homeScore: number;
  awayScore: number;
}

export interface MatchResult {
  homeScore: number;
  awayScore: number;
}

/**
 * Calcula los puntos obtenidos por un pronóstico.
 * - Resultado exacto: 3 puntos
 * - Acierto de ganador/empate: 1 punto
 * - Fallo total: 0 puntos
 */
export function calculatePoints(prediction: Prediction, result: MatchResult): number {
  // Resultado exacto
  if (
    prediction.homeScore === result.homeScore &&
    prediction.awayScore === result.awayScore
  ) {
    return 3;
  }

  // Acierto de ganador o empate
  const predictionOutcome = Math.sign(prediction.homeScore - prediction.awayScore);
  const resultOutcome = Math.sign(result.homeScore - result.awayScore);

  if (predictionOutcome === resultOutcome) {
    return 1;
  }

  return 0;
}

/**
 * Calcula el total de puntos para una lista de pronósticos vs resultados.
 */
export function calculateTotalPoints(
  predictions: Prediction[],
  results: MatchResult[]
): number {
  return predictions.reduce((total, pred, index) => {
    if (results[index]) {
      return total + calculatePoints(pred, results[index]);
    }
    return total;
  }, 0);
}
