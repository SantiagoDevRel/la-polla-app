// Helpers used only by the fresh, network-isolated CI migration runner.
// No production connection, schema snapshot or credentials are accepted.
import {execFileSync, spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import assert from "node:assert/strict";

export function adminPlayerFixtures(migration) {
  const roster=[...migration.matchAll(/\('([a-f0-9-]{36})'::uuid,(\d+)\)/g)];
  assert.equal(roster.length,20);
  return `INSERT INTO public.users(id,display_name) VALUES ${roster.map((r,i)=>`('${r[1]}','Roster ${i+1}')`).join(",")};`;
}

export async function checkAdminPlayerConcurrency(container) {
  assert.match(container,/^[a-f0-9]{64}$/);
  const sql=statement=>execFileSync("docker",["exec","-i",container,"psql","-U","supabase_admin","-d","la_polla_test","-X","-q","-tA","-v","ON_ERROR_STOP=1"],{input:`BEGIN; DO $$ BEGIN PERFORM public.casa_v2_context(2); END $$; ${statement} COMMIT;`,encoding:"utf8",timeout:120000,maxBuffer:8*1024*1024});
  // Independent sessions: the pool lock serializes duplicate add requests,
  // and revisions prevent a stale administrator from reversing a newer action.
  const admin=randomUUID(),seed=randomUUID(),player=sql("SELECT user_id FROM public.casa_admin_players WHERE position=1;").trim();
  sql(`INSERT INTO public.users(id,display_name,is_admin) VALUES('${admin}','Race admin',true);`);
  const match=sql(`SELECT public.upsert_match_safe('random-race-${seed}','premier_2025',1,'league','Race home ${seed}','Race away ${seed}',NULL,NULL,clock_timestamp()+interval '3 hours',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);`).trim();
  const pool=sql(`SELECT public.casa_create_polla_v2(jsonb_build_object('name','Race fixture','kind','partidos','tournament','premier_2025','scoringMode','marcador','prizeKind','pozo','entryPriceCop',10000,'houseCutPct',30,'closesAt',clock_timestamp()+interval '2 hours','closeMode','manual','publicationMode','ahora','payoutMethod','otro','payoutAccount','fixture','matchIds',jsonb_build_array('${match}'::uuid)),'race-${seed}','${admin}',2)->>'id';`).trim();
  function session(statement){
    const child=spawn("docker",["exec","-i",container,"psql","-U","supabase_admin","-d","la_polla_test","-X","-q","-tA","-v","ON_ERROR_STOP=1"],{stdio:["pipe","pipe","pipe"]});
    let output="",error="",unlock;
    const ready=new Promise(resolve=>{unlock=resolve;});
    child.stdout.on("data",chunk=>{output+=chunk;if(output.includes("LOCK_HELD"))unlock(true);});
    child.stderr.on("data",chunk=>{error+=chunk;});
    const done=new Promise((resolve,reject)=>{child.on("error",reject);child.on("close",code=>{unlock(false);resolve({code,output,error});});});
    child.stdin.end(statement);return {ready,done};
  }
  const first=session(`BEGIN; SELECT public.casa_set_admin_player('${pool}','${player}',true,0,'${admin}',2); SELECT 'LOCK_HELD'; SELECT pg_sleep(1); COMMIT;`);
  assert(await first.ready);
  const second=session(`SELECT public.casa_set_admin_player('${pool}','${player}',true,0,'${admin}',2);`);
  assert.equal((await first.done).code,0);
  assert.equal((await second.done).code,0);
  assert.equal(sql(`SELECT count(*) FROM public.casa_entries WHERE polla_id='${pool}';`).trim(),"1");
  assert.equal(sql(`SELECT count(*) FROM public.casa_admin_player_events ev JOIN public.casa_entries e ON e.id=ev.entry_id WHERE e.polla_id='${pool}';`).trim(),"1");
  assert.equal(sql(`SELECT count(*) FROM public.casa_picks WHERE polla_id='${pool}' AND match_id='${match}' AND home_score BETWEEN 0 AND 4 AND away_score BETWEEN 0 AND 4;`).trim(),"1");
  assert.equal(sql(`SELECT count(*) FROM public.casa_admin_player_pick_events ev JOIN public.casa_entries e ON e.id=ev.entry_id WHERE e.polla_id='${pool}';`).trim(),"1");
  assert.equal(sql(`SELECT revision FROM public.casa_pick_save_state WHERE polla_id='${pool}';`).trim(),"1");
  console.log("PASS concurrent duplicate adds: one paid entry, one saved random prediction and one audited save");
  const removal=session(`BEGIN; SELECT public.casa_set_admin_player('${pool}','${player}',false,1,'${admin}',2); SELECT 'LOCK_HELD'; SELECT pg_sleep(1); COMMIT;`);
  assert(await removal.ready);
  const stale=session(`SELECT public.casa_set_admin_player('${pool}','${player}',true,1,'${admin}',2);`);
  assert.equal((await removal.done).code,0);
  const staleResult=await stale.done;
  assert.notEqual(staleResult.code,0);
  assert.match(staleResult.error,/PLAYER_SELECTION_CHANGED/);
  assert.equal(sql(`SELECT status FROM public.casa_entries WHERE polla_id='${pool}';`).trim(),"anulada");
  assert.equal(sql(`SELECT count(*) FROM public.casa_picks WHERE polla_id='${pool}';`).trim(),"1");
  console.log("PASS concurrent stale reversal rejected: latest admin action retained");
}
