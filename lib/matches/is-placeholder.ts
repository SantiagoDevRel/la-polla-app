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
  // Catch-all robusto: cualquier slot de avance termina en "... Winner" /
  // "... Loser" (ej. "Quarterfinal 1 Winner", "Semifinal 2 Loser", "Round of
  // 32 1 Winner") o contiene "... Place" (ej. "Group J 2nd Place", "Third
  // Place ..."). Ningun equipo real matchea estos — evita promover un slot a
  // un placeholder (bug cazado 2026-06-28 con el resolver ESPN).
  / (Winner|Loser)$/i,
  /\bPlace\b/i,
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

/**
 * Lecciones aprendidas 2026-05-12: REGLA #2 era demasiado fuerte para
 * el Mundial. Los slots de knockout (104 partidos totales: 72 grupo +
 * 32 knockout) SI deben existir en DB para que el organizador arme su
 * polla con todos los partidos. La diferencia con un TBD ruidoso es que
 * estos slots tienen INFORMACION ESTRUCTURAL en el nombre del team:
 * "1A" = ganador grupo A, "W73" = ganador del partido 73, etc.
 *
 * Esta funcion INFIERE la fase a partir del nombre del team siguiendo la
 * numeracion oficial del Mundial 2026:
 *   - Group stage: matches 1-72.
 *   - Round of 32 (16 partidos):  73-88. Teams: "1A", "2B", "3X/Y/Z".
 *   - Round of 16  (8 partidos):  89-96. Teams: "W73"-"W88".
 *   - Quarter-finals (4 partidos): 97-100. Teams: "W89"-"W96".
 *   - Semi-finals (2 partidos):  101-102. Teams: "W97"-"W100".
 *   - Third place:                  103. Teams: "L101", "L102".
 *   - Final:                        104. Teams: "W101", "W102".
 *
 * Si el team name no matchea ninguno de estos patrones, devuelve null
 * (no es un slot del Mundial — caer al guard placeholder normal).
 */
export type WorldCupKnockoutPhase =
  | "round_of_32"
  | "round_of_16"
  | "quarter_finals"
  | "semi_finals"
  | "third_place"
  | "final";

export function inferWorldCupKnockoutPhase(
  homeTeam: string | null | undefined,
  awayTeam: string | null | undefined,
): WorldCupKnockoutPhase | null {
  const home = String(homeTeam ?? "").trim();
  const away = String(awayTeam ?? "").trim();
  if (!home || !away) return null;

  const isR32Slot = (s: string) => /^[0-9][A-Z]([/][A-Z])*$/.test(s);
  if (isR32Slot(home) && isR32Slot(away)) return "round_of_32";

  const num = (s: string): { kind: "W" | "L"; n: number } | null => {
    const m = s.match(/^([WL])(\d+)$/);
    if (!m) return null;
    return { kind: m[1] as "W" | "L", n: parseInt(m[2], 10) };
  };
  const h = num(home);
  const a = num(away);
  if (!h || !a) return null;

  // Combinaciones especificas para final / 3rd place (numeros 101-102).
  if (h.n === 101 && a.n === 102) {
    if (h.kind === "L" && a.kind === "L") return "third_place";
    if (h.kind === "W" && a.kind === "W") return "final";
  }

  const maxN = Math.max(h.n, a.n);
  if (maxN >= 73 && maxN <= 88) return "round_of_16";
  if (maxN >= 89 && maxN <= 96) return "quarter_finals";
  if (maxN >= 97 && maxN <= 100) return "semi_finals";
  return null;
}
