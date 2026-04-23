// lib/matches/live-minute.ts — shared helper for the live match clock.
//
// Football-data's free tier often omits the `minute` field for live
// matches, and when it does ship one it can lag a few minutes behind
// the broadcast. To keep our UI trustworthy we compute the match
// minute locally from kickoff + a 15-minute halftime allowance:
//
//   real elapsed ≤ 45 → first-half minute = real elapsed
//   real elapsed 46–60 → halftime (show 45')
//   real elapsed ≥ 60 → second-half minute = real elapsed − 15
//
// Second-half times greater than 90 return the string "90+" so the
// UI can render "90+'" during stoppage/added time. Returns null
// before kickoff and when `scheduledAt` is invalid, so callers can
// hide the clock safely.

export type LiveMinute = number | "90+" | null;

export function computeLiveMinute(scheduledAt: string | Date | null | undefined): LiveMinute {
  if (!scheduledAt) return null;
  const kickoffMs = new Date(scheduledAt).getTime();
  if (Number.isNaN(kickoffMs)) return null;

  const elapsedMs = Date.now() - kickoffMs;
  if (elapsedMs < 0) return null;

  const elapsed = Math.floor(elapsedMs / 60000);
  if (elapsed <= 45) return Math.max(1, elapsed);
  if (elapsed <= 60) return 45;

  const secondHalf = elapsed - 15;
  if (secondHalf >= 90) return "90+";
  return secondHalf;
}

export function formatLiveMinute(minute: LiveMinute): string | null {
  if (minute == null) return null;
  return typeof minute === "number" ? `${minute}'` : `${minute}'`;
}
