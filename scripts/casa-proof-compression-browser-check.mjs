// Browser compression of Casa proofs against LOCAL Docker Supabase + a local Next server.
// Never production: CASA_ORIGIN must be http://localhost:<port>; no messages are sent.
//
//   node scripts/casa-v2-local-env.mjs build 3217 && node scripts/casa-v2-local-env.mjs start 3217
//   CASA_ORIGIN=http://localhost:3217 node scripts/casa-proof-compression-browser-check.mjs
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createLocalBrowserActor, localDb, localSql, sqlQuote as q } from "./casa-local-browser-helpers.mjs";
import { localCredentials, localUrl } from "./casa-v2-local-env.mjs";

const origin = process.env.CASA_ORIGIN ?? "http://localhost:3217";
if (!/^http:\/\/localhost:\d+$/.test(origin)) throw new Error("This check only runs against a local origin.");
const output = process.env.CASA_PROOF_OUTPUT ?? path.join(tmpdir(), "casa-proof-compression-check");
await mkdir(output, { recursive: true });
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const KB = 1024;
const report = {};
const browser = await chromium.launch({ channel: "chrome", headless: true });

async function api(actor, route, body, method = "POST", expected = 200) {
  const response = await actor.context.request.fetch(origin + route, { method, headers: { "X-Casa-Contract": "2" }, ...(body ? { data: body } : {}) });
  const data = await response.json();
  assert.equal(response.status(), expected, `${method} ${route}: ${JSON.stringify(data)}`);
  return data;
}

function createRifa(adminId, name) {
  const id = randomUUID(), slug = `local-proof-${id}`;
  localSql(`BEGIN; SELECT public.casa_v2_context(2); INSERT INTO public.casa_pollas(id,slug,name,kind,status,closes_at,created_by,entry_price_cop,payout_method,payout_account,ticket_count,draw_method)
    VALUES(${q(id)},${q(slug)},${q(name)},'rifa','abierta',clock_timestamp()+interval '2 hours',${q(adminId)},10000,'otro','CUENTA LOCAL DE PRUEBA',100,'Sorteo local de prueba'); COMMIT;`);
  return { id, slug };
}

/** Deterministic synthetic images, generated once so every "same file" is byte-identical. */
async function makeImage(page, spec) {
  return Buffer.from(await page.evaluate(async (s) => {
    const canvas = document.createElement("canvas");
    canvas.width = s.width; canvas.height = s.height;
    const x = canvas.getContext("2d", { willReadFrequently: true });
    x.fillStyle = "#f3f5fa"; x.fillRect(0, 0, s.width, s.height);
    x.fillStyle = "#4a1f7a"; x.fillRect(0, 0, s.width, Math.round(s.height * 0.14));
    x.fillStyle = "#ffffff"; x.font = `bold ${Math.round(s.width / 18)}px sans-serif`;
    x.fillText("Transferencia exitosa", Math.round(s.width * 0.05), Math.round(s.height * 0.08));
    x.fillStyle = "#1b1f2a";
    const lines = Math.floor((s.height * 0.8) / 34);
    for (let i = 0; i < lines; i += 1) {
      x.font = `${26 + (i % 3) * 4}px sans-serif`;
      x.fillText(`Movimiento ${i + 1} · Ref ${(i * 7919) % 100000} · $ ${((i * 12345) % 1000000).toLocaleString("es-CO")}`, Math.round(s.width * 0.05), Math.round(s.height * 0.18) + i * 34);
    }
    // Low-amplitude seeded noise: behaves like a photographed/gradient receipt.
    const region = x.getImageData(0, Math.round(s.height * 0.5), s.width, Math.round(s.height * s.noise));
    let seed = 12345;
    for (let i = 0; i < region.data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const delta = (seed % (s.amplitude * 2 + 1)) - s.amplitude;
      region.data[i] += delta; region.data[i + 1] += delta; region.data[i + 2] += delta;
    }
    x.putImageData(region, 0, Math.round(s.height * 0.5));
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, s.type, s.quality));
    return [...new Uint8Array(await blob.arrayBuffer())];
  }, spec));
}

