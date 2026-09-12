// Integration checks against the fixed LOCAL Docker database; never accepts a URL.
// SQL fixtures roll back; concurrency fixtures have fresh IDs and remain local for inspection.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const container = "supabase_db_la-polla";
function session(statement, marker) {
  const child = spawn("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-tA", "-v", "ON_ERROR_STOP=1"], { windowsHide: true });
  let out = "", err = "", resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  child.stdout.on("data", (chunk) => { out += chunk; if (marker && out.includes(marker)) resolveReady(true); });
  child.stderr.on("data", (chunk) => { err += chunk; });
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => { resolveReady(false); resolve({ code, out, err }); });
  });
  child.stdin.end(statement);
  return { ready, done };
}
async function sql(statement) {
  const result = await session(statement).done;
  if (result.code !== 0) throw new Error(result.err);
  return result.out;
}
const literal = (uuid) => { assert.match(uuid, /^[a-f0-9-]{36}$/); return `'${uuid}'`; };

async function drawFixture() {
  const admin=randomUUID(), player=randomUUID(), pool=randomUUID(), question=randomUUID(), yes=randomUUID(), no=randomUUID();
  await sql(`BEGIN; SELECT casa_v2_context(2); UPDATE casa_operation_control SET object_draws_enabled=true;
    INSERT INTO users(id,whatsapp_number,display_name,is_admin) VALUES(${literal(admin)},'+1444${admin.slice(0,8)}','Admin sorteo local',true),(${literal(player)},'+1333${player.slice(0,8)}','Participante sorteo local',false);
    INSERT INTO casa_pollas(id,slug,name,kind,status,closes_at,created_by,entry_price_cop,payout_method,payout_account,prize_kind,prize_object)
      VALUES(${literal(pool)},'v2-race-draw-${pool}','Sorteo SQL local','manual','abierta',clock_timestamp()+interval '2 hours',${literal(admin)},10000,'otro','fixture','objeto','Camiseta local');
    INSERT INTO casa_questions(id,polla_id,prompt,points,input_kind) VALUES(${literal(question)},${literal(pool)},'Pregunta local',3,'opciones');
    INSERT INTO casa_options(id,question_id,label) VALUES(${literal(yes)},${literal(question)},'Yes'),(${literal(no)},${literal(question)},'No');
    INSERT INTO casa_entries(polla_id,user_id,status,amount_cop) VALUES(${literal(pool)},${literal(admin)},'pagada',10000),(${literal(pool)},${literal(player)},'pagada',10000);
    INSERT INTO casa_picks(entry_id,polla_id,user_id,question_id,option_id) SELECT id,polla_id,user_id,${literal(question)},${literal(yes)} FROM casa_entries WHERE polla_id=${literal(pool)};
    COMMIT;`);
  return {admin,player,pool,question,yes};
}

const suite = await session(await readFile(new URL("./casa-v2-check.sql", import.meta.url), "utf8")).done;
if (suite.code !== 0) throw new Error(suite.err);
process.stdout.write(suite.err);
await sql("SELECT casa_transition_mode((SELECT mode FROM casa_operation_control),'v2');");

