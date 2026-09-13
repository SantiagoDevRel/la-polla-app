import { describe, expect, it } from 'vitest';
import { footballStatGroups } from '@/lib/football-stat-groups';

describe('football statistics categories', () => {
  it('keeps all metrics reachable, including unknown provider additions', () => {
    const keys = ['possessionPct','expectedGoals','shotsInsideBox','passPct','yellowCards','saves','newProviderMetric'];
    const stats = keys.map(key => ({ key, label: key, home: '0', away: '—' }));
    const groups = footballStatGroups(stats);
    expect(groups[0].id).toBe('general');
    expect(new Set(groups.flatMap(group => group.stats.map(stat => stat.key)))).toEqual(new Set(keys));
    expect(groups.find(group => group.id === 'more')?.stats).toEqual([stats.at(-1)]);
    expect(groups.find(group => group.id === 'defense')?.stats.find(stat => stat.key === 'yellowCards')?.home).toBe('0');
  });

  it('omits categories without data and tolerates entirely absent statistics', () => {
    expect(footballStatGroups([])).toEqual([]);
    expect(footballStatGroups([{ key: 'yellowCards', label: '', home: '1', away: '2' }]).map(group => group.id)).toEqual(['defense']);
  });
});
