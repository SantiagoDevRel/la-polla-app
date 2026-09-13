import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import catalog from '@/lib/teams/crest-catalog.json';
import squadCrests from '@/lib/teams/worldcup-club-crests.json';
import squads from '@/lib/teams/baked-worldcup-squads.json';
import { crestFallbackSource, localCrestSource } from '@/lib/teams/crest-source';

vi.mock('server-only', () => ({}));
const { bakedClubCrest, getBakedWorldCupRoster } = await import('@/lib/teams/baked-squads');

// Sin proxy de escudos de ESPN (2026-09-13): toda URL histórica de ESPN en
// `matches` es solo una IDENTIDAD que resuelve a un WebP local.
// Snapshot de producción (SELECT DISTINCT home/away_team_flag ILIKE '%espncdn%',
// 2026-09-13): 114 ids de club.
const PROD_ESPN_CREST_IDS = `10060 10094 102 10309 104 1068 110 114 11420 11995 12 124 132 134 142 148 15 16 160 166 17
17086 17090 175 17702 18 18439 18995 19002 19425 2022 2026 2029 20889 21922 2250 22517 244 2572 2670 2671 2672 2673 2674
2675 2681 2683 2684 2685 2686 2690 2919 2980 3372 3445 3454 359 360 362 364 382 4138 432 436 437 4411 4422 4811 4812 4815
4816 4928 493 494 5 510 521 5264 5267 5480 5484 5485 5486 5488 5489 570 6037 6047 6072 6079 6086 6101 6137 6273 7445 7632
7764 7767 7915 8 8109 8186 819 83 8416 86 874 885 887 9169 9744 9761 9762 9999`.split(/\s+/);
const espn = (id: string) => `https://a.espncdn.com/i/teamlogos/soccer/500/${id}.png`;
const sources: Record<string, string> = catalog.bySource;
const sharp = createRequire(createRequire(import.meta.url).resolve('next/package.json'))('sharp') as (input: Uint8Array) => {
  metadata(): Promise<{ width?: number; height?: number }>;
};
const decodable = async (asset: string) => {
  const image = await fs.readFile(path.join(process.cwd(), 'public', asset));
  const metadata = await sharp(image).metadata();
  return Boolean(metadata.width && metadata.height);
};

describe('local crests for historical ESPN identities', () => {
  it('bakes every ESPN crest still referenced by production matches', async () => {
    expect(PROD_ESPN_CREST_IDS).toHaveLength(114);
    for (const id of PROD_ESPN_CREST_IDS) {
      const local = sources[espn(id)];
      expect(local, id).toMatch(/^\/team-crests\/[a-z0-9-]+\.(webp|png)$/);
      expect(localCrestSource(`Club ${id}`, espn(id)), id).toBe(local);
      await fs.access(path.join(process.cwd(), 'public', local));
    }
  });

  it('keeps reviewed identities ahead of an ESPN URL and never proxies or hotlinks ESPN', () => {
    expect(localCrestSource('Club Brugge', espn('570'))).toBe(sources['https://media.api-sports.io/football/teams/569.png']);
    expect(crestFallbackSource(espn('83'))).toBeUndefined();
    expect(crestFallbackSource('https://a.espncdn.com/i/teamlogos/soccer/100/99999.png')).toBeUndefined();
    expect(crestFallbackSource(null)).toBeUndefined();
    const af = 'https://media.api-sports.io/football/teams/1125.png';
    expect(crestFallbackSource(af)).toBe(af);
    expect(crestFallbackSource('/team-crests/local.webp')).toBe('/team-crests/local.webp');
  });
});

describe('World Cup squad club crests', () => {
  it('maps baked squad crests to decodable local assets only', async () => {
    const assets = new Set(Object.values(squadCrests.bySource as Record<string, string>));
    expect(assets.size).toBeGreaterThan(300);
    for (const asset of assets) expect(asset).toMatch(/^\/team-crests\/[a-z0-9-]+\.(webp|png)$/);
    const results = await Promise.all([...assets].map(decodable));
    expect(results.every(Boolean)).toBe(true);
  }, 30000);

  it('never returns a remote crest for any baked player', () => {
    let local = 0;
    for (const team of Object.keys(squads)) {
      for (const player of getBakedWorldCupRoster(team) ?? []) {
        if (player.clubCrest === null) continue;
        expect(player.clubCrest, `${team}: ${player.club}`).toMatch(/^\/(team-crests|flags)\//);
        local++;
      }
    }
    expect(local).toBeGreaterThan(1000);
  });

  it('resolves by reviewed identity, flags and catalog before the squad map', () => {
    expect(bakedClubCrest('Club Brugge', espn('570'))).toBe(sources['https://media.api-sports.io/football/teams/569.png']);
    expect(bakedClubCrest('Egypt', espn('2620'))).toBe('/flags/eg.svg');
    expect(bakedClubCrest('Crystal Palace', espn('384'))).toBe((squadCrests.bySource as Record<string, string>)[espn('384')]);
    expect(bakedClubCrest('Club sin escudo', espn('18461'))).toBeNull();
    expect(bakedClubCrest(null, espn('384'))).toBeNull();
  });
});
