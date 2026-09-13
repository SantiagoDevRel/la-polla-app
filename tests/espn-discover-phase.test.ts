import { describe, expect, it } from 'vitest';
import { mapEspnPhase } from '@/lib/espn/discover';
import { TOURNAMENT_STRUCTURE } from '@/lib/tournaments/structure';

// Eventos REALES del scoreboard de ESPN, recortados a lo que lee mapEspnPhase
// (id, fecha, season, notes). Capturados el 2026-09-13 con una sola request
// por liga (?dates=… &limit=1000). season.type es un id por temporada, no un
// enum: se deja solo como evidencia de que no sirve para decidir fase.
type Ev = { id: string; date: string; season: { year: number; type: number; slug: string };
  competitions: Array<{ notes: Array<{ headline: string; type: string }> }> };
const ev = (id: string, date: string, year: number, type: number, slug: string, headline?: string): Ev =>
  ({ id, date, season: { year, type, slug },
    competitions: [{ notes: headline === undefined ? [] : [{ headline, type: 'event' }] }] });

const REAL: Array<[string, string, Ev, string]> = [
  // conmebol.libertadores (ago-nov 2026)
  ['libertadores_2026', 'Fluminense–Independiente Rivadavia, ida octavos',
    ev('401874070', '2026-08-11T22:00Z', 2026, 13924, 'round-of-16', '1st Leg'), 'round_of_16'],
  ['libertadores_2026', 'Independiente Rivadavia–Fluminense, vuelta octavos por penales',
    ev('401874156', '2026-08-18T22:00Z', 2026, 13924, 'round-of-16', '2nd Leg - Tied on aggregate - FLU win 5-4 on penalties'), 'round_of_16'],
  ['libertadores_2026', 'Fluminense–Platense, ida cuartos',
    ev('401912518', '2026-09-08T22:00Z', 2026, 13923, 'quarterfinals', '1st Leg'), 'quarter_finals'],
  ['libertadores_2026', 'Platense–Fluminense, vuelta cuartos',
    ev('401912517', '2026-09-15T22:00Z', 2026, 13923, 'quarterfinals', '2nd Leg - Fluminense lead 2-0 on aggregate'), 'quarter_finals'],
  ['libertadores_2026', 'semifinal ida (equipos por definir)',
    ev('401912522', '2026-10-14T18:00Z', 2026, 13922, 'semifinals', '1st Leg'), 'semi_finals'],
  ['libertadores_2026', 'final (sin headline)',
    ev('401912519', '2026-11-28T20:00Z', 2026, 13921, 'final'), 'final'],
  // conmebol.sudamericana (ago-sep 2026)
  ['sudamericana_2026', 'Boca Juniors–Deportivo Recoleta, ida octavos',
    ev('401903297', '2026-08-11T22:00Z', 2026, 13915, 'round-of-16', '1st Leg'), 'round_of_16'],
  ['sudamericana_2026', 'Independiente Santa Fe–Vasco da Gama, ida cuartos',
    ev('401913960', '2026-09-08T22:00Z', 2026, 13914, 'quarterfinals', '1st Leg'), 'quarter_finals'],
  ['sudamericana_2026', 'Vasco da Gama–Independiente Santa Fe, vuelta cuartos',
    ev('401913959', '2026-09-15T22:00Z', 2026, 13914, 'quarterfinals', '2nd Leg - Tied on aggregate'), 'quarter_finals'],
  // uefa.champions (temporada 2025/26, ene-may 2026)
  ['champions_2025', 'Kairat Almaty–Club Brugge, fase de liga',
    ev('757761', '2026-01-20T15:30Z', 2025, 13682, 'league-phase'), 'league_stage'],
  ['champions_2025', 'Galatasaray–Juventus, ida playoffs',
    ev('401858759', '2026-02-17T17:45Z', 2025, 13681, 'knockout-round-playoffs', '1st Leg'), 'playoff'],
  ['champions_2025', 'Atlético Madrid–Club Brugge, vuelta playoffs',
    ev('401858768', '2026-02-24T17:45Z', 2025, 13681, 'knockout-round-playoffs', '2nd Leg - Atlético Madrid advance 7-4 on aggregate'), 'playoff'],
  ['champions_2025', 'Galatasaray–Liverpool, ida octavos',
    ev('401862667', '2026-03-10T17:45Z', 2025, 13680, 'round-of-16', '1st Leg'), 'round_of_16'],
  ['champions_2025', 'Real Madrid–Bayern Munich, ida cuartos',
    ev('401862886', '2026-04-07T19:00Z', 2025, 13679, 'quarterfinals', '1st Leg'), 'quarter_finals'],
  ['champions_2025', 'Arsenal–Atlético Madrid, vuelta semis',
    ev('401862896', '2026-05-05T19:00Z', 2025, 13678, 'semifinals', '2nd Leg - Arsenal advance 2-1 on aggregate'), 'semi_finals'],
  ['champions_2025', 'Paris Saint-Germain–Arsenal, final por penales',
    ev('401862897', '2026-05-30T16:00Z', 2025, 13677, 'final', 'Paris Saint-Germain win 4-3 on penalties'), 'final'],
  // uefa.europa (temporada 2025/26)
  ['europa_2026', 'Bologna–Celtic, fase de liga',
    ev('757913', '2026-01-22T17:45Z', 2025, 13688, 'league-phase'), 'league_stage'],
  ['europa_2026', 'Dinamo Zagreb–Racing Genk, ida playoffs',
    ev('401858777', '2026-02-19T17:45Z', 2025, 13687, 'knockout-round-playoffs', '1st Leg'), 'playoff'],
  ['europa_2026', 'Braga–Ferencvaros, vuelta octavos',
    ev('401862758', '2026-03-18T15:30Z', 2025, 13686, 'round-of-16', '2nd Leg - Braga advance 4-2 on aggregate'), 'round_of_16'],
  ['europa_2026', 'Braga–Real Betis, ida cuartos',
    ev('401862899', '2026-04-08T16:45Z', 2025, 13685, 'quarterfinals', '1st Leg'), 'quarter_finals'],
  ['europa_2026', 'Aston Villa–Nottingham Forest, vuelta semis',
    ev('401862910', '2026-05-07T19:00Z', 2025, 13684, 'semifinals', '2nd Leg - Aston Villa advance 4-1 on aggregate'), 'semi_finals'],
  ['europa_2026', 'SC Freiburg–Aston Villa, final (sin headline)',
    ev('401862911', '2026-05-20T19:00Z', 2025, 13683, 'final'), 'final'],
  // col.1: la fase regular trae slug "clausura" (sin ronda → regular_season).
  // Las eliminatorias de temporadas pasadas llegaron compuestas (ver abajo).
  ['betplay_2026', 'Fortaleza CEIF–Once Caldas, Clausura',
    ev('401878055', '2026-09-02T01:00Z', 2026, 13938, 'clausura'), 'regular_season'],
];

