import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

/** Only the fresh network-isolated container owned by check-casa-sql. */
export async function checkPasswordSaveConcurrency(container) {
  assert.match(container, /^[a-f0-9]{64}$/);
  const args=['exec','-i',container,'psql','-U','supabase_admin','-d','la_polla_test','-X','-At','-q','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'];
  const run=source=>spawnSync('docker',args,{input:source,encoding:'utf8',windowsHide:true,timeout:15000});
  const sql=source=>{ const r=run(source); assert.equal(r.status,0,r.stderr||r.error?.message); return r.stdout.trim(); };
  const u=randomUUID(), other=randomUUID(), firstId=randomUUID();
  sql(`INSERT INTO auth.users(id,phone,phone_confirmed_at) VALUES('${u}','573002345678',clock_timestamp()),('${other}','573002345679',clock_timestamp());`);
  const put=(owner,phone,id,revision,hash)=>`SELECT public.phone_password_save_v1('${owner}','${phone}','${id}',${revision},repeat('a',32),repeat('${hash}',128));`;
  const app=`password-save-fixture-${randomUUID()}`;
  const child=spawn('docker',['exec','-i','-e',`PGAPPNAME=${app}`,...args.slice(2)],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let err=''; child.stderr.on('data',data=>err+=data); child.stdout.resume();
  const done=new Promise((resolve,reject)=>{child.on('error',reject); child.on('close',code=>code===0?resolve():reject(Error(err)));});
  // Keep psql stdin open: the transaction holds until assertions finish,
  // independently of browser workload or the host's Docker startup speed.
  child.stdin.write(`BEGIN; ${put(u,'573002345678',firstId,0,'a')}\n`);
  const active=()=>sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name='${app}' AND state='idle in transaction';`)==='1';
  try {
    const activationDeadline=Date.now()+15000; let held=false;
    while(Date.now()<activationDeadline){if(active()){held=true;break;} await new Promise(resolve=>setTimeout(resolve,60));}
    assert.ok(held,'First save must demonstrably hold its transaction lock');
    const independent=JSON.parse(sql(put(other,'573002345679',randomUUID(),0,'b')));
    assert.equal(independent.revision,1); assert.equal(active(),true,'Independent owner must save while first transaction remains active');
    const started=Date.now(), blocked=run(put(u,'573002345678',randomUUID(),0,'b'));
    assert.notEqual(blocked.status,0); assert.match(blocked.stderr,/55P03/); assert.ok(Date.now()-started<4000);
    assert.equal(active(),true,'First transaction must remain held after the competing writer times out');
  } finally {
    child.stdin.end('COMMIT;\n');
    let releaseTimer;
    try { await Promise.race([done,new Promise((_,reject)=>{ releaseTimer=setTimeout(()=>{child.kill();reject(Error('Owned fixture transaction release deadline exceeded'));},15000); })]); }
    finally { clearTimeout(releaseTimer); }
  }
  assert.equal(JSON.parse(sql(put(u,'573002345678',firstId,0,'a'))).revision,1);
  assert.equal(JSON.parse(sql(put(u,'573002345678',randomUUID(),0,'b'))).conflict,true);
  assert.equal(sql(`SELECT count(*)||':'||min(credential_revision)||':'||bool_and(password_hash=repeat('a',128)) FROM public.phone_password_credentials WHERE user_id='${u}';`),'1:1:true');
  console.log('PASS PIN concurrent creation: independent owner progresses, same owner has bounded contention, accepted replay is idempotent and stale PIN cannot overwrite');
}