/** EXIF APP1 with Orientation=6 (rotate 90° CW) and a GPS IFD, inserted after APP0. */
function withExifOrientationAndGps(jpeg) {
  const tiff = Buffer.alloc(56);
  tiff.write("II", 0, "ascii"); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(2, 8);
  tiff.writeUInt16LE(0x0112, 10); tiff.writeUInt16LE(3, 12); tiff.writeUInt32LE(1, 14); tiff.writeUInt16LE(6, 18);
  tiff.writeUInt16LE(0x8825, 22); tiff.writeUInt16LE(4, 24); tiff.writeUInt32LE(1, 26); tiff.writeUInt32LE(38, 30);
  tiff.writeUInt32LE(0, 34);
  tiff.writeUInt16LE(1, 38);
  tiff.writeUInt16LE(0x0001, 40); tiff.writeUInt16LE(2, 42); tiff.writeUInt32LE(2, 44); tiff.write("N\0", 48, "ascii");
  tiff.writeUInt32LE(0, 52);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "ascii"), tiff]);
  const segment = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.from([(payload.length + 2) >> 8, (payload.length + 2) & 255]), payload]);
  assert.equal(jpeg[0], 0xff); assert.equal(jpeg[1], 0xd8);
  const afterApp0 = jpeg[2] === 0xff && jpeg[3] === 0xe0 ? 4 + jpeg.readUInt16BE(4) : 2;
  return Buffer.concat([jpeg.subarray(0, afterApp0), segment, jpeg.subarray(afterApp0)]);
}

function jpegInfo(buffer) {
  assert.ok(buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff, "stored proof must be a JPEG");
  let offset = 2, exif = false, size = null;
  while (offset + 4 < buffer.length) {
    if (buffer[offset] !== 0xff) break;
    const marker = buffer[offset + 1], length = buffer.readUInt16BE(offset + 2);
    if (marker === 0xe1 && buffer.toString("ascii", offset + 4, offset + 8) === "Exif") exif = true;
    if ([0xc0, 0xc1, 0xc2].includes(marker)) size = { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    if (marker === 0xda) break;
    offset += 2 + length;
  }
  return { exif, size };
}

/** Collects the begin bodies the real component sends; optionally answers them without touching the DB. */
function watchBegins(page, { respondCode } = {}) {
  const begins = [];
  const handler = async (route) => {
    const body = route.request().postDataJSON();
    if (body?.action === "begin") begins.push(body);
    if (respondCode && body?.action === "begin") {
      return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "Respuesta local de prueba.", code: respondCode }) });
    }
    return route.continue();
  };
  return { begins, attach: () => page.route("**/api/casa/pollas/*/join", handler), detach: () => page.unroute("**/api/casa/pollas/*/join", handler) };
}

async function openPagar(actor, slug, ticket) {
  await actor.page.goto(`${origin}/casa/${slug}/pagar${ticket && ticket.boleta ? `?boleta=${ticket.number}` : ""}`, { waitUntil: "networkidle", timeout: 90000 });
  if (ticket && !ticket.boleta) await actor.page.locator("select").selectOption(String(ticket.number));
}

async function chooseFile(page, file) {
  const started = Date.now();
  await page.locator("input[type=file]").setInputFiles(file);
  const button = page.getByRole("button", { name: "Enviar el comprobante", exact: true });
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll("button")].find((el) => el.textContent?.trim() === "Enviar el comprobante");
    return b && !b.disabled && document.querySelector('img[alt="Vista previa del comprobante"]');
  }, null, { timeout: 60000 });
  return { button, ms: Date.now() - started };
}

async function attemptFor(pollaId, userId) {
  const entry = await localDb.from("casa_entries").select("id,current_proof_attempt_id,proof_path,status").eq("polla_id", pollaId).eq("user_id", userId).single();
  assert.ifError(entry.error);
  const attempt = await localDb.from("casa_entry_proof_attempts").select("id,state,content_sha256,content_type,content_bytes,proof_path").eq("id", entry.data.current_proof_attempt_id).single();
  assert.ifError(attempt.error);
  return { entry: entry.data, attempt: attempt.data };
}

