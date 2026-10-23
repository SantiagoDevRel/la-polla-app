/** Owner-approved pairs; keep the SQL enrollment catalog covered by tests. */
export const RANDOM_SCORELINES = [[0, 0], [1, 0], [0, 1], [2, 1], [1, 2], [1, 1], [2, 2]] as const;

interface PartialScore { homeScore?: number | null; awayScore?: number | null }

export function randomScoreOptions(pick?: PartialScore) {
  return RANDOM_SCORELINES.filter(([home, away]) =>
    (pick?.homeScore == null || pick.homeScore === home)
    && (pick?.awayScore == null || pick.awayScore === away));
}

export function randomScoreline(pick?: PartialScore) {
  const options = randomScoreOptions(pick);
  return options.length ? options[Math.floor(Math.random() * options.length)] : null;
}
