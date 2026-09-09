/** Fixed CDN path -> same-origin image. Never accepts arbitrary proxy targets. */
export function crestFallbackSource(source: string | null | undefined): string | undefined {
  if (!source) return undefined;
  const espn = source.match(/^https:\/\/a\.espncdn\.com\/i\/teamlogos\/soccer\/(?:500|100)\/([1-9]\d{0,7})\.png$/);
  return espn ? `/api/teams/crest?espn=${espn[1]}` : source;
}