async function fixture({ pending = false, uploading = false } = {}) {
  const admin = randomUUID(), user = randomUUID(), pool = randomUUID(), entry = randomUUID();
  const a = literal(admin), u = literal(user), p = literal(pool);
  const result = await sql(`BEGIN; SELECT casa_v2_context(2);
    INSERT INTO users(id,whatsapp_number,display_name,is_admin) VALUES(${a},'+1888${admin.replaceAll("-", "").slice(0, 10)}','Admin de carrera local',true),
      (${u},'+1777${user.replaceAll("-", "").slice(0, 10)}','Participante de carrera local',false);
    INSERT INTO casa_pollas(id,slug,name,kind,status,closes_at,created_by,entry_price_cop,ticket_count,drawn_number,payout_method,payout_account,draw_method)
      VALUES(${p},'v2-race-${pool}','Carrera SQL local','rifa','abierta',clock_timestamp()+interval '2 hours',${a},10001,100,7,'otro','fixture','Sorteo local');
    INSERT INTO casa_entries(id,polla_id,user_id,status,amount_cop,ticket_number) VALUES(${literal(entry)},${p},${u},'pagada',10001,7);
    ${pending || uploading ? `SELECT casa_begin_entry_proof_v2(${p},${u},${literal(randomUUID())},8,repeat('b',64),'image/png',100,2);` : ""}
    COMMIT;`);
  const attempt = result.split("\n").find((line) => line.startsWith("{"));
  const data = attempt ? JSON.parse(attempt) : null;
  if (data) {
    // Metadata fixture only: this checks SQL transitions, not file verification.
    await sql(`BEGIN; SELECT casa_v2_context(2);
      INSERT INTO storage.objects(bucket_id,name) SELECT 'payment-proofs',proof_path FROM casa_entry_proof_attempts WHERE id=${literal(data.attempt_id)};
      ${uploading ? `UPDATE casa_entry_proof_attempts SET expires_at=clock_timestamp()+interval '1 second' WHERE id=${literal(data.attempt_id)};`
        : `SELECT casa_confirm_entry_proof_v2(${literal(data.attempt_id)},${u},2);`}
      COMMIT;`);
  }
  if (!uploading) await sql(`SELECT casa_change_status_v2(${p},'cerrar',2,${a},NULL);`);
  return { admin, user, pool, entry, attempt: data?.attempt_id };
}

const double = await fixture();
const first = session(`BEGIN; SELECT casa_settle_polla_v2(${literal(double.pool)},2,${literal(double.admin)},NULL); SELECT 'SETTLED_LOCK_HELD'; SELECT pg_sleep(1.5); COMMIT;`, "SETTLED_LOCK_HELD");
assert.equal(await first.ready, true);
const duplicate = await session(`SELECT casa_settle_polla_v2(${literal(double.pool)},2,${literal(double.admin)},NULL);`).done;
assert.equal((await first.done).code, 0);
assert.notEqual(duplicate.code, 0); assert.match(duplicate.err, /POLLA_FINAL/);
assert.equal((await sql(`SELECT count(*) FROM casa_payouts WHERE polla_id=${literal(double.pool)};`)).trim(), "1");
console.log("PASS concurrent double settlement: exactly one award");

const approval = await fixture({ pending: true });
const approve = session(`BEGIN; SELECT casa_review_attempt_v2(${literal(approval.attempt)},'pagada',NULL,2,${literal(approval.admin)},NULL); SELECT 'APPROVAL_HELD'; SELECT pg_sleep(1.5); COMMIT;`, "APPROVAL_HELD");
assert.equal(await approve.ready, true);
const settled = await sql(`SELECT casa_settle_polla_v2(${literal(approval.pool)},2,${literal(approval.admin)},NULL);`);
assert.equal((await approve.done).code, 0);
assert.equal(JSON.parse(settled.trim()).prize_cop, 14001);
console.log("PASS approval wins race: settlement includes the approved amount exactly");

const settlementFirst = await fixture({ pending: true });
const blocked = await session(`SELECT casa_settle_polla_v2(${literal(settlementFirst.pool)},2,${literal(settlementFirst.admin)},NULL);`).done;
assert.notEqual(blocked.code, 0); assert.match(blocked.err, /PENDING_PROOFS/);
await sql(`SELECT casa_review_attempt_v2(${literal(settlementFirst.attempt)},'pagada',NULL,2,${literal(settlementFirst.admin)},NULL);`);
assert.equal((await sql(`SELECT count(*) FROM casa_payouts WHERE polla_id=${literal(settlementFirst.pool)};`)).trim(), "0");
console.log("PASS settlement sees pending proof: rejects without a partial payout");

