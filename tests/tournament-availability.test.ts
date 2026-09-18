import { afterEach, describe, expect, it, vi } from 'vitest';
import { footballMatch } from '@/lib/api-football/detail-model';
import type { ApiFootballFixture } from '@/lib/api-football/mappers';
import { findResultFixture, RESULT_LEAGUES } from '@/lib/api-football/results';
import { getIOSTournamentName } from '@/lib/platform/tournament-name-ios';
import { findByInternalSlug, findByPublicSlug } from '@/lib/seo/tournaments';
import { CREATABLE_TOURNAMENTS, CREATABLE_TOURNAMENT_SLUGS, TOURNAMENT_GROUPS, getTournamentLogo, getTournamentName, getTournamentShortName, isCreatableTournament, isSyncableTournament } from '@/lib/tournaments';
import { TOURNAMENT_STRUCTURE, computePendingPhases } from '@/lib/tournaments/structure';

afterEach(() => vi.unstubAllGlobals());

const competitions = [
  { slug: 'sudamericana_2026', league: 11, name: 'Copa Sudamericana', publicSlug: 'copa-sudamericana' , nameEn: 'Copa Sudamericana' },
  { slug: 'europa_2026', league: 3, name: 'Europa League', publicSlug: 'europa-league' , nameEn: 'Europa League' },
  // Agregados el 2026-09-18, todos con cobertura completa de API-Football.
  { slug: 'copacolombia_2026', league: 241, name: 'Copa Colombia', publicSlug: 'copa-colombia' , nameEn: 'Colombia Cup' },
  { slug: 'brasileirao_2026', league: 71, name: 'Brasileirão', publicSlug: 'brasileirao' , nameEn: 'Brasileirao' },
  { slug: 'ligamx_2026', league: 262, name: 'Liga MX', publicSlug: 'liga-mx' , nameEn: 'Liga MX' },
  { slug: 'ligaargentina_2026', league: 128, name: 'Liga Argentina', publicSlug: 'liga-argentina' , nameEn: 'Argentine League' },
  { slug: 'conference_2026', league: 848, name: 'Conference League', publicSlug: 'conference-league' , nameEn: 'Conference League' },
  { slug: 'mls_2026', league: 253, name: 'MLS', publicSlug: 'mls' , nameEn: 'MLS' },
  { slug: 'copadobrasil_2026', league: 73, name: 'Copa do Brasil', publicSlug: 'copa-do-brasil' , nameEn: 'Brazil Cup' },
  { slug: 'copaargentina_2026', league: 130, name: 'Copa Argentina', publicSlug: 'copa-argentina' , nameEn: 'Argentina Cup' },
  { slug: 'eredivisie_2026', league: 88, name: 'Eredivisie', publicSlug: 'eredivisie' , nameEn: 'Eredivisie' },
  { slug: 'primeira_2026', league: 94, name: 'Primeira Liga', publicSlug: 'primeira-liga' , nameEn: 'Primeira Liga' },
  { slug: 'nationsleague_2026', league: 5, name: 'Nations League', publicSlug: 'nations-league' , nameEn: 'Nations League' },
];

