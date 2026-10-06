import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

/** Requires the fresh disposable container created by check-casa-sql only. */
export async function checkPickSaveConcurrency(container) {
  assert.match(container, /^[a-f0-9]{64}$/);
  const args = ['exec', '-i', container, 'psql', '-U', 'supabase_admin', '-d', 'la_polla_test', '-X', '-At', '-q', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'];
  const run = source => spawnSync('docker', args, { input: source, encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  const sql = source => { const r = run(source); assert.equal(r.status, 0, r.stderr || r.error?.message); return r.stdout.trim(); };
  const u = randomUUID(), other = randomUUID();
  const fixture = JSON.parse(sql(`CREATE FUNCTION pg_temp.fixture() RETURNS jsonb LANGUAGE plpgsql AS $$
    DECLARE p uuid; m uuid; e uuid; e2 uuid; BEGIN
    PERFORM public.casa_v2_context(2);
    INSERT INTO public.users(id,whatsapp_number,display_name,is_admin) VALUES
      ('${u}','+1997'||substr(replace('${u}','-',''),1,10),'Concurrency fixture',true),
      ('${other}','+1996'||substr(replace('${other}','-',''),1,10),'Other concurrency fixture',false);
    m:=public.upsert_match_safe('concurrent-${u}','premier_2025',1,'league','Concurrent home ${u}','Concurrent away ${u}',
      NULL,NULL,clock_timestamp()+interval '2 hours',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);
    p:=(public.casa_create_polla_v2(jsonb_build_object('name','Concurrency fixture','kind','partidos','tournament','premier_2025',
      'scoringMode','marcador','prizeKind','pozo','entryPriceCop',10000,'houseCutPct',30,'closesAt',clock_timestamp()+interval '1 hour',
      'closeMode','auto','publicationMode','ahora','payoutMethod','otro','payoutAccount','synthetic','matchIds',jsonb_build_array(m)),
      'concurrent-${u}','${u}',2)->>'id')::uuid;
    INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop) VALUES(p,'${u}','pagada',10000) RETURNING id INTO e;
    INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop) VALUES(p,'${other}','pagada',10000) RETURNING id INTO e2;
    RETURN jsonb_build_object('p',p,'m',m,'e',e,'e2',e2); END $$; SELECT pg_temp.fixture();`));
  const put = (entry, user, id, revision, home) => `SELECT public.casa_save_picks_v1('${fixture.p}','${user}','${entry}','${id}',${revision},'[{
    "matchId":"${fixture.m}","homeScore":${home},"awayScore":1}]');`;
  function hold(source, seconds = 4) {
    const app = `pick-save-fixture-${randomUUID()}`;
    const child = spawn('docker', ['exec', '-i', '-e', `PGAPPNAME=${app}`, ...args.slice(2)], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', data => out += data);
    child.stderr.on('data', data => err += data);
    const done = new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', code => code === 0 ? resolve(out) : reject(Error(err)));
    });
    child.stdin.end(`BEGIN; ${source} SELECT pg_sleep(${seconds}); COMMIT;`);
    const active = () => sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name='${app}' AND wait_event='PgSleep';`) === '1';
    return { done, active };
  }
  async function waitActive(holder) {
    for (let i = 0; i < 20; i++) { if (holder.active()) return; await new Promise(resolve => setTimeout(resolve, 60)); }
    assert.fail('The transaction did not demonstrably hold its locks');
  }
  const firstId = randomUUID();
  const first = hold(put(fixture.e, u, firstId, 0, 2));
  await waitActive(first);
  const second = JSON.parse(sql(put(fixture.e2, other, randomUUID(), 0, 1)));
  assert.equal(second.guardados, 1);
  assert.equal(first.active(), true, 'Another player must finish before the first transaction releases its pool lock');
  await first.done;
  assert.equal(sql(`SELECT count(*) FROM public.casa_picks WHERE polla_id='${fixture.p}';`), '2');
  console.log('PASS simultaneous players: both entries save while the first transaction is still active');

  const blocker = hold(put(fixture.e, u, randomUUID(), 1, 3));
  await waitActive(blocker);
  const staleId = randomUUID();
  const start = Date.now();
  const blocked = run(put(fixture.e, u, staleId, 1, 2));
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /55P03/);
  assert.ok(Date.now() - start < 4_000, 'Entry contention must stop at the lock deadline');
  await blocker.done;
  const stale = JSON.parse(sql(put(fixture.e, u, staleId, 1, 2)));
  assert.equal(stale.conflict, true);
  assert.equal(sql(`SELECT home_score FROM public.casa_picks WHERE entry_id='${fixture.e}';`), '3');
  console.log('PASS same-entry contention: bounded lock wait, then stale request rejected without overwriting');

  const settlement = hold(`SELECT id FROM public.casa_pollas WHERE id='${fixture.p}' FOR UPDATE;`, 2);
  await waitActive(settlement);
  const during = run(put(fixture.e2, other, randomUUID(), 1, 4));
  assert.notEqual(during.status, 0);
  assert.match(during.stderr, /55P03/);
  await settlement.done;
  assert.equal(sql(`SELECT home_score FROM public.casa_picks WHERE entry_id='${fixture.e2}';`), '1');
  assert.equal(sql('SELECT count(*) FROM public.predictions;'), '0');
  console.log('PASS administrative exclusive lock still excludes pick mutations; historical predictions remain empty');
}