const expiry = await fixture({ uploading: true });
const lock = session(`BEGIN; SELECT id FROM casa_pollas WHERE id=${literal(expiry.pool)} FOR UPDATE; SELECT 'EXPIRY_HELD'; SELECT pg_sleep(2); COMMIT;`, "EXPIRY_HELD");
assert.equal(await lock.ready, true);
const expired = await session(`SELECT casa_confirm_entry_proof_v2(${literal(expiry.attempt)},${literal(expiry.user)},2);`).done;
assert.equal((await lock.done).code, 0); assert.notEqual(expired.code, 0); assert.match(expired.err, /UPLOAD_EXPIRED/);
console.log("PASS expiry is evaluated after waiting for the pool lock");

const barrier = session("BEGIN; SELECT casa_v2_context(2); SELECT 'SHARED_HELD'; SELECT pg_sleep(4); ROLLBACK;", "SHARED_HELD");
assert.equal(await barrier.ready, true);
const started = Date.now();
const transition = await session("SET statement_timeout='15s'; SELECT casa_transition_mode('v2','paused');").done;
assert.notEqual(transition.code, 0); assert.match(transition.err, /lock timeout/);
assert.ok(Date.now() - started < 6000);
assert.equal((await barrier.done).code, 0);
assert.equal((await sql("SELECT mode FROM casa_operation_control;")).trim(), "v2");
console.log("PASS deployment barrier times out without changing mode or terminating sessions");

const drawRace=await drawFixture();
const answered=session(`BEGIN; SELECT casa_resolve_question_v2(${literal(drawRace.pool)},${literal(drawRace.question)},${literal(drawRace.yes)},NULL,2,${literal(drawRace.admin)},NULL); SELECT 'ANSWER_HELD'; SELECT pg_sleep(1); COMMIT;`,'ANSWER_HELD');
assert.equal(await answered.ready,true);
await sql(`SELECT casa_change_status_v2(${literal(drawRace.pool)},'cerrar',2,${literal(drawRace.admin)},NULL);`);
assert.equal((await answered.done).code,0);
console.log('PASS answer versus close: both serialize and preserve the answer');
const opening=session(`BEGIN; SELECT casa_settle_polla_v2(${literal(drawRace.pool)},2,${literal(drawRace.admin)},NULL); SELECT 'DRAW_HELD'; SELECT pg_sleep(1); COMMIT;`,'DRAW_HELD');
assert.equal(await opening.ready,true);
const archive=await session(`SELECT casa_archive_polla_v2(${literal(drawRace.pool)},${literal(drawRace.admin)},2);`).done;
assert.equal((await opening.done).code,0);assert.notEqual(archive.code,0);assert.match(archive.err,/DRAW_PENDING/);
const drawId=(await sql(`SELECT id FROM casa_object_draws WHERE polla_id=${literal(drawRace.pool)};`)).trim();
const beginDraw=(winner)=>`SELECT casa_begin_draw_confirmation_v2(${literal(drawId)},${literal(winner)},${literal(randomUUID())},repeat('e',64),'video/webm',100,${literal(drawRace.admin)},2);`;
const ca=JSON.parse((await sql(beginDraw(drawRace.player))).trim()), cb=JSON.parse((await sql(beginDraw(drawRace.admin))).trim());
await sql(`INSERT INTO storage.objects(bucket_id,name) SELECT 'casa-draw-evidence',evidence_path FROM casa_draw_confirmation_attempts WHERE id IN (${literal(ca.attempt_id)},${literal(cb.attempt_id)});`);
const confirming=session(`BEGIN; SELECT casa_confirm_object_draw_v2(${literal(ca.attempt_id)},${literal(drawRace.admin)},2); SELECT 'CONFIRM_HELD'; SELECT pg_sleep(1); COMMIT;`,'CONFIRM_HELD');
assert.equal(await confirming.ready,true);
const rival=await session(`SELECT casa_confirm_object_draw_v2(${literal(cb.attempt_id)},${literal(drawRace.admin)},2);`).done;
assert.equal((await confirming.done).code,0);assert.notEqual(rival.code,0);assert.match(rival.err,/ALREADY_RESOLVED/);
assert.equal((await sql(`SELECT count(*) FROM casa_payouts WHERE polla_id=${literal(drawRace.pool)};`)).trim(),'1');
const payout=(await sql(`SELECT id FROM casa_payouts WHERE polla_id=${literal(drawRace.pool)};`)).trim();
const delivered=session(`BEGIN; SELECT casa_record_delivery_v2(${literal(payout)},'First delivery',${literal(drawRace.admin)},2); SELECT 'DELIVERY_HELD'; SELECT pg_sleep(1); COMMIT;`,'DELIVERY_HELD');
assert.equal(await delivered.ready,true);
const deliveredAgain=JSON.parse((await sql(`SELECT casa_record_delivery_v2(${literal(payout)},'Second reference',${literal(drawRace.admin)},2);`)).trim());
assert.equal((await delivered.done).code,0);assert.equal(deliveredAgain.delivery_reference,'First delivery');
console.log('PASS pending draw versus archive, competing winners and concurrent delivery preserve one immutable result');

