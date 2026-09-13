import { scorePair } from '@/lib/api-football/results';
import type { FDMatch } from './client';

/** https://docs.football-data.org/general/v4/overtime.html
 * extraTime counts ONLY extra-time goals; fullTime includes shootout goals.
 * Missing halves never get mixed with a different period's score.
 */
export function fdRegulationScore(score: FDMatch['score'], extraTimeSignal = false) {
  const extra = extraTimeSignal || (score.duration !== undefined && score.duration !== 'REGULAR');
  const pair = extra ? score.regularTime : score.fullTime;
  return scorePair(pair) ? pair : null;
}

export function fdPlayedScore(score: FDMatch['score']) {
  if (!score.duration || score.duration === 'REGULAR') return scorePair(score.fullTime) ? score.fullTime : null;
  if (scorePair(score.regularTime) && scorePair(score.extraTime)) {
    return {home: score.regularTime.home + score.extraTime.home, away: score.regularTime.away + score.extraTime.away};
  }
  if (score.duration === 'EXTRA_TIME') return scorePair(score.fullTime) ? score.fullTime : null;
  if (score.duration === 'PENALTY_SHOOTOUT' && scorePair(score.fullTime) && scorePair(score.penalties)) {
    const pair = {home: score.fullTime.home - score.penalties.home, away: score.fullTime.away - score.penalties.away};
    return scorePair(pair) ? pair : null;
  }
  return null;
}