describe('ESPN discover: fase desde season.slug', () => {
  it.each(REAL)('%s · %s', (tournament, _label, event, phase) => {
    expect(mapEspnPhase(event, tournament)).toBe(phase);
  });

  it('solo emite fases canónicas que ya usa structure.ts', () => {
    const canonical = new Set(Object.values(TOURNAMENT_STRUCTURE).flatMap((t) => t.phases.map((p) => p.phase)));
    for (const [tournament, , event] of REAL) {
      expect(canonical.has(mapEspnPhase(event, tournament) as never)).toBe(true);
    }
  });

  it('el slug manda sobre el headline y sobre el default del torneo', () => {
    // Con el código anterior "1st Leg" caía al default: group_stage para
    // CONMEBOL y league_stage para UCL, y la final de UCL también.
    expect(mapEspnPhase(ev('401912518', '2026-09-08T22:00Z', 2026, 13923, 'quarterfinals', '1st Leg'), 'libertadores_2026'))
      .not.toBe('group_stage');
    expect(mapEspnPhase(ev('401862897', '2026-05-30T16:00Z', 2025, 13677, 'final', 'Paris Saint-Germain win 4-3 on penalties'), 'champions_2025'))
      .not.toBe('league_stage');
  });

  it('BetPlay: "clausura" no se interpreta como playoffs aunque sea nov-dic', () => {
    expect(mapEspnPhase(ev('x', '2026-12-10T01:00Z', 2026, 13938, 'clausura'), 'betplay_2026')).toBe('regular_season');
  });

  it('BetPlay: slugs compuestos de eliminatorias mapean la ronda', () => {
    expect(mapEspnPhase(ev('x', '2025-11-20T01:00Z', 2025, 13938, 'clausura---semifinals'), 'betplay_2026')).toBe('semi_finals');
    expect(mapEspnPhase(ev('x', '2025-05-20T01:00Z', 2025, 13938, 'apertura---quarterfinals'), 'betplay_2026')).toBe('quarter_finals');
    expect(mapEspnPhase(ev('x', '2025-12-15T01:00Z', 2025, 13938, 'playoffs---finals'), 'betplay_2026')).toBe('final');
    expect(mapEspnPhase(ev('x', '2025-12-15T01:00Z', 2025, 13938, 'clausura---algo-nuevo'), 'betplay_2026')).toBe('regular_season');
  });

  it('el slug gana aunque el headline nombre otra ronda', () => {
    expect(mapEspnPhase(ev('x', '2026-10-14T22:00Z', 2026, 13923, 'quarterfinals', 'Semifinal - 1st Leg'), 'libertadores_2026'))
      .toBe('quarter_finals');
  });
});

describe('ESPN discover: fallback cuando el slug no dice ronda', () => {
  // Casos SINTÉTICOS: prueban que el comportamiento anterior sigue intacto.
  const noSeason = (headline?: string) => ({ competitions: [{ notes: headline ? [{ headline, type: 'event' }] : [] }] });

  it('sin season usa el headline como antes', () => {
    expect(mapEspnPhase(noSeason('Quarterfinal'), 'libertadores_2026')).toBe('quarter_finals');
    expect(mapEspnPhase(noSeason('Group Stage'), 'libertadores_2026')).toBe('group_stage');
  });

  it('sin season ni headline usa el default del torneo', () => {
    expect(mapEspnPhase(noSeason(), 'libertadores_2026')).toBe('group_stage');
    expect(mapEspnPhase(noSeason(), 'champions_2025')).toBe('league_stage');
    expect(mapEspnPhase(noSeason(), 'laliga_2025')).toBe('regular_season');
  });

  it('un slug desconocido no inventa fase', () => {
    expect(mapEspnPhase(ev('x', '2026-10-01T00:00Z', 2026, 1, '2026-27'), 'laliga_2025')).toBe('regular_season');
    expect(mapEspnPhase(ev('x', '2026-10-01T00:00Z', 2026, 1, 'constructor'), 'sudamericana_2026')).toBe('group_stage');
    expect(mapEspnPhase({ season: { slug: 42 }, competitions: [] }, 'europa_2026')).toBe('league_stage');
  });
});
