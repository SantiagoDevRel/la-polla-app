// lib/matches/constants.ts — shared match-status constants.
// Kept here so endpoint code (auth + public) and any future consumer can
// agree on what "done" means for a match.

// A match counts as terminal only when it will never play again.
// `status='scheduled'` past kickoff means the sync hasn't caught up, NOT
// that the match is over — do not add 'scheduled' here.
export const TERMINAL_MATCH_STATUSES: ReadonlySet<string> = new Set([
  "finished",
  "cancelled",
]);