async function storedObject(bucket, objectPath) {
  const { data, error } = await localDb.storage.from(bucket).download(objectPath);
  assert.ifError(error);
  return Buffer.from(await data.arrayBuffer());
}

try {
  const admin = await createLocalBrowserActor(browser, { name: "Administrador compresión local", admin: true, origin });
  const player = await createLocalBrowserActor(browser, { name: "Participante compresión local", origin });
  const other = await createLocalBrowserActor(browser, { name: "Otro dispositivo compresión local", origin });
  const legacy = await createLocalBrowserActor(browser, { name: "Cliente anterior compresión local", origin });
  for (const actor of [admin, player, other, legacy]) { actor.page.setDefaultTimeout(60000); await actor.page.goto(`${origin}/casa`, { waitUntil: "domcontentloaded" }); }

  const capture = await makeImage(player.page, { width: 1179, height: 2556, type: "image/png", noise: 0.25, amplitude: 6 });
  const captureSha = sha256(capture);
  report.capture = { bytes: capture.length, sha256: captureSha };
  assert.ok(capture.length > 300 * KB && capture.length <= 8 * 1024 * KB, `synthetic capture must be between 300 KB and 8 MB, got ${capture.length}`);
  const captureFile = { name: "captura-comprobante.png", mimeType: "image/png", buffer: capture };

  // (a) Real UI upload of a 1179x2556 capture over 300 KB.
  const a = createRifa(admin.id, "Compresión: captura grande");
  await openPagar(player, a.slug, { number: 3 });
  const aWatch = watchBegins(player.page); await aWatch.attach();
  const aChoice = await chooseFile(player.page, captureFile);
  for (const width of [320, 768, 1440]) {
    await player.page.setViewportSize({ width, height: 1000 });
    await player.page.waitForTimeout(500);
    await player.page.screenshot({ path: `${output}/pagar-preparado-${width}.png`, fullPage: true });
    assert.ok(await player.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `pagar overflow at ${width}`);
  }
  await player.page.setViewportSize({ width: 390, height: 900 });
  await aChoice.button.click();
  await player.page.getByText("Pago registrado", { exact: true }).waitFor({ timeout: 60000 });
  await aWatch.detach();
  const aState = await attemptFor(a.id, player.id);
  const aObject = await storedObject("payment-proofs", aState.attempt.proof_path);
  const aJpeg = jpegInfo(aObject);
  assert.equal(aState.attempt.content_type, "image/jpeg");
  assert.ok(aState.attempt.content_bytes < 400 * KB, `compressed proof must be < 400 KB, got ${aState.attempt.content_bytes}`);
  assert.equal(aObject.length, aState.attempt.content_bytes);
  assert.equal(sha256(aObject), aState.attempt.content_sha256);
  assert.deepEqual(aJpeg.size, { width: 738, height: 1600 });
  assert.equal(aJpeg.exif, false);
  assert.equal(aWatch.begins.length, 1);
  assert.equal(aWatch.begins[0].sha256, aState.attempt.content_sha256);
  const aStored = await player.page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), `casa-proof:${a.slug}:3`).catch(() => null);
  report.a = { prepareMs: aChoice.ms, bytes: aState.attempt.content_bytes, sha256: aState.attempt.content_sha256, size: aJpeg.size, storedRecord: aStored };
  console.log("PASS (a) 1179x2556 capture -> image/jpeg", aState.attempt.content_bytes, "bytes, 738x1600, object sha256 == content_sha256, no EXIF");

  // (b) Determinism: same file 3x in one tab, once in another tab, once in another context.
  const b = createRifa(admin.id, "Compresión: determinismo");
  const runs = [];
  async function deterministicRun(actor, page, label) {
    const watch = watchBegins(page, { respondCode: "UPLOAD_IN_PROGRESS" }); await watch.attach();
    await page.evaluate(() => sessionStorage.clear());
    const choice = await chooseFile(page, captureFile);
    await choice.button.click();
    await page.getByText("Respuesta local de prueba.", { exact: false }).waitFor();
    await watch.detach();
    assert.equal(watch.begins.length, 2, `${label}: prepared candidate then original candidate`);
    runs.push({ label, prepared: watch.begins[0].sha256, original: watch.begins[1].sha256, contentTypes: watch.begins.map((x) => x.contentType), bytes: watch.begins[0].bytes, prepareMs: choice.ms });
  }
  await openPagar(player, b.slug, { number: 5 });
  for (let i = 1; i <= 3; i += 1) await deterministicRun(player, player.page, `same-tab-${i}`);
  const secondTab = await player.context.newPage();
  const tabActor = { ...player, page: secondTab };
  await openPagar(tabActor, b.slug, { number: 5 });
  await deterministicRun(tabActor, secondTab, "second-tab");
  await secondTab.close();
  await openPagar(other, b.slug, { number: 6 });
  await deterministicRun(other, other.page, "other-context");
  report.b = runs;
  for (const run of runs) {
    assert.deepEqual(run.contentTypes, ["image/jpeg", "image/png"]);
    assert.equal(run.original, captureSha);
    assert.equal(run.prepared, runs[0].prepared, `non-deterministic preparation: ${JSON.stringify(runs)}`);
  }
  assert.equal(runs[0].prepared, aState.attempt.content_sha256, "the uploaded proof in (a) used the same bytes");
  const bRows = localSql(`SELECT count(*) FROM casa_entries WHERE polla_id=${q(b.id)};`);
  assert.equal(bRows, "0", "mocked begins must not create entries");
  console.log("PASS (b) deterministic prepared sha256 across 3 runs, a second tab and a second context:", runs[0].prepared);

  // (c) Begin with ORIGINAL bytes (old client / other engine), upload them, close, then the UI resumes the same attempt.
  const c = createRifa(admin.id, "Compresión: recuperación tras cierre");
  const cBegin = await api(other, `/api/casa/pollas/${c.slug}/join`, { action: "begin", requestId: randomUUID(), ticketNumber: 11, sha256: captureSha, contentType: "image/png", bytes: capture.length });
  const put = await createClient(localUrl, localCredentials().anon, { auth: { persistSession: false } }).storage.from(cBegin.upload.bucket)
    .uploadToSignedUrl(cBegin.upload.path, cBegin.upload.token, capture, { contentType: "image/png", upsert: false });
  assert.ifError(put.error);
  await api(admin, `/api/casa/admin/pollas/${c.id}`, { action: "cerrar" }, "PATCH");
  await openPagar(other, c.slug, { number: 11, boleta: true });
  await other.page.getByText("La inscripción cerró.", { exact: false }).waitFor();
  const cWatch = watchBegins(other.page); await cWatch.attach();
  const cChoice = await chooseFile(other.page, captureFile);
  await cChoice.button.click();
  await other.page.getByText("Pago registrado", { exact: true }).waitFor({ timeout: 60000 });
  await cWatch.detach();
  const cState = await attemptFor(c.id, other.id);
  assert.equal(cState.attempt.id, cBegin.attempt_id);
  assert.equal(cState.attempt.state, "confirmed");
  assert.deepEqual(cWatch.begins.map((x) => x.contentType), ["image/jpeg", "image/png"]);
  report.c = { attemptId: cBegin.attempt_id, begins: cWatch.begins.map((x) => ({ sha256: x.sha256, contentType: x.contentType })) };
  console.log("PASS (c) original-bytes attempt + close + UI with same file -> UPLOAD_IN_PROGRESS on prepared, same attempt_id via original");

  // (c2) Same, but the original bytes were never uploaded: the UI uploads the original after close.
  const c2 = createRifa(admin.id, "Compresión: recuperación sin subida");
  const c2Begin = await api(other, `/api/casa/pollas/${c2.slug}/join`, { action: "begin", requestId: randomUUID(), ticketNumber: 12, sha256: captureSha, contentType: "image/png", bytes: capture.length });
  await api(admin, `/api/casa/admin/pollas/${c2.id}`, { action: "cerrar" }, "PATCH");
  await openPagar(other, c2.slug, { number: 12, boleta: true });
  const c2Choice = await chooseFile(other.page, captureFile);
  await c2Choice.button.click();
  await other.page.getByText("Pago registrado", { exact: true }).waitFor({ timeout: 60000 });
  const c2State = await attemptFor(c2.id, other.id);
  assert.equal(c2State.attempt.id, c2Begin.attempt_id);
  assert.equal(sha256(await storedObject("payment-proofs", c2State.attempt.proof_path)), captureSha);
  console.log("PASS (c2) begun-but-not-uploaded original resumes after close and uploads the original bytes");

  // (d) Legacy sessionStorage record ({sha256, requestId, attemptId} of the original) is reused first.
  const d = createRifa(admin.id, "Compresión: registro anterior");
  const dRequest = randomUUID();
  const dBegin = await api(legacy, `/api/casa/pollas/${d.slug}/join`, { action: "begin", requestId: dRequest, ticketNumber: 21, sha256: captureSha, contentType: "image/png", bytes: capture.length });
  await openPagar(legacy, d.slug, { number: 21, boleta: true });
  await legacy.page.evaluate(({ key, value }) => sessionStorage.setItem(key, value), { key: `casa-proof:${d.slug}:21`, value: JSON.stringify({ sha256: captureSha, requestId: dRequest, attemptId: dBegin.attempt_id }) });
  const dWatch = watchBegins(legacy.page); await dWatch.attach();
  const dChoice = await chooseFile(legacy.page, captureFile);
  await dChoice.button.click();
  await legacy.page.getByText("Pago registrado", { exact: true }).waitFor({ timeout: 60000 });
  await dWatch.detach();
  assert.equal(dWatch.begins[0].requestId, dRequest);
  assert.equal(dWatch.begins[0].sha256, captureSha);
  assert.equal((await attemptFor(d.id, legacy.id)).attempt.id, dBegin.attempt_id);
  console.log("PASS (d) legacy sessionStorage record resumes the original attempt with its request id");

  // (e) EXIF orientation is applied and EXIF/GPS is removed; mid-range CPU (4x throttle) timing.
  const photo = withExifOrientationAndGps(await makeImage(player.page, { width: 2556, height: 1179, type: "image/jpeg", quality: 0.97, noise: 0.45, amplitude: 10 }));
  assert.ok(photo.length > 300 * KB, `EXIF photo must exceed 300 KB, got ${photo.length}`);
  const e = createRifa(admin.id, "Compresión: orientación EXIF");
  await openPagar(legacy, e.slug, { number: 31 });
  const cdp = await legacy.context.newCDPSession(legacy.page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const status = legacy.page.getByRole("status").filter({ hasText: "Preparando la imagen…" });
  const eChoicePromise = chooseFile(legacy.page, { name: "foto-girada.jpg", mimeType: "image/jpeg", buffer: photo });
  const sawPreparing = await status.waitFor({ timeout: 5000 }).then(() => true, () => false);
  const disabledWhilePreparing = sawPreparing ? await legacy.page.getByRole("button", { name: "Enviar el comprobante", exact: true }).isDisabled() : null;
  if (sawPreparing) {
    await status.scrollIntoViewIfNeeded().catch(() => {});
    await legacy.page.screenshot({ path: `${output}/pagar-preparando-390.png` }).catch(() => {});
  }
  const eChoice = await eChoicePromise;
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await eChoice.button.click();
  await legacy.page.getByText("Pago registrado", { exact: true }).waitFor({ timeout: 60000 });
  const eState = await attemptFor(e.id, legacy.id);
  const eInfo = jpegInfo(await storedObject("payment-proofs", eState.attempt.proof_path));
  assert.deepEqual(eInfo.size, { width: 738, height: 1600 }, "EXIF orientation 6 must produce a portrait proof");
  assert.equal(eInfo.exif, false, "EXIF/GPS must be stripped");
  if (sawPreparing) assert.equal(disabledWhilePreparing, true);
  report.e = { inputBytes: photo.length, outputBytes: eState.attempt.content_bytes, size: eInfo.size, exif: eInfo.exif, prepareMsCpu4x: eChoice.ms, sawPreparing, disabledWhilePreparing };
  console.log("PASS (e) EXIF orientation applied, EXIF/GPS stripped;", JSON.stringify(report.e));

  // (f) Prize image: > 1 MB is reduced below 1 MB before the multipart request.
  const prize = await makeImage(admin.page, { width: 4000, height: 3000, type: "image/png", noise: 0.5, amplitude: 8 });
  assert.ok(prize.length > 1024 * KB, `prize image must exceed 1 MB, got ${prize.length}`);
  await admin.page.goto(`${origin}/admin/pollas/crear`, { waitUntil: "networkidle", timeout: 90000 });
  await admin.page.getByRole("button", { name: "Objeto", exact: true }).click();
  // CDP does not expose multipart blob bodies: record what the component appends instead.
  await admin.page.evaluate(() => {
    const original = window.fetch;
    window.fetch = (input, init) => {
      if (String(input).includes("/api/casa/admin/prize-image") && init?.body instanceof FormData) {
        const image = init.body.get("image");
        window.__prizeUpload = { size: image.size, type: image.type, name: image.name };
      }
      return original(input, init);
    };
  });
  const prizeResponse = admin.page.waitForResponse((response) => response.url().endsWith("/api/casa/admin/prize-image"));
  await admin.page.locator('input[type=file][accept="image/jpeg,image/png,image/webp"]').setInputFiles({ name: "premio.png", mimeType: "image/png", buffer: prize });
  const prizeJson = await (await prizeResponse).json();
  const sent = await admin.page.evaluate(() => window.__prizeUpload);
  assert.equal(sent?.type, "image/jpeg");
  const sentBytes = sent.size;
  assert.ok(prizeJson.ok, JSON.stringify(prizeJson));
  await admin.page.getByAltText("Foto del premio").waitFor();
  const prizeObject = await storedObject("prize-images", prizeJson.path);
  assert.ok(prizeJson.path.endsWith(".jpg"));
  assert.ok(prizeObject.length < 1024 * KB, `prize image must be < 1 MB, got ${prizeObject.length}`);
  assert.ok(sentBytes < 1024 * KB && sentBytes === prizeObject.length, `appended prize image must be < 1 MB, got ${sentBytes}`);
  report.f = { inputBytes: prize.length, appendedBytes: sentBytes, storedBytes: prizeObject.length, size: jpegInfo(prizeObject).size };
  console.log("PASS (f) prize image", prize.length, "->", prizeObject.length, "bytes JPEG", JSON.stringify(report.f.size));

  // (g) Undecodable HEIC and oversized input get their own messages; nothing is sent.
  const g = createRifa(admin.id, "Compresión: errores de selección");
  await openPagar(legacy, g.slug, { number: 41 });
  const gWatch = watchBegins(legacy.page); await gWatch.attach();
  await legacy.page.locator("input[type=file]").setInputFiles({ name: "IMG_0001.HEIC", mimeType: "image/heic", buffer: Buffer.alloc(400 * KB, 7) });
  await legacy.page.getByText("No pudimos abrir esa foto de iPhone (HEIC).", { exact: false }).waitFor();
  assert.equal(await legacy.page.getByRole("button", { name: "Enviar el comprobante", exact: true }).isDisabled(), true);
  await legacy.page.locator("input[type=file]").setInputFiles({ name: "enorme.png", mimeType: "image/png", buffer: Buffer.alloc(21 * 1024 * KB, 1) });
  await legacy.page.getByText("La imagen supera los 20 MB.", { exact: false }).waitFor();
  assert.equal(gWatch.begins.length, 0);
  await gWatch.detach();
  console.log("PASS (g) HEIC that cannot be decoded and >20 MB input show specific messages without begin");

  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log("REPORT", JSON.stringify(report));
} finally {
  await browser.close();
}
