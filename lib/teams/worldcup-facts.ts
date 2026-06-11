// lib/teams/worldcup-facts.ts — Ficha estática de las 48 selecciones del
// Mundial 2026 para el TeamInfoSheet. Las keys son los nombres EXACTOS
// que vienen en matches.home_team / away_team (inglés, fuente
// football-data/openfootball — ver query de equipos distintos del
// torneo worldcup_2026).
//
// ⚠️ fifaRank es el ranking FIFA de nov-2025 (último publicado antes
// del torneo al momento de escribir esto) — es aproximado y se edita
// A MANO cuando salga uno nuevo. participations cuenta INCLUYENDO 2026.
// bestResult es el mejor resultado histórico en Mundiales (hasta 2022).

export interface TeamFacts {
  /** Nombre en español para el header del sheet. */
  nameEs: string;
  /** Ranking FIFA aproximado (nov-2025). */
  fifaRank: number;
  confederation: "CONMEBOL" | "UEFA" | "CONCACAF" | "CAF" | "AFC" | "OFC";
  /** Participaciones en Mundiales contando 2026. */
  participations: number;
  /** Mejor resultado histórico, copy es-CO listo para UI. */
  bestResultEs: string;
  /** Same, English copy for chickenpicks.app. */
  bestResultEn: string;
}