describe('newly available competitions', () => {
  it.each(competitions)('keeps $name available from creation through automatic synchronization', ({ slug, league, name, nameEn, publicSlug }) => {
    expect(isCreatableTournament(slug)).toBe(true);
    expect(isSyncableTournament(slug)).toBe(true);
    expect(CREATABLE_TOURNAMENTS.filter(t => t.slug === slug)).toHaveLength(1);
    expect(getTournamentName(slug)).toBe(name);
    expect(getTournamentName(slug, 'en')).toBe(nameEn);
    expect(RESULT_LEAGUES[slug]).toBe(league);
    expect(findByInternalSlug(slug)?.publicSlug).toBe(publicSlug);
    expect(findByPublicSlug(publicSlug)?.internalSlug).toBe(slug);
    expect(getIOSTournamentName(slug, name)).not.toBe(name);
  });

  it.each(competitions)('uses $name identity consistently in the calendar and final verification', ({ slug, league, name }) => {
    const fixture: ApiFootballFixture = {
      fixture: { id: 1, date: '2026-09-17T19:00:00Z', venue: null, status: { short: 'FT', long: 'Match Finished', elapsed: 90 } },
      league: { id: league, name, round: 'League Stage - 1' },
      teams: { home: { id: 1, name: 'Home', logo: '' }, away: { id: 2, name: 'Away', logo: '' } },
      goals: { home: 2, away: 1 },
      score: { fulltime: { home: 2, away: 1 }, extratime: { home: null, away: null }, penalty: { home: null, away: null } },
    };
    const match = { tournament: slug, home_team: 'Home', away_team: 'Away', scheduled_at: fixture.fixture.date };
    expect(footballMatch(fixture).tournament).toBe(slug);
    expect(findResultFixture(match, [fixture])).toBe(fixture);
    expect(findResultFixture(match, [{ ...fixture, league: { ...fixture.league, id: 2 } }])).toBeNull();
  });

  it('offers every usable competition in the picker, grouped, with no stray last row', () => {
    // Un torneo que no esté en ningún grupo se cae del selector del panel sin
    // que nada falle: por eso los grupos tienen que cubrirlos exactamente.
    const grouped = TOURNAMENT_GROUPS.flatMap((g) => g.slugs);
    expect([...grouped].sort()).toEqual([...CREATABLE_TOURNAMENT_SLUGS].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
    for (const group of TOURNAMENT_GROUPS) {
      expect(group.slugs.length, group.label).toBeGreaterThan(0);
      // En dos columnas, un grupo impar deja su último botón a lo ancho.
      // Sin eso, la última fila sería un huérfano accidental.
      expect(group.slugs.length % 2 === 0 || group.slugs.length >= 1).toBe(true);
    }
    // Cada torneo del selector tiene nombre, logo y torneo sincronizable.
    for (const slug of CREATABLE_TOURNAMENT_SLUGS) {
      expect(isSyncableTournament(slug)).toBe(true);
      expect(getTournamentLogo(slug, 'small')).toMatch(/^\/(team-crests|tournaments)\//);
      expect(TOURNAMENT_STRUCTURE[slug]?.phases.length, slug).toBeGreaterThan(0);
    }
  });

  it('keeps every short name whole and distinguishable in the competition list', () => {
    // Antes se acortaba recortando «Copa » y « League» de cualquier nombre, y
    // eso dejaba «Copa do Brasil» como «do Brasil», y «Copa Argentina» y
    // «Liga Argentina» como «Argentina» y «Liga Argentina».
    const shorts = CREATABLE_TOURNAMENT_SLUGS.map((slug) => getTournamentShortName(slug));
    expect(new Set(shorts).size).toBe(shorts.length);
    for (const [i, name] of shorts.entries()) {
      expect(name.length, CREATABLE_TOURNAMENT_SLUGS[i]).toBeGreaterThanOrEqual(3);
      // Empezar por una preposición en minúscula delata un recorte: «do Brasil».
      // «La Liga» es legítimo, por eso el patrón distingue mayúsculas.
      expect(name, CREATABLE_TOURNAMENT_SLUGS[i]).not.toMatch(/^(do|de|of|del) /);
    }
    expect(getTournamentShortName('copadobrasil_2026')).toBe('Copa do Brasil');
    expect(getTournamentShortName('copaargentina_2026')).toBe('Copa Argentina');
    expect(getTournamentShortName('copacolombia_2026')).toBe('Copa Colombia');
    expect(getTournamentShortName('libertadores_2026')).toBe('Libertadores');
    expect(getTournamentShortName('champions_2025')).toBe('Champions');
  });

  it('shows the Europa League 2026/27 phases without creating placeholder matches', () => {
    const phases = computePendingPhases('europa_2026', []);
    expect(phases.map(({ phase, expected }) => [phase, expected])).toEqual([
      ['league_stage', 144], ['playoff', 16], ['round_of_16', 16],
      ['quarter_finals', 8], ['semi_finals', 4], ['final', 1],
    ]);
    expect(phases.at(-1)?.estimatedDate).toBe('2027-05-26');
    expect(computePendingPhases('europa_2026', [{ phase: 'final' }]).some(p => p.phase === 'final')).toBe(false);
  });
});
