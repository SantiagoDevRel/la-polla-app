// Real browser/Storage/SQL regressions against an explicitly guarded local server.
// Set CASA_ORIGIN and CASA_LOCAL_SERVER_STATE to the local startup state JSON.
// Creates synthetic local fixtures only. No production credentials or notifications.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { createLocalBrowserActor, localDb, localSql, sqlQuote as q } from "./casa-local-browser-helpers.mjs";

const origin = process.env.CASA_ORIGIN;
assert.match(origin ?? "", /^http:\/\/localhost:\d+$/, "Explicit local CASA_ORIGIN required");
assert.ok(process.env.CASA_LOCAL_SERVER_STATE, "Guarded local server startup state required");
const boot = JSON.parse(await readFile(process.env.CASA_LOCAL_SERVER_STATE, "utf8"));
assert.equal(boot.port, Number(new URL(origin).port));
assert.equal(boot.messagingKeysBlank, true);
assert.equal(boot.externalFetchBlocked, true);
assert.equal(boot.localSupabase, "http://127.0.0.1:54321");
assert.equal(path.resolve(boot.cwd), path.resolve(fileURLToPath(new URL("..", import.meta.url))));
const output = process.env.CASA_PROOF_BROWSER_OUTPUT
  ?? path.join(os.homedir(), "Downloads", "agent-work", `la-polla-proof-browser-${Date.now()}`);
await mkdir(output, { recursive: true });
const report = { origin, startedAt: new Date().toISOString(), cases: [], browserErrors: [] };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const browser = await chromium.launch({ channel: "chrome", headless: true });
process.on("SIGINT", async () => { await browser.close(); process.exit(130); });

async function actor(name, admin = false) {
  const a = await createLocalBrowserActor(browser, { name, admin, origin });
  a.page.setDefaultTimeout(30_000);
  a.page.on("pageerror", error => report.browserErrors.push({ message: error.message, stack: error.stack }));
  await a.context.route("**/*", route => {
    const host = new URL(route.request().url()).hostname;
    return ["localhost", "127.0.0.1"].includes(host) ? route.continue() : route.abort("blockedbyclient");
  });
  return a;
}

function pool(adminId, label) {
  const id = randomUUID(), slug = `local-proof-regression-${id}`;
  localSql(`BEGIN; SELECT casa_v2_context(2);
    INSERT INTO casa_pollas(id,slug,name,kind,status,closes_at,created_by,entry_price_cop,payout_method,payout_account,max_entries_per_user)
    VALUES(${q(id)},${q(slug)},${q(label)},'manual','abierta',clock_timestamp()+interval '3 hours',${q(adminId)},10000,'otro','LOCAL TEST ACCOUNT',3); COMMIT;`);
  return { id, slug, url: `${origin}/api/casa/pollas/${slug}/join` };
}

async function image(page) {
  await page.goto(`${origin}/soporte`, { waitUntil: "domcontentloaded" });
  return Buffer.from(await page.evaluate(async () => {
    const canvas = document.createElement("canvas"); canvas.width = 720; canvas.height = 1280;
    const ctx = canvas.getContext("2d"); ctx.fillStyle = "white"; ctx.fillRect(0, 0, 720, 1280);
    ctx.fillStyle = "black"; ctx.font = "24px sans-serif";
    ctx.fillText("LOCAL TEST ONLY - NOT A REAL PAYMENT", 25, 100);
    ctx.fillText("Receipt regression fixture", 25, 180);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    return [...new Uint8Array(await blob.arrayBuffer())];
  }));
}

async function open(a, p) {
  await a.page.goto(`${origin}/polla/${p.slug}/pagar`, { waitUntil: "domcontentloaded" });
  await a.page.waitForFunction(() => {
    const input = document.querySelector('input[type="file"]');
    return input && Object.keys(input).some(key => key.startsWith("__reactProps"));
  });
}

async function choose(a, bytes, index = 0) {
  await a.page.locator('input[type="file"]').nth(index).setInputFiles({ name: "local-test.png", mimeType: "image/png", buffer: bytes });
  await a.page.getByAltText("Vista previa del comprobante").waitFor();
}

async function verify(p, userId) {
  const entries = await localDb.from("casa_entries").select("id,current_proof_attempt_id,proof_path,status").eq("polla_id", p.id).eq("user_id", userId);
  assert.ifError(entries.error); assert.equal(entries.data.length, 1);
  const entry = entries.data[0]; assert.equal(entry.status, "pendiente"); assert.ok(entry.proof_path);
  const attempts = await localDb.from("casa_entry_proof_attempts").select("id,state,content_bytes,content_sha256,proof_path").eq("entry_id", entry.id);
  assert.ifError(attempts.error); assert.equal(attempts.data.length, 1);
  const attempt = attempts.data[0]; assert.equal(attempt.state, "confirmed"); assert.equal(attempt.id, entry.current_proof_attempt_id);
  const stored = await localDb.storage.from("payment-proofs").download(attempt.proof_path); assert.ifError(stored.error);
  const bytes = Buffer.from(await stored.data.arrayBuffer());
  assert.equal(bytes.length, attempt.content_bytes); assert.equal(hash(bytes), attempt.content_sha256);
  return { poolId: p.id, entryId: entry.id, attemptId: attempt.id, storedBytes: bytes.length, storedSha256: hash(bytes) };
}

