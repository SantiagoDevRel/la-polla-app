// lib/matches/is-placeholder.ts — Detecta team names que son placeholders del
// bracket en vez de equipos reales (ej: "W73", "Round of 32 1 Winner",
// "Group A 2nd Place", "1A", "3A/B/C/D/F", "TBD").
//
// Por que esto existe: REGLA #2 prohibe filas con teams placeholder en la
// tabla matches. Cuando ESPN/api-football devuelven un knockout aun no
// resuelto, vienen con team names sinteticos como esos. Antes de upsertear
// hay que skipearlos. La unica excepcion permitida son las "blind prediction
// rows" (TBD/TBD con external_id='blind:<tournament>:final') que se usan
// para pronosticos ciegos sobre la final — esas las maneja un cron separado.
//
// Importado por:
//   - lib/espn/discover.ts (funcion upsertMatch — guard antes del RPC)
//   - lib/api-football/sync.ts (handleFixture, ambos call sites)
//   - lib/api-football/sync-worldcup.ts (dispatch al RPC)

const PLACEHOLDER_PATTERNS: RegExp[] = [
  /^TBD$/i,
  // api-football style: "1A", "2B", "3C/D/F" (ranking + group letter, optionally
  // multiple groups separated by /)
  /^[0-9][A-Z]([/][A-Z])*$/,
  // api-football knockout slot: "W73", "L101" (winner/loser of match N)
  /^[WL][0-9]+$/,
  // ESPN knockout placeholders
  /^Group [A-Z] (Winner|2nd Place)/i,
  /^Round of [0-9]+ [0-9]+ Winner/i,
  /^Third Place/i,
  // ESPN 2026 World Cup specific labels seen in prod (defensive — agregar mas
  // si aparecen patrones nuevos de algun proveedor)
  /^Winner Group [A-Z]/i,
  /^Loser Group [A-Z]/i,
  /^Runner-up Group [A-Z]/i,
];

/**
 * True si el team name es un placeholder del bracket (no un equipo real).
 * NULL/empty se trata como placeholder defensivo — un team sin nombre no
 * deberia entrar a la DB de todas formas.
 */
export function isPlaceholderTeam(name: string | null | undefined): boolean {
  if (!name) return true;
  const trimmed = String(name).trim();
  if (!trimmed) return true;
  return PLACEHOLDER_PATTERNS.some((rx) => rx.test(trimmed));
}

/**
 * True si CUALQUIERA de los dos teams es placeholder. Si lo es, NO hay que
 * llamar upsert_match_safe — REGLA #2 lo prohibe.
 */
export function hasPlaceholderTeam(
  homeTeam: string | null | undefined,
  awayTeam: string | null | undefined,
): boolean {
  return isPlaceholderTeam(homeTeam) || isPlaceholderTeam(awayTeam);
}