const numberRace=await fixture();
const numbered=session(`BEGIN; SELECT casa_set_drawn_number_v2(${literal(numberRace.pool)},8,2,${literal(numberRace.admin)},NULL); SELECT 'NUMBER_HELD'; SELECT pg_sleep(1); COMMIT;`,'NUMBER_HELD');
assert.equal(await numbered.ready,true);
const unsold=await session(`SELECT casa_settle_polla_v2(${literal(numberRace.pool)},2,${literal(numberRace.admin)},NULL);`).done;
assert.equal((await numbered.done).code,0);assert.notEqual(unsold.code,0);assert.match(unsold.err,/UNSOLD_TICKET/);
console.log('PASS drawn number versus settlement uses the committed number and does not award an unsold ticket');

// An old request has read its pool but has not reached its first protected write.
const stale = await fixture();
// Fixture-only reset: the production transition correctly forbids rolling used v2 back.
await sql("UPDATE casa_operation_control SET mode='legacy';");
const readOnlyOld=session(`BEGIN; SELECT id FROM casa_pollas WHERE id=${literal(stale.pool)}; SELECT 'OLD_READ_DONE'; SELECT pg_sleep(1.5); UPDATE casa_pollas SET drawn_number=9 WHERE id=${literal(stale.pool)}; COMMIT;`, 'OLD_READ_DONE');
assert.equal(await readOnlyOld.ready,true);
await sql("SELECT casa_transition_mode('legacy','paused');");
const staleResult=await readOnlyOld.done;
assert.notEqual(staleResult.code,0); assert.match(staleResult.err,/OPERATIONS_PAUSED/);
assert.equal((await sql(`SELECT drawn_number FROM casa_pollas WHERE id=${literal(stale.pool)}`)).trim(),'7');
await sql("SELECT casa_transition_mode('paused','v2');");
console.log('PASS old request paused between read and first protected write: no effects');

// A legacy writer that has already written keeps its shared barrier until commit.
const written = await fixture();
await sql("UPDATE casa_operation_control SET mode='legacy';");
const oldWriter=session(`BEGIN; UPDATE casa_pollas SET drawn_number=8 WHERE id=${literal(written.pool)}; SELECT 'OLD_WRITE_HELD'; SELECT pg_sleep(1.5); COMMIT;`, 'OLD_WRITE_HELD');
assert.equal(await oldWriter.ready,true);
const drainStarted=Date.now();
await sql("SELECT casa_transition_mode('legacy','paused');");
assert.equal((await oldWriter.done).code,0);
assert.ok(Date.now()-drainStarted>=1000);
assert.equal((await sql(`SELECT drawn_number FROM casa_pollas WHERE id=${literal(written.pool)}`)).trim(),'8');
await sql("SELECT casa_transition_mode('paused','v2');");
console.log('PASS legacy writer after first write drains before pause, then v2 resumes');