export const WORLDCUP_FACTS: Record<string, TeamFacts> = {
  "Algeria":            { nameEs: "Argelia",          fifaRank: 35, confederation: "CAF",      participations: 5,  bestResultEs: "Octavos de final (2014)",            bestResultEn: "Round of 16 (2014)" },
  "Argentina":          { nameEs: "Argentina",        fifaRank: 2,  confederation: "CONMEBOL", participations: 19, bestResultEs: "Campeón ×3 (1978, 1986, 2022)",      bestResultEn: "Champions ×3 (1978, 1986, 2022)" },
  "Australia":          { nameEs: "Australia",        fifaRank: 26, confederation: "AFC",      participations: 7,  bestResultEs: "Octavos de final (2006, 2022)",      bestResultEn: "Round of 16 (2006, 2022)" },
  "Austria":            { nameEs: "Austria",          fifaRank: 22, confederation: "UEFA",     participations: 8,  bestResultEs: "Tercer puesto (1954)",               bestResultEn: "Third place (1954)" },
  "Belgium":            { nameEs: "Bélgica",          fifaRank: 8,  confederation: "UEFA",     participations: 15, bestResultEs: "Tercer puesto (2018)",               bestResultEn: "Third place (2018)" },
  "Bosnia-Herzegovina": { nameEs: "Bosnia y Herzegovina", fifaRank: 70, confederation: "UEFA", participations: 2,  bestResultEs: "Fase de grupos (2014)",              bestResultEn: "Group stage (2014)" },
  "Brazil":             { nameEs: "Brasil",           fifaRank: 5,  confederation: "CONMEBOL", participations: 23, bestResultEs: "Campeón ×5 (58, 62, 70, 94, 2002)",  bestResultEn: "Champions ×5 (58, 62, 70, 94, 2002)" },
  "Canada":             { nameEs: "Canadá",           fifaRank: 28, confederation: "CONCACAF", participations: 3,  bestResultEs: "Fase de grupos (1986, 2022)",        bestResultEn: "Group stage (1986, 2022)" },
  "Cape Verde":         { nameEs: "Cabo Verde",       fifaRank: 71, confederation: "CAF",      participations: 1,  bestResultEs: "Debut en Mundiales",                 bestResultEn: "World Cup debut" },
  "Colombia":           { nameEs: "Colombia",         fifaRank: 13, confederation: "CONMEBOL", participations: 7,  bestResultEs: "Cuartos de final (2014)",            bestResultEn: "Quarter-finals (2014)" },
  "Croatia":            { nameEs: "Croacia",          fifaRank: 10, confederation: "UEFA",     participations: 7,  bestResultEs: "Subcampeón (2018)",                  bestResultEn: "Runners-up (2018)" },
  "Curacao":            { nameEs: "Curazao",          fifaRank: 82, confederation: "CONCACAF", participations: 1,  bestResultEs: "Debut en Mundiales",                 bestResultEn: "World Cup debut" },
  "Czechia":            { nameEs: "Chequia",          fifaRank: 40, confederation: "UEFA",     participations: 1,  bestResultEs: "Subcampeón como Checoslovaquia (1934, 1962)", bestResultEn: "Runners-up as Czechoslovakia (1934, 1962)" },
  "DR Congo":           { nameEs: "RD del Congo",     fifaRank: 56, confederation: "CAF",      participations: 2,  bestResultEs: "Fase de grupos como Zaire (1974)",   bestResultEn: "Group stage as Zaire (1974)" },
  "Ecuador":            { nameEs: "Ecuador",          fifaRank: 24, confederation: "CONMEBOL", participations: 5,  bestResultEs: "Octavos de final (2006)",            bestResultEn: "Round of 16 (2006)" },
  "Egypt":              { nameEs: "Egipto",           fifaRank: 34, confederation: "CAF",      participations: 4,  bestResultEs: "Fase de grupos (1934, 1990, 2018)",  bestResultEn: "Group stage (1934, 1990, 2018)" },
  "England":            { nameEs: "Inglaterra",       fifaRank: 4,  confederation: "UEFA",     participations: 17, bestResultEs: "Campeón (1966)",                     bestResultEn: "Champions (1966)" },
  "France":             { nameEs: "Francia",          fifaRank: 3,  confederation: "UEFA",     participations: 17, bestResultEs: "Campeón ×2 (1998, 2018)",            bestResultEn: "Champions ×2 (1998, 2018)" },
  "Germany":            { nameEs: "Alemania",         fifaRank: 9,  confederation: "UEFA",     participations: 21, bestResultEs: "Campeón ×4 (54, 74, 90, 2014)",      bestResultEn: "Champions ×4 (54, 74, 90, 2014)" },
  "Ghana":              { nameEs: "Ghana",            fifaRank: 72, confederation: "CAF",      participations: 5,  bestResultEs: "Cuartos de final (2010)",            bestResultEn: "Quarter-finals (2010)" },
  "Haiti":              { nameEs: "Haití",            fifaRank: 84, confederation: "CONCACAF", participations: 2,  bestResultEs: "Fase de grupos (1974)",              bestResultEn: "Group stage (1974)" },
  "Iran":               { nameEs: "Irán",             fifaRank: 21, confederation: "AFC",      participations: 7,  bestResultEs: "Fase de grupos (6 participaciones)", bestResultEn: "Group stage (6 appearances)" },
  "Iraq":               { nameEs: "Irak",             fifaRank: 58, confederation: "AFC",      participations: 2,  bestResultEs: "Fase de grupos (1986)",              bestResultEn: "Group stage (1986)" },
  "Ivory Coast":        { nameEs: "Costa de Marfil",  fifaRank: 42, confederation: "CAF",      participations: 4,  bestResultEs: "Fase de grupos (2006, 2010, 2014)",  bestResultEn: "Group stage (2006, 2010, 2014)" },
  "Japan":              { nameEs: "Japón",            fifaRank: 18, confederation: "AFC",      participations: 8,  bestResultEs: "Octavos de final ×4 (02, 10, 18, 22)", bestResultEn: "Round of 16 ×4 (02, 10, 18, 22)" },
  "Jordan":             { nameEs: "Jordania",         fifaRank: 64, confederation: "AFC",      participations: 1,  bestResultEs: "Debut en Mundiales",                 bestResultEn: "World Cup debut" },
  "Mexico":             { nameEs: "México",           fifaRank: 14, confederation: "CONCACAF", participations: 18, bestResultEs: "Cuartos de final (1970, 1986)",      bestResultEn: "Quarter-finals (1970, 1986)" },
  "Morocco":            { nameEs: "Marruecos",        fifaRank: 11, confederation: "CAF",      participations: 7,  bestResultEs: "Cuarto puesto (2022)",               bestResultEn: "Fourth place (2022)" },
  "Netherlands":        { nameEs: "Países Bajos",     fifaRank: 7,  confederation: "UEFA",     participations: 12, bestResultEs: "Subcampeón ×3 (1974, 1978, 2010)",   bestResultEn: "Runners-up ×3 (1974, 1978, 2010)" },
  "New Zealand":        { nameEs: "Nueva Zelanda",    fifaRank: 86, confederation: "OFC",      participations: 3,  bestResultEs: "Fase de grupos, invicto (2010)",     bestResultEn: "Group stage, unbeaten (2010)" },
  "Norway":             { nameEs: "Noruega",          fifaRank: 29, confederation: "UEFA",     participations: 4,  bestResultEs: "Octavos de final (1998)",            bestResultEn: "Round of 16 (1998)" },
  "Panama":             { nameEs: "Panamá",           fifaRank: 33, confederation: "CONCACAF", participations: 2,  bestResultEs: "Fase de grupos (2018)",              bestResultEn: "Group stage (2018)" },
  "Paraguay":           { nameEs: "Paraguay",         fifaRank: 39, confederation: "CONMEBOL", participations: 9,  bestResultEs: "Cuartos de final (2010)",            bestResultEn: "Quarter-finals (2010)" },
  "Portugal":           { nameEs: "Portugal",         fifaRank: 6,  confederation: "UEFA",     participations: 9,  bestResultEs: "Tercer puesto (1966)",               bestResultEn: "Third place (1966)" },
  "Qatar":              { nameEs: "Catar",            fifaRank: 51, confederation: "AFC",      participations: 2,  bestResultEs: "Fase de grupos (2022)",              bestResultEn: "Group stage (2022)" },
  "Saudi Arabia":       { nameEs: "Arabia Saudita",   fifaRank: 60, confederation: "AFC",      participations: 7,  bestResultEs: "Octavos de final (1994)",            bestResultEn: "Round of 16 (1994)" },
  "Scotland":           { nameEs: "Escocia",          fifaRank: 38, confederation: "UEFA",     participations: 9,  bestResultEs: "Fase de grupos (8 participaciones)", bestResultEn: "Group stage (8 appearances)" },
  "Senegal":            { nameEs: "Senegal",          fifaRank: 19, confederation: "CAF",      participations: 4,  bestResultEs: "Cuartos de final (2002)",            bestResultEn: "Quarter-finals (2002)" },
  "South Africa":       { nameEs: "Sudáfrica",        fifaRank: 59, confederation: "CAF",      participations: 4,  bestResultEs: "Fase de grupos (1998, 2002, 2010)",  bestResultEn: "Group stage (1998, 2002, 2010)" },
  "South Korea":        { nameEs: "Corea del Sur",    fifaRank: 23, confederation: "AFC",      participations: 12, bestResultEs: "Cuarto puesto (2002)",               bestResultEn: "Fourth place (2002)" },
  "Spain":              { nameEs: "España",           fifaRank: 1,  confederation: "UEFA",     participations: 17, bestResultEs: "Campeón (2010)",                     bestResultEn: "Champions (2010)" },
  "Sweden":             { nameEs: "Suecia",           fifaRank: 27, confederation: "UEFA",     participations: 13, bestResultEs: "Subcampeón (1958)",                  bestResultEn: "Runners-up (1958)" },
  "Switzerland":        { nameEs: "Suiza",            fifaRank: 17, confederation: "UEFA",     participations: 13, bestResultEs: "Cuartos de final (1934, 1938, 1954)", bestResultEn: "Quarter-finals (1934, 1938, 1954)" },
  "Tunisia":            { nameEs: "Túnez",            fifaRank: 43, confederation: "CAF",      participations: 7,  bestResultEs: "Fase de grupos (6 participaciones)", bestResultEn: "Group stage (6 appearances)" },
  "Türkiye":            { nameEs: "Turquía",          fifaRank: 25, confederation: "UEFA",     participations: 3,  bestResultEs: "Tercer puesto (2002)",               bestResultEn: "Third place (2002)" },
  "United States":      { nameEs: "Estados Unidos",   fifaRank: 16, confederation: "CONCACAF", participations: 12, bestResultEs: "Tercer puesto (1930)",               bestResultEn: "Third place (1930)" },
  "Uruguay":            { nameEs: "Uruguay",          fifaRank: 15, confederation: "CONMEBOL", participations: 15, bestResultEs: "Campeón ×2 (1930, 1950)",            bestResultEn: "Champions ×2 (1930, 1950)" },
  "Uzbekistan":         { nameEs: "Uzbekistán",       fifaRank: 57, confederation: "AFC",      participations: 1,  bestResultEs: "Debut en Mundiales",                 bestResultEn: "World Cup debut" },
};

/** Lookup tolerante: nombre exacto primero, luego case-insensitive. */
export function getTeamFacts(teamName: string): TeamFacts | null {
  if (WORLDCUP_FACTS[teamName]) return WORLDCUP_FACTS[teamName];
  const lower = teamName.trim().toLowerCase();
  for (const [key, facts] of Object.entries(WORLDCUP_FACTS)) {
    if (key.toLowerCase() === lower) return facts;
  }
  return null;
}