try {
  const admin = await actor("Local proof regression administrator", true);
  const player = await actor("Local proof regression player");
  const bytes = await image(player.page);

  // Reducing the quantity must not remove a receipt form while its write runs.
  const quantity = pool(admin.id, "Quantity during receipt upload");
  await open(player, quantity); await player.page.locator("#cuantos-cupos").selectOption("2");
  await choose(player, bytes, 1);
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const inFlight = new Promise(resolve => { started = resolve; });
  await player.page.route(quantity.url, async route => {
    if (route.request().postDataJSON().action === "begin") { started(); await gate; }
    await route.continue();
  });
  try {
    await player.page.getByRole("button", { name: "Enviar el comprobante", exact: true }).nth(1).click();
    let deadline;
    try {
      await Promise.race([inFlight, new Promise((_, reject) => {
        deadline = setTimeout(() => reject(new Error("Receipt begin request did not arrive")), 30_000);
      })]);
    } finally { clearTimeout(deadline); }
    assert.equal(await player.page.locator("#cuantos-cupos").isDisabled(), true);
    assert.equal(await player.page.locator("#cuantos-cupos").inputValue(), "2");
  } finally { release(); }
  await player.page.getByText("Comprobante 2 de 2 enviado", { exact: true }).waitFor();
  await player.page.unroute(quantity.url);
  report.cases.push({ name: "quantity-in-flight", ...await verify(quantity, player.id) });
  console.log("PASS quantity-in-flight");

  // All three begin responses disappear after committing; disabled storage must
  // not give a manual retry a different operation identity.
  const recovery = pool(admin.id, "Storage unavailable manual retry"); await open(player, recovery); await choose(player, bytes);
  await player.page.evaluate(() => Object.defineProperty(window, "sessionStorage", {
    configurable: true, get() { throw new DOMException("Storage blocked", "SecurityError"); },
  }));
  const requests = [];
  await player.page.route(recovery.url, async route => {
    requests.push(route.request().postDataJSON()); await route.fetch({ timeout: 30_000 }); await route.abort("connectionreset");
  });
  await player.page.getByRole("button", { name: "Enviar el comprobante", exact: true }).click();
  await player.page.locator('p[role="alert"]').waitFor();
  assert.equal(requests.length, 3); assert.equal(new Set(requests.map(r => r.requestId)).size, 1);
  await player.page.unroute(recovery.url);
  let retryRequest;
  await player.page.route(recovery.url, async route => { retryRequest ??= route.request().postDataJSON(); await route.continue(); });
  await player.page.getByRole("button", { name: /^Reintentar/ }).click();
  await player.page.getByText("Comprobante 1 de 1 enviado", { exact: true }).waitFor();
  assert.equal(retryRequest.requestId, requests[0].requestId);
  report.cases.push({ name: "storage-denied-stable-request", requestId: retryRequest.requestId, ...await verify(recovery, player.id) });
  console.log("PASS storage-denied-stable-request");

  // A success timer must not navigate back after the user chooses another route.
  const timer = pool(admin.id, "Success navigation cancellation");
  const begun = await player.context.request.post(timer.url, { headers: { "X-Casa-Contract": "2" }, data: {
    action: "begin", requestId: randomUUID(), ticketNumber: null, entryNumber: null,
    sha256: hash(bytes), contentType: "image/png", bytes: bytes.length,
  } }); assert.equal(begun.status(), 200);
  await open(player, timer); await choose(player, bytes);
  await player.page.getByRole("button", { name: "Enviar el comprobante", exact: true }).click();
  await player.page.getByText("Pago registrado", { exact: true }).waitFor();
  await player.page.getByRole("link", { name: "Perfil", exact: true }).click();
  await player.page.waitForURL("**/perfil"); await player.page.waitForTimeout(2000);
  assert.equal(new URL(player.page.url()).pathname, "/perfil");
  report.cases.push({ name: "unmount-cancels-success-navigation", ...await verify(timer, player.id) });
  console.log("PASS unmount-cancels-success-navigation"); report.passed = true;
} catch (error) {
  report.passed = false; report.failure = { message: error.message, stack: error.stack };
  console.error(error); process.exitCode = 1;
} finally {
  report.completedAt = new Date().toISOString();
  await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  await writeFile(path.join(output, "browser-errors.json"), JSON.stringify(report.browserErrors, null, 2));
  await browser.close(); console.log(`REPORT ${path.join(output, "report.json")}`);
}
