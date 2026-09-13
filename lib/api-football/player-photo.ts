/** Only API-Football IDs belong here; ESPN and FIFA use different IDs. */
export function apiFootballPlayerPhoto(id: number): string | null {
  return Number.isSafeInteger(id) && id > 0
    ? `https://media.api-sports.io/football/players/${id}.png`
    : null;
}
