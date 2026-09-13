// lib/matches/af-cached-result.ts — Última observación de API-Football que ya
// está guardada para un partido, sin gastar cuota.
//
// Lo usa /admin/discrepancias: el panel muestra y confirma el resultado del
// proveedor sin pedirle nada nuevo. Solo lee cachés que ya escriben el feed
// diario (api_football_cache), el detalle y la verificación por ids
// (api_football_details) y las fichas de club (vía knownFootballObservation).
//
// Identidad, igual que verify-final: una fila vinculada ('apifootball:<id>')
// usa ese fixture y exige la misma competición y un saque a ±2 h; una fila sin
// vínculo exige nombres, competición y saque (findResultFixture). Dos ids
// distintos en la fila no devuelven nada.
import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { knownFootballObservation } from '@/lib/api-football/feed';
import { isValidFixture, type ApiFootballFixture } from '@/lib/api-football/mappers';
import { findResultFixture, linkedFixtureId, RESULT_LEAGUES, type LinkedResultMatch } from '@/lib/api-football/results';

export interface CachedObservation { fixture: ApiFootballFixture; fetchedAt: string }

const KICKOFF_TOLERANCE_MS = 2 * 60 * 60 * 1000;

export async function cachedApiFootballResult(match: LinkedResultMatch): Promise<CachedObservation | null> {
  const linked = linkedFixtureId(match);
  if (linked === 'ambiguous' || !RESULT_LEAGUES[match.tournament]) return null;
  const admin = createAdminClient();
  const found: CachedObservation[] = [];

  if (typeof linked === 'number') {
    const known = await knownFootballObservation(linked);
    if (known) found.push(known);
    const { data } = await admin.from('api_football_details')
      .select('fixture,fetched_at').eq('fixture_id', linked).maybeSingle();
    if (data?.fetched_at && isValidFixture(data.fixture)) {
      found.push({ fixture: data.fixture, fetchedAt: data.fetched_at });
    }
    return newest(found.filter(({ fixture }) => fixture.fixture.id === linked
      && fixture.league?.id === RESULT_LEAGUES[match.tournament]
      && Math.abs(Date.parse(fixture.fixture.date) - Date.parse(match.scheduled_at)) <= KICKOFF_TOLERANCE_MS));
  }

  const date = new Date(match.scheduled_at).toISOString().slice(0, 10);
  const { data } = await admin.from('api_football_cache')
    .select('fixtures,fetched_at').eq('fixture_date', date).maybeSingle();
  if (data?.fetched_at && Array.isArray(data.fixtures)) {
    const fixture = findResultFixture(match, data.fixtures.filter(isValidFixture));
    if (fixture) found.push({ fixture, fetchedAt: data.fetched_at });
  }
  return newest(found);
}

function newest(list: CachedObservation[]): CachedObservation | null {
  return [...list].sort((a, b) => Date.parse(b.fetchedAt) - Date.parse(a.fetchedAt))[0] ?? null;
}
