// scripts/rifas-concurrency-check.mjs
//
// Reservas simultáneas de rifas (migración 157) con sesiones REALES de
// PostgreSQL, no simuladas dentro de una transacción. LOCAL ONLY.
//
//   node scripts/rifas-concurrency-check.mjs
//     → psql contra 127.0.0.1:54322/la_polla_local (scripts/local-pg/apply-migrations.sh)
//   RIFAS_PG_CONTAINER=supabase_db_la-polla node scripts/rifas-concurrency-check.mjs
//     → docker exec contra el Supabase local de Docker (base postgres)
//
// Casos:
//   1 · intercalado determinista: A reserva el 07 y retiene la transacción;
//       B pide el 07, queda bloqueada por el FOR UPDATE de la rifa y, cuando A
//       confirma, recibe NUMBER_TAKEN con mensaje claro. Nunca dos dueños.
//   2 · ráfaga: 12 compradores piden el 42 a la vez → exactamente 1 lo obtiene.
//   3 · conjuntos solapados: [1,2,3] contra [3,4] a la vez → el perdedor no
//       queda con números a medias (todo o nada).
//   4 · venta por fuera contra reserva en la app del mismo número → uno gana.
//   5 · red de fondo: un INSERT directo que se salta el bloqueo choca con el
//       índice único parcial.
// Crea su propia gente y su rifa con ids nuevos y los borra al final.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const container = process.env.RIFAS_PG_CONTAINER;
const port = process.env.PGPORT_LOCAL ?? "54322";
const database = process.env.PGDB_LOCAL ?? "la_polla_local";

function psqlArgs() {
  const common = ["-X", "-tA", "-v", "ON_ERROR_STOP=1"];
  return container
    ? ["docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", ...common]]
    : ["psql", ["-h", "127.0.0.1", "-p", port, "-U", "postgres", "-d", database, ...common]];
}

/** One real database session. Resolves `ready` when `marker` shows up on stdout. */
function session(sql, marker) {
  const [cmd, args] = psqlArgs();
  const child = spawn(cmd, args);
  let out = "", err = "", resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  const started = Date.now();
  child.stdout.on("data", (chunk) => { out += chunk; if (marker && out.includes(marker)) resolveReady(true); });
  child.stderr.on("data", (chunk) => { err += chunk; });
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => { resolveReady(false); resolve({ code, out, err, ms: Date.now() - started }); });
  });
  child.stdin.end(sql);
  return { ready, done };
}

async function sql(statement) {
  const result = await session(statement).done;
  if (result.code !== 0) throw new Error(result.err);
  return result.out.trim();
}

const lit = (uuid) => { assert.match(uuid, /^[a-f0-9-]{36}$/); return `'${uuid}'`; };
const phone = () => `5731${Math.floor(10000000 + Math.random() * 89999999)}`;

const admin = randomUUID(), creator = randomUUID();
const buyers = Array.from({ length: 12 }, () => randomUUID());
const people = [admin, creator, ...buyers];
let rifa = null;

async function setup() {
  const rows = people.map((id) => `(${lit(id)}, '${phone()}', now() - interval '10 days')`).join(",");
  await sql(`BEGIN;
    INSERT INTO auth.users (id, phone, created_at) VALUES ${rows};
    UPDATE public.users SET display_name = 'Concurrencia ' || left(id::text, 4),
      default_payout_method = 'nequi', default_payout_account = '3000000000'
     WHERE id IN (${people.map(lit).join(",")});
    UPDATE public.users SET is_admin = true WHERE id = ${lit(admin)};
    SELECT public.rifa_grant_creator_v1(${lit(admin)}, ${lit(creator)});
    COMMIT;`);
  const out = await sql(`SELECT public.rifa_create_v1(${lit(creator)}, 'Rifa de concurrencia', 'dinero', 100000, NULL,
    100, 5000, 'Astro Sol', 'ultimas_dos', now() + interval '1 day', 'publica', 'nequi', '3001234567', 'Creador Local')->>'id';`);
  rifa = out.split("\n").pop();
  assert.match(rifa, /^[a-f0-9-]{36}$/);
}

async function cleanup() {
  if (rifa) await sql(`DELETE FROM public.rifa_events WHERE rifa_id = ${lit(rifa)}; DELETE FROM public.rifas WHERE id = ${lit(rifa)};`).catch(() => {});
  await sql(`DELETE FROM public.rifa_events WHERE actor_id IN (${people.map(lit).join(",")}) OR subject_user_id IN (${people.map(lit).join(",")});
    DELETE FROM public.rifa_creators WHERE user_id IN (${people.map(lit).join(",")});
    DELETE FROM public.users WHERE id IN (${people.map(lit).join(",")});
    DELETE FROM auth.users WHERE id IN (${people.map(lit).join(",")});`).catch((e) => console.error("cleanup:", e.message));
}

