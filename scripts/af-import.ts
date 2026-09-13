// scripts/af-import.ts — primera importación del calendario de API-Football.
//
//   npx tsx scripts/af-import.ts --all                                        # dry-run (default), usa ./.env.local
//   npx tsx scripts/af-import.ts --all --env <ruta a .env.local>              # dry-run con otro archivo de env
//   npx tsx scripts/af-import.ts --tournament laliga_2025 --env <ruta>        # dry-run de una liga
//   npx tsx scripts/af-import.ts --all --apply --env <ruta>                   # escribe
//
// Por qué existe: el corte a API-Football (2026-09-13) necesita la temporada
// completa de las diez ligas (~3.000 partidos) ANTES de pasar
// `app_config.data_provider_mode` a 'af'. Eso no cabe en los 60 s de Vercel,
// así que corre local, sin plazo, con la service key.
//
// Qué gasta: una llamada a /leagues?current=true + una /fixtures por liga
// (11 con --all). /status no se cobra y se consulta antes y después para
// mostrar el consumo real.
//
// ⚠️ REGLA #1: el script no escribe `matches` por su cuenta. Todo pasa por
// `refreshAfTournament` → `upsert_match_safe` (overload de 17 argumentos).
// En dry-run solo LEE: filas existentes del torneo y el contador de cuota.
// ⚠️ Nunca imprime keys ni el cuerpo de las respuestas; solo conteos y filas mapeadas.

import { parse } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import {
  fetchApiFootballEnvelope, memoizedSeasonResolver, refreshAfTournament, reserveCalendarRequest,
  type AfRefreshResult, type CalendarDeps, type CalendarReservation,
} from '@/lib/api-football/calendar';
import { afLeagueIdForTournament, resolveCurrentSeasons } from '@/lib/api-football/season';
import { SYNCABLE_TOURNAMENT_SLUGS } from '@/lib/tournaments';

const REQUIRED_ENV = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'API_FOOTBALL_KEY'] as const;

function parseArgs(argv: string[]) {
  const out = { tournaments: [] as string[], all: false, apply: false, env: null as string | null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') out.all = true;
    else if (a === '--apply') out.apply = true;
    else if (a === '--tournament') out.tournaments.push(argv[++i] ?? '');
    else if (a === '--env') out.env = argv[++i] ?? null;
    else throw new Error(`Argumento desconocido: ${a}`);
  }
  if (out.all === (out.tournaments.length > 0)) throw new Error('Usa --tournament <slug> o --all (uno de los dos).');
  return out;
}

/** --env explícito o, si existe, el `.env.local` del directorio actual. Nunca se imprime. */
function loadEnv(explicit: string | null) {
  const path = explicit ?? (existsSync('.env.local') ? '.env.local' : null);
  if (path) {
    const parsed = parse(readFileSync(path));
    for (const name of REQUIRED_ENV) if (parsed[name] && !process.env[name]) process.env[name] = parsed[name];
  }
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Faltan variables: ${missing.join(', ')}`);
}

async function providerStatus(): Promise<{ used: number; limit: number; end: string } | null> {
  try {
    const res = await fetch('https://v3.football.api-sports.io/status', {
      headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY! }, signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json();
    const r = body?.response;
    return { used: r.requests.current, limit: r.requests.limit_day, end: r.subscription.end };
  } catch {
    return null;
  }
}

const fmt = (r: AfRefreshResult) => [
  `fetched=${r.fetched}`, `insert=${r.inserted}`, `update=${r.updated}`,
  ...(r.linked ? [`linked=${r.linked}`] : []), `unchanged=${r.unchanged}`, `errors=${r.errors}`,
  `skipped=${JSON.stringify(r.skipped)}`,
  ...(r.aborted ? [`ABORTED=${r.aborted}`] : []), ...(r.truncated ? ['TRUNCATED'] : []),
  ...(r.legacy ? [`legacy_estimate=${JSON.stringify(r.legacy)}`] : []),
].join(' ');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnv(args.env);
  const tournaments = args.all ? SYNCABLE_TOURNAMENT_SLUGS.filter((s) => afLeagueIdForTournament(s)) : args.tournaments;
  const invalid = tournaments.filter((t) => !afLeagueIdForTournament(t));
  if (invalid.length) throw new Error(`Sin liga de API-Football: ${invalid.join(', ')}`);

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  console.log(`[af-import] modo=${args.apply ? 'APPLY (escribe)' : 'dry-run (solo lectura)'} proyecto=${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split('.')[0]}`);

  const maxRequests = tournaments.length + 1;
  let spent = 0;
  const reserveRequest = async (request: CalendarReservation) => {
    if (spent >= maxRequests) return false;
    // Misma reserva atómica que el cron (migración 116): cuenta la solicitud y
    // respeta el plan pagado, los topes y el intervalo por liga.
    if (!(await reserveCalendarRequest(db, request))) return false;
    spent++;
    return true;
  };
  const deps: CalendarDeps = {
    db,
    reserveRequest,
    fetchEnvelope: fetchApiFootballEnvelope,
    resolveSeason: memoizedSeasonResolver(async () => (await resolveCurrentSeasons({
      cache: { read: async () => null, write: async () => {} },
      fetchLeagues: async () => {
        if (!(await reserveRequest({ kind: 'leagues' }))) throw new Error('Cuota no disponible');
        return fetchApiFootballEnvelope('/leagues', { current: 'true' });
      },
    }))?.seasons ?? null),
  };

  const before = await providerStatus();
  if (before) console.log(`[af-import] cuota antes: ${before.used}/${before.limit} (plan hasta ${before.end})`);

  const totals = { fetched: 0, inserted: 0, updated: 0, linked: 0, unchanged: 0, errors: 0 };
  for (const tournament of tournaments) {
    const r = await refreshAfTournament(tournament, { mode: args.apply ? 'apply' : 'dry-run' }, deps);
    console.log(`\n[${tournament}] league=${r.leagueId} season=${r.season} ${fmt(r)}`);
    for (const { plan, row } of r.sample) {
      console.log(`  ${plan.padEnd(9)} ${row.external_id} ${row.scheduled_at} confirmed=${row.scheduled_at_confirmed} ` +
        `${row.status} ${row.home_team} ${row.home_score ?? '-'}-${row.away_score ?? '-'} ${row.away_team} ` +
        `${row.phase}/${row.match_day ?? '-'}`);
    }
    for (const k of Object.keys(totals) as Array<keyof typeof totals>) totals[k] += r[k];
  }

  const after = await providerStatus();
  console.log(`\n[af-import] total ${JSON.stringify(totals)} solicitudes_script=${spent}` +
    (before && after ? ` cuota_proveedor=${before.used}->${after.used}` : ''));
}

main().catch((err: unknown) => {
  console.error('[af-import] error:', err instanceof Error ? err.message : 'desconocido');
  process.exit(1);
});
