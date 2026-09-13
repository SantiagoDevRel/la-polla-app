// Fixed LOCAL Docker target. Fresh concurrency fixtures remain inspectable;
// the sequential SQL suite rolls back. Never accepts a production URL.
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
  assert.equal(result.code, 0, result.err);
  return result.out;
}
const q = (uuid) => { assert.match(uuid, /^[a-f0-9-]{36}$/); return `'${uuid}'`; };
const suite = await session(await readFile(new URL("./casa-payment-corrections-check.sql", import.meta.url), "utf8")).done;
assert.equal(suite.code, 0, suite.err);
process.stdout.write(suite.err);

async function fixture() {
  const admin = randomUUID(), user = randomUUID(), pool = randomUUID(), entry = randomUUID(), attempt = randomUUID();
  await sql(`BEGIN; SELECT casa_v2_context(2);
    INSERT INTO users(id,whatsapp_number,display_name,is_admin) VALUES
      (${q(admin)},'+1888${admin.replaceAll("-", "").slice(0, 10)}','Admin corrección carrera',true),
      (${q(user)},'+1777${user.replaceAll("-", "").slice(0, 10)}','Participante corrección carrera',false);
    INSERT INTO casa_pollas(id,slug,name,kind,status,closes_at,created_by,entry_price_cop,ticket_count,drawn_number,payout_method,payout_account,draw_method)
      VALUES(${q(pool)},'correction-race-${pool}','Carrera corrección local','rifa','cerrada',clock_timestamp()+interval '2 hours',${q(admin)},10000,100,7,'otro','fixture','Sorteo local');
    INSERT INTO casa_entries(id,polla_id,user_id,status,amount_cop,ticket_number) VALUES(${q(entry)},${q(pool)},${q(user)},'pendiente',10000,7);
    INSERT INTO casa_entry_proof_attempts(id,entry_id,user_id,request_id,state,proof_path,confirmed_at)
      VALUES(${q(attempt)},${q(entry)},${q(user)},${q(randomUUID())},'confirmed','local-correction/${attempt}.png',clock_timestamp());
    UPDATE casa_entries SET current_proof_attempt_id=${q(attempt)},proof_path='local-correction/${attempt}.png',proof_uploaded_at=clock_timestamp() WHERE id=${q(entry)};
    SELECT casa_review_attempt_v3(${q(attempt)},0,'pagada','Revisado',2,${q(admin)}); COMMIT;`);
  return { admin, user, pool, entry, attempt };
}
const undo = (f) => `SELECT casa_unpay_attempt_v2(${q(f.attempt)},0,'Recibo equivocado',2,${q(f.admin)});`;
const settle = (f) => `SELECT casa_settle_polla_v2(${q(f.pool)},2,${q(f.admin)},NULL);`;

const first = await fixture();
const correction = session(`BEGIN; ${undo(first)} SELECT 'CORRECTION_HELD'; SELECT pg_sleep(1); COMMIT;`, "CORRECTION_HELD");
assert.equal(await correction.ready, true);
const blockedSettlement = await session(settle(first)).done;
assert.equal((await correction.done).code, 0);
assert.notEqual(blockedSettlement.code, 0); assert.match(blockedSettlement.err, /PENDING_PROOFS/);
assert.equal((await sql(`SELECT count(*) FROM casa_payouts WHERE polla_id=${q(first.pool)};`)).trim(), "0");
console.log("PASS correction wins settlement race: pending proof blocks award, zero payouts");

const second = await fixture();
const settlement = session(`BEGIN; ${settle(second)} SELECT 'SETTLEMENT_HELD'; SELECT pg_sleep(1); COMMIT;`, "SETTLEMENT_HELD");
assert.equal(await settlement.ready, true);
const blockedCorrection = await session(undo(second)).done;
assert.equal((await settlement.done).code, 0);
assert.notEqual(blockedCorrection.code, 0); assert.match(blockedCorrection.err, /POLLA_FINAL/);
assert.equal((await sql(`SELECT status FROM casa_entries WHERE id=${q(second.entry)};`)).trim(), "pagada");
assert.equal((await sql(`SELECT count(*) FROM casa_payouts WHERE polla_id=${q(second.pool)};`)).trim(), "1");
console.log("PASS settlement wins correction race: paid entry and sole winner stay frozen");

const third = await fixture();
const duplicateFirst = session(`BEGIN; ${undo(third)} SELECT 'DUPLICATE_HELD'; SELECT pg_sleep(1); COMMIT;`, "DUPLICATE_HELD");
assert.equal(await duplicateFirst.ready, true);
const duplicate = await sql(undo(third));
assert.equal((await duplicateFirst.done).code, 0);
assert.equal(JSON.parse(duplicate.trim()).changed, false);
assert.equal((await sql(`SELECT count(*) FROM casa_payment_corrections WHERE entry_id=${q(third.entry)};`)).trim(), "1");
console.log("PASS concurrent duplicate correction: exactly one retained approval and audit record");

const fourth = await fixture();
await sql(`BEGIN; SELECT casa_v2_context(2); INSERT INTO casa_object_draws(polla_id,prize_object,top_points) VALUES(${q(fourth.pool)},'Premio de prueba',3); COMMIT;`);
const drawCorrection = await session(undo(fourth)).done;
assert.notEqual(drawCorrection.code, 0); assert.match(drawCorrection.err, /DRAW_PENDING/);
assert.equal((await sql(`SELECT count(*) FROM casa_payment_corrections WHERE entry_id=${q(fourth.entry)};`)).trim(), "0");
console.log("PASS frozen draw participants reject correction without audit or payment mutation");
