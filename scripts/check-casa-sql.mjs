// Replay migrations and regressions in a fresh, network-isolated container.
// Never connect to or change an existing database/container.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { checkPickSaveConcurrency } from './local-pg/pick-save-concurrency.mjs';
import { checkPasswordSaveConcurrency } from './local-pg/password-save-concurrency.mjs';
import { adminPlayerFixtures, checkAdminPlayerConcurrency } from './casa-admin-players-check.mjs';
const repo=fileURLToPath(new URL('..',import.meta.url));
const name=`la-polla-check-${randomUUID()}`;
const image='docker.io/supabase/postgres:17.6.1.159@sha256:86a2e078779e5bdccda1f6f6c5063aa9779a322d1fface5fb408d051909b230f';
let container;
const docker=(args,input)=>{
  const r=spawnSync('docker',args,{input,encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:8*1024*1024});
  if(r.status!==0)throw Error(`${args.slice(0,3).join(' ')} failed:\n${r.stderr||r.stdout||r.error}`);
  return r.stdout;
};
const sql=(source)=>docker(['exec','-i',container,'psql','-U','supabase_admin','-d','la_polla_test','-X','-v','ON_ERROR_STOP=1','--single-transaction'],source);
// SQL patch needles must use the same newlines as pg_get_functiondef(), including
// on Windows checkouts with core.autocrlf enabled.
const read=p=>fs.readFileSync(path.join(repo,p),'utf8').replace(/\r\n/g,'\n');
try {
  container=docker(['run','--detach','--rm','--network','none','--name',name,
    '--label','la-polla.test-owner=check-casa-sql','-e','POSTGRES_PASSWORD=local-fixture-only',image]).trim();
  if(!/^[a-f0-9]{64}$/.test(container))throw Error('Unexpected container ID');
  for(let i=0;i<60;i++) {
    const r=spawnSync('docker',['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres'],{encoding:'utf8',windowsHide:true});
    if(r.status===0)break;
    if(i===59)throw Error('Isolated PostgreSQL did not become ready');
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  docker(['exec',container,'createdb','-U','supabase_admin','la_polla_test']);
  sql('CREATE SCHEMA extensions; CREATE EXTENSION pg_net WITH SCHEMA extensions;');
  sql(read('scripts/local-pg/supabase-stubs.sql'));
  sql(read('scripts/local-pg/auth-stub.sql'));
  for(const file of fs.readdirSync(path.join(repo,'supabase/migrations')).filter(p=>p.endsWith('.sql')).sort()) {
    if(file==='169_casa_admin_players.sql')sql(adminPlayerFixtures(read(`supabase/migrations/${file}`)));
    const pre=`scripts/local-pg/fixups/${file.split('_')[0]}.pre.sql`;
    if(fs.existsSync(path.join(repo,pre)))sql(read(pre));
    try { sql(read(`supabase/migrations/${file}`)); }
    catch(e) { throw Error(`${file}: ${e.message}`); }
  }
  sql(read('scripts/local-pg/fixups/post.sql'));
  sql("SELECT public.casa_transition_mode((SELECT mode FROM public.casa_operation_control WHERE singleton),'v2');");
  for(const file of ['casa-provisional-timing-check.sql','casa-terminal-balance-check.sql','casa-free-entry-check.sql','casa-rls-check.sql','casa-picks-privacy-check.sql','casa-pending-picks-check.sql','casa-pick-save-check.sql','user-form-save-check.sql','password-save-check.sql','casa-admin-players-check.sql','casa-admin-player-picks-check.sql','casa-admin-random-defaults-check.sql','casa-admin-money-check.sql','polla-participants-insert-check.sql']) {
    sql(read(`scripts/${file}`)); console.log(`PASS ${file}`);
  }
  // Migration 183 and its reversal: the production no-op path and the fresh
  // database path, in both directions.
  const lit=s=>`'${s.replace(/'/g,"''")}'`;
  const prodStatus="CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'rejected'::character varying])::text[])))";
  const repo010Status="CHECK (((status)::text = ANY ((ARRAY['approved'::character varying, 'rejected'::character varying])::text[])))";
  const statusCheck="(SELECT c.oid FROM pg_constraint c WHERE c.conrelid='public.polla_participants'::regclass AND c.conname='polla_participants_status_check')";
  const assertStatus=(def,marked,label)=>sql(`DO $$ BEGIN ASSERT pg_get_constraintdef(${statusCheck})=${lit(def)}, ${lit(label+' (definition)')}; ASSERT (obj_description(${statusCheck},'pg_constraint') IS NOT NULL)=${marked}, ${lit(label+' (marker)')}; END $$;`);
  const m183=read('supabase/migrations/183_polla_participants_status_check_matches_prod.sql');
  const r183=read('supabase/reversa/183_polla_participants_status_check_matches_prod_REVERSA.sql');
  assertStatus(prodStatus,true,'183 did not install the production check');
  sql('COMMENT ON CONSTRAINT polla_participants_status_check ON public.polla_participants IS NULL;');
  sql(m183); assertStatus(prodStatus,false,'183 changed a database that already matches production');
  sql(r183); assertStatus(prodStatus,false,'REVERSA 183 changed a database that 183 did not change');
  sql("ALTER TABLE public.polla_participants DROP CONSTRAINT polla_participants_status_check; ALTER TABLE public.polla_participants ADD CONSTRAINT polla_participants_status_check CHECK (status IN ('approved','rejected'));");
  assertStatus(repo010Status,false,'Fixture did not restore the 010 check');
  sql(m183); assertStatus(prodStatus,true,'183 did not widen the 010 check');
  sql(r183); assertStatus(repo010Status,false,'REVERSA 183 did not restore the 010 check');
  sql(m183); assertStatus(prodStatus,true,'183 did not re-apply after its reversal');
  console.log('PASS 183 status check round trip (production no-op, fresh database, reversal)');
  // Migration 184 and its reversal. With participants_insert_self restored the
  // insert check must fail (a direct self-join is accepted again); re-applying
  // 184 must make it pass.
  const m184=read('supabase/migrations/184_retire_participants_insert_self.sql');
  const r184=read('supabase/reversa/184_retire_participants_insert_self_REVERSA.sql');
  const insertCheck=read('scripts/polla-participants-insert-check.sql');
  sql(r184);
  sql("SET LOCAL search_path = pg_catalog, public; DO $$ BEGIN ASSERT (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='polla_participants' AND policyname='participants_insert_self' AND with_check='(user_id = auth.uid())')=1, 'REVERSA 184 did not restore participants_insert_self'; END $$;");
  let mutantCaught=false;
  try { sql(insertCheck); } catch(e) { mutantCaught=/participants_insert_self is still active/.test(e.message); }
  if(!mutantCaught)throw Error('The insert check did not fail with participants_insert_self restored');
  sql(m184); sql(insertCheck);
  console.log('PASS 184 round trip (reversal restores the 001 policy, the check fails on it, re-apply passes)');
  await checkPickSaveConcurrency(container);
  await checkPasswordSaveConcurrency(container);
  await checkAdminPlayerConcurrency(container);
  console.log('PASS full migration replay and Casa regressions in isolated PostgreSQL');
} finally {
  if(container && /^[a-f0-9]{64}$/.test(container))docker(['rm','--force',container]);
}
