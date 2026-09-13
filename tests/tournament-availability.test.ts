import { afterEach, describe, expect, it, vi } from 'vitest';
import { footballMatch } from '@/lib/api-football/detail-model';
import type { ApiFootballFixture } from '@/lib/api-football/mappers';
import { findResultFixture, RESULT_LEAGUES } from '@/lib/api-football/results';
import { ESPN_ONLY_TOURNAMENTS, fetchEspnScoreboard } from '@/lib/espn/client';
import { getIOSTournamentName } from '@/lib/platform/tournament-name-ios';
import { findByInternalSlug, findByPublicSlug } from '@/lib/seo/tournaments';
import { CREATABLE_TOURNAMENTS, getTournamentName, isCreatableTournament, isSyncableTournament } from '@/lib/tournaments';
import { computePendingPhases } from '@/lib/tournaments/structure';

afterEach(() => vi.unstubAllGlobals());

const competitions = [
  { slug: 'sudamericana_2026', league: 11, espn: 'conmebol.sudamericana', name: 'Copa Sudamericana', publicSlug: 'copa-sudamericana' },
  { slug: 'europa_2026', league: 3, espn: 'uefa.europa', name: 'Europa League', publicSlug: 'europa-league' },
];

describe('newly available competitions', () => {
  it.each(competitions)('keeps $name available from creation through automatic synchronization', ({ slug, league, name, publicSlug }) => {
    expect(isCreatableTournament(slug)).toBe(true);
    expect(isSyncableTournament(slug)).toBe(true);
    expect(CREATABLE_TOURNAMENTS.filter(t => t.slug === slug)).toHaveLength(1);
    expect(getTournamentName(slug)).toBe(name);
    expect(getTournamentName(slug, 'en')).toBe(name);
    expect(RESULT_LEAGUES[slug]).toBe(league);
    expect(ESPN_ONLY_TOURNAMENTS.has(slug)).toBe(true);
    expect(findByInternalSlug(slug)?.publicSlug).toBe(publicSlug);
    expect(findByPublicSlug(publicSlug)?.internalSlug).toBe(slug);
    expect(getIOSTournamentName(slug, name)).not.toBe(name);
  });

  it.each(competitions)('requests the correct ESPN fallback for $name', async ({ slug, espn }) => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ events: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    expect(await fetchEspnScoreboard(slug)).toEqual([]);
    expect(fetch).toHaveBeenCalledWith(
      `https://site.api.espn.com/apis/site/v2/sports/soccer/${espn}/scoreboard`,
      expect.objectContaining({ cache: 'no-store' }),
    );
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