// Actual match finalizers, two shared pools, then settlement waiting for scoring.
// Fixtures are created through the authoritative upsert; no historical prediction
// rows exist for these fresh IDs and none are inserted/edited by this test.
const matchAdmin=randomUUID(), sharedPools=[randomUUID(),randomUUID()].sort(), matchKeys=[randomUUID(),randomUUID()];
await sql(`INSERT INTO users(id,whatsapp_number,display_name,is_admin) VALUES(${literal(matchAdmin)},'+1222${matchAdmin.slice(0,8)}','Admin partido local',true);`);
const matchIds=[];
for(const key of matchKeys) {
  const value=await sql(`SELECT upsert_match_safe('local-casa-${key}','local_casa_test',1,'league','Home ${key}','Away ${key}',NULL,NULL,clock_timestamp()+interval '2 hours',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);`);
  const id=value.trim();assert.match(id,/^[a-f0-9-]{36}$/);matchIds.push(id);
}
for(const pool of sharedPools) await sql(`BEGIN; SELECT casa_v2_context(2);
 INSERT INTO casa_pollas(id,slug,name,kind,tournament,scoring_mode,status,closes_at,created_by,entry_price_cop,payout_method,payout_account)
 VALUES(${literal(pool)},'shared-${pool}','Partidos compartidos local','partidos','local_casa_test','1x2','abierta',clock_timestamp()+interval '1 hour',${literal(matchAdmin)},10000,'otro','fixture');
 INSERT INTO casa_polla_matches(polla_id,match_id) VALUES(${literal(pool)},${literal(matchIds[0])}),(${literal(pool)},${literal(matchIds[1])});
 INSERT INTO casa_entries(polla_id,user_id,status,amount_cop) VALUES(${literal(pool)},${literal(matchAdmin)},'pagada',10000);
 INSERT INTO casa_picks(entry_id,polla_id,user_id,match_id,pick_1x2) SELECT e.id,e.polla_id,e.user_id,pm.match_id,'L' FROM casa_entries e JOIN casa_polla_matches pm ON pm.polla_id=e.polla_id WHERE e.polla_id=${literal(pool)};
 SELECT casa_change_status_v2(${literal(pool)},'cerrar',2,${literal(matchAdmin)},NULL); COMMIT;`);
assert.equal((await sql(`SELECT count(*) FROM predictions WHERE match_id IN (${matchIds.map(literal).join(',')})`)).trim(),'0');
const finalA=session(`BEGIN; SET LOCAL statement_timeout='10s'; SELECT finalize_match_result(${literal(matchIds[0])},1,0,'local race'); SELECT 'MATCH_A_HELD'; SELECT pg_sleep(0.75); COMMIT;`,'MATCH_A_HELD');
assert.equal(await finalA.ready,true);
const finalB=session(`BEGIN; SET LOCAL statement_timeout='10s'; SELECT finalize_match_result(${literal(matchIds[1])},2,0,'local race'); SELECT 'MATCH_B_HELD'; SELECT pg_sleep(0.75); COMMIT;`,'MATCH_B_HELD');
const aResult=await finalA.done;assert.equal(aResult.code,0,aResult.err);
assert.equal(await finalB.ready,true);
const settlementStart=Date.now();
const finalSettlement=await session(`SET statement_timeout='10s'; SELECT casa_settle_polla_v2(${literal(sharedPools[0])},2,${literal(matchAdmin)},NULL);`).done;
const bResult=await finalB.done;assert.equal(bResult.code,0,bResult.err);assert.equal(finalSettlement.code,0,finalSettlement.err);
assert.ok(Date.now()-settlementStart<10000);assert.match(finalSettlement.out,/money_awarded/);
assert.equal((await sql(`SELECT sum(points_earned) FROM casa_picks WHERE polla_id=${literal(sharedPools[0])}`)).trim(),'6');
console.log('PASS two real match finalizers share pools in stable order; concurrent settlement completes without deadlock');
