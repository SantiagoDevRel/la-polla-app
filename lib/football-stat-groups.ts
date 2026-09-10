type Stat = { key: string; label: string; home: string; away: string };
const CATEGORIES = [
  { id: 'general', es: 'General', en: 'Overview', keys: ['possessionPct','totalShots','shotsOnTarget','expectedGoals','wonCorners','saves'] },
  { id: 'attack', es: 'Ataque', en: 'Attack', keys: ['totalShots','shotsOnTarget','shotsOffTarget','blockedShots','shotsInsideBox','shotsOutsideBox','expectedGoals','wonCorners','offsides','shotPct','penaltyKickGoals','penaltyKickShots'] },
  { id: 'passing', es: 'Pases', en: 'Passing', keys: ['possessionPct','totalPasses','accuratePasses','passPct','accurateCrosses','totalCrosses','crossPct','totalLongBalls','accurateLongBalls','longballPct'] },
  { id: 'defense', es: 'Defensa', en: 'Defence', keys: ['saves','foulsCommitted','yellowCards','redCards','effectiveTackles','totalTackles','tacklePct','interceptions','effectiveClearance','totalClearance'] },
];

/** Keep every provider metric reachable, including keys added in future feeds. */
export function footballStatGroups(stats: Stat[]) {
  const groups = CATEGORIES.map(category => ({ ...category, stats: category.keys.flatMap(key => stats.filter(stat => stat.key === key)) }))
    .filter(category => category.stats.length > 0);
  const other = stats.filter(stat => !CATEGORIES.some(category => category.keys.includes(stat.key)));
  if (other.length) groups.push({ id: 'more', es: 'Más', en: 'More', keys: other.map(stat => stat.key), stats: other });
  return groups;
}
