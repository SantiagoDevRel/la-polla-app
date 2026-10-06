// Replay migrations and regressions in a fresh, network-isolated container.
// Never connect to or change an existing database/container.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const repo=fileURLToPath(new URL('..',import.meta.url));
const name=`la-polla-check-${randomUUID()}`;
const image='public.ecr.aws/supabase/postgres:17.6.1.159';
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
    const pre=`scripts/local-pg/fixups/${file.split('_')[0]}.pre.sql`;
    if(fs.existsSync(path.join(repo,pre)))sql(read(pre));
    try { sql(read(`supabase/migrations/${file}`)); }
    catch(e) { throw Error(`${file}: ${e.message}`); }
  }
  sql(read('scripts/local-pg/fixups/post.sql'));
  sql("SELECT public.casa_transition_mode((SELECT mode FROM public.casa_operation_control WHERE singleton),'v2');");
  for(const file of ['casa-provisional-timing-check.sql','casa-terminal-balance-check.sql','casa-free-entry-check.sql','casa-rls-check.sql','casa-picks-privacy-check.sql','casa-pending-picks-check.sql']) {
    sql(read(`scripts/${file}`)); console.log(`PASS ${file}`);
  }
  console.log('PASS full migration replay and Casa regressions in isolated PostgreSQL');
} finally {
  if(container && /^[a-f0-9]{64}$/.test(container))docker(['rm','--force',container]);
}