const reserve = (buyer, numbers) => `SELECT public.rifa_reserve_v1(${lit(rifa)}, ${lit(buyer)}, ARRAY[${numbers.join(",")}]::int[]);`;
const liveOwners = async (n) => (await sql(`SELECT coalesce(string_agg(coalesce(buyer_id::text, 'fuera'), ','), '')
  FROM public.rifa_tickets WHERE rifa_id = ${lit(rifa)} AND number = ${n} AND state <> 'liberado';`)).split(",").filter(Boolean);

async function caseInterleaved() {
  const a = session(`BEGIN; ${reserve(buyers[0], [7])} SELECT 'A_HOLDS_LOCK'; SELECT pg_sleep(2); COMMIT;`, "A_HOLDS_LOCK");
  assert.equal(await a.ready, true, "A no alcanzó a reservar");
  const b = session(reserve(buyers[1], [7]));
  const [ra, rb] = await Promise.all([a.done, b.done]);
  assert.equal(ra.code, 0, `A debía ganar: ${ra.err}`);
  assert.notEqual(rb.code, 0, "B no debía obtener el 07");
  assert.match(rb.err, /ERROR:\s+NUMBER_TAKEN/);
  assert.match(rb.err, /El 07 ya lo tomó otra persona\. Elige otro número\./);
  assert.ok(rb.ms >= 1200, `B debía esperar el bloqueo de A (esperó ${rb.ms} ms)`);
  assert.deepEqual(await liveOwners(7), [buyers[0]]);
  console.log(`  1 · intercalado: B esperó ${rb.ms} ms al bloqueo y recibió NUMBER_TAKEN con mensaje claro`);
}

async function caseBurst() {
  const results = await Promise.all(buyers.map((buyer) => session(reserve(buyer, [42])).done));
  const winners = results.filter((r) => r.code === 0).length;
  const taken = results.filter((r) => /NUMBER_TAKEN/.test(r.err)).length;
  const other = results.filter((r) => r.code !== 0 && !/NUMBER_TAKEN/.test(r.err));
  assert.equal(other.length, 0, `errores inesperados: ${other.map((r) => r.err).join(" | ")}`);
  assert.equal(winners, 1, `ganadores del 42: ${winners}`);
  assert.equal(taken, buyers.length - 1);
  assert.equal((await liveOwners(42)).length, 1);
  console.log(`  2 · ráfaga: ${buyers.length} sesiones pidieron el 42 a la vez → 1 lo obtuvo, ${taken} NUMBER_TAKEN`);
}

async function caseOverlap() {
  const [x, y] = await Promise.all([session(reserve(buyers[2], [1, 2, 3])).done, session(reserve(buyers[3], [3, 4])).done]);
  assert.equal([x, y].filter((r) => r.code === 0).length, 1, "exactamente un conjunto debía entrar");
  const loserIsY = x.code === 0;
  const loser = loserIsY ? y : x;
  assert.match(loser.err, /NUMBER_TAKEN/);
  assert.match(loser.err, /El 03 ya lo tomó otra persona/);
  if (loserIsY) {
    assert.deepEqual(await liveOwners(4), [], "el 4 quedó reservado a medias");
  } else {
    assert.deepEqual(await liveOwners(1), [], "el 1 quedó reservado a medias");
    assert.deepEqual(await liveOwners(2), [], "el 2 quedó reservado a medias");
  }
  assert.equal((await liveOwners(3)).length, 1);
  console.log(`  3 · solapados: ganó ${loserIsY ? "[1,2,3]" : "[3,4]"}; el otro no quedó con números a medias`);
}

async function caseOfflineVsApp() {
  const [app, offline] = await Promise.all([
    session(reserve(buyers[4], [55])).done,
    session(`SELECT public.rifa_offline_sale_v1(${lit(creator)}, ${lit(rifa)}, 55, 'Venta local', '+573000000055', true);`).done,
  ]);
  assert.equal([app, offline].filter((r) => r.code === 0).length, 1);
  assert.match((app.code === 0 ? offline : app).err, /NUMBER_TAKEN/);
  assert.equal((await liveOwners(55)).length, 1);
  console.log(`  4 · venta por fuera contra app en el 55: ganó ${app.code === 0 ? "la app" : "la venta por fuera"}, el otro NUMBER_TAKEN`);
}

async function caseUniqueBackstop() {
  const r = await session(`INSERT INTO public.rifa_tickets (rifa_id, number, state, origin, buyer_id, created_by, expires_at)
    VALUES (${lit(rifa)}, 42, 'reservado', 'app', ${lit(buyers[5])}, ${lit(buyers[5])}, now() + interval '30 minutes');`).done;
  assert.notEqual(r.code, 0);
  assert.match(r.err, /rifa_tickets_live_number/);
  console.log("  5 · un INSERT que se salta el bloqueo choca con el índice único rifa_tickets_live_number");
}

try {
  await setup();
  console.log(`rifas-concurrency-check (${container ? `docker ${container}` : `127.0.0.1:${port}/${database}`})`);
  await caseInterleaved();
  await caseBurst();
  await caseOverlap();
  await caseOfflineVsApp();
  await caseUniqueBackstop();
  console.log("rifas-concurrency-check: OK");
} finally {
  await cleanup();
}
