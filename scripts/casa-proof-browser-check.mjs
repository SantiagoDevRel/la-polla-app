// Real browser/Storage/SQL regressions against an explicitly guarded local server.
// Set CASA_ORIGIN and CASA_LOCAL_SERVER_STATE to the local startup state JSON.
// Creates synthetic local fixtures only. No production credentials or notifications.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "@playwright/test";
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
const engine = process.env.CASA_BROWSER_ENGINE ?? "chrome";
assert.ok(["chrome", "webkit"].includes(engine), "CASA_BROWSER_ENGINE must be chrome or webkit");
const report = { origin, engine, startedAt: new Date().toISOString(), cases: [], browserErrors: [] };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const browser = engine === "webkit" ? await webkit.launch({ headless: true })
  : await chromium.launch({ channel: "chrome", headless: true });
let currentPage;
process.on("SIGINT", async () => { await browser.close(); process.exit(130); });

async function actor(name, admin = false) {
  const a = await createLocalBrowserActor(browser, { name, admin, origin });
  currentPage = a.page;
  a.page.setDefaultTimeout(30_000);
  a.page.on("pageerror", error => report.browserErrors.push({ message: error.message, stack: error.stack }));
  await a.context.route("**/*", route => {
    const url = new URL(route.request().url());
    // WebKit intercepts local image blob requests; aborting them prevents
    // decoding/preview and creates an artificial image-preparation hang.
    const localBlob = url.protocol === "blob:" && url.origin === origin;
    return localBlob || url.protocol === "data:" || ["localhost", "127.0.0.1"].includes(url.hostname)
      ? route.continue() : route.abort("blockedbyclient");
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
  currentPage = a.page;
  await a.page.goto(`${origin}/polla/${p.slug}/pagar`, { waitUntil: "domcontentloaded" });
  await a.page.waitForFunction(() => {
    const input = document.querySelector('input[type="file"]');
    return input && !input.disabled && Object.keys(input).some(key => key.startsWith("__reactProps"));
  });
}

async function choose(a, bytes, index = 0) {
  await a.page.locator('input[type="file"]').nth(index).setInputFiles({ name: "local-test.png", mimeType: "image/png", buffer: bytes });
  await a.page.getByAltText("Vista previa del comprobante").waitFor();
  await a.page.waitForFunction(() => {
    const img = document.querySelector('img[alt="Vista previa del comprobante"]');
    return img?.complete && img.naturalWidth > 0;
  });
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

async function inspect(page, state) {
  report.visual ??= [];
  // WebKit waits for blocked scripts before resolving fonts.ready. Inspect the
  // SSR loading state without turning that deliberate network hold into a wait.
  if (state !== "loading") await page.evaluate(() => document.fonts.ready);
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const scale of [1, 2]) {
      await page.evaluate(factor => {
        const originals = [...document.querySelectorAll("body *")].map(el => ({
          el, marker: el.getAttribute("data-proof-text-size"), size: parseFloat(getComputedStyle(el).fontSize),
        }));
        if (factor === 2) {
          window.__proofVisualStyles = originals;
          const sheet = document.createElement("style");
          sheet.textContent = originals.map(({ el, size }, i) => {
            el.setAttribute("data-proof-text-size", String(i));
            return `[data-proof-text-size="${i}"] { font-size: ${size * factor}px !important; }`;
          }).join("\n");
          window.__proofVisualSheet = sheet; document.head.append(sheet);
        }
      }, scale);
      try {
        const visual = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth - innerWidth,
          fonts: [...document.fonts].map(font => ({ family: font.family, status: font.status })),
          controls: [...document.querySelectorAll("button,a,p")].map(el => {
            const css = getComputedStyle(el);
            return { text: el.textContent.trim(), family: css.fontFamily, size: css.fontSize, weight: css.fontWeight };
          }),
          oversized: [...document.querySelectorAll("body *")].filter(el => {
            const box = el.getBoundingClientRect();
            return box.right > innerWidth + 1 || box.left < -1;
          }).map(el => ({ tag: el.tagName, class: el.className, text: el.textContent.trim().slice(0, 160), right: el.getBoundingClientRect().right })),
        }));
        const fontWait = process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY;
        if (state === "loading") process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = "1";
        try {
          await page.screenshot({ path: path.join(output, `${state}-${width}${scale === 2 ? "-text-200" : ""}.png`), fullPage: true });
        } finally {
          if (fontWait === undefined) delete process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY;
          else process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = fontWait;
        }
        report.visual.push({ state, width, textScale: scale, ...visual });
        assert.ok(visual.overflow <= 1, `${state}: overflow at ${width}, text scale ${scale}`);
      } finally {
        if (scale === 2) await page.evaluate(() => {
          // A temporary stylesheet restores the cascade atomically, including
          // any nodes that React inserted while the screenshot was captured.
          window.__proofVisualSheet.remove(); delete window.__proofVisualSheet;
          for (const { el, marker } of window.__proofVisualStyles) {
            if (marker === null) el.removeAttribute("data-proof-text-size"); else el.setAttribute("data-proof-text-size", marker);
          }
          delete window.__proofVisualStyles;
        });
      }
    }
  }
}

try {
  const admin = await actor("Local proof regression administrator", true);
  const player = await actor("Local proof regression player");
  const bytes = await image(player.page);

  // Reducing the quantity must not remove a receipt form while its write runs.
  const quantity = pool(admin.id, "Quantity during receipt upload");
  await open(player, quantity); await player.page.locator("#cuantos-cupos").selectOption("2");
  assert.equal(await player.page.locator('input[type="file"]').count(), 2);
  const selectStyle = await player.page.locator("#cuantos-cupos").evaluate(el => {
    const style = getComputedStyle(el);
    const luminance = color => color.match(/\d+/g).slice(0, 3).map(Number).map(value => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
    const foreground = luminance(style.color), background = luminance(style.backgroundColor);
    return { appearance: style.appearance, colorScheme: style.colorScheme, color: style.color, background: style.backgroundColor,
      fontSize: style.fontSize, paddingRight: style.paddingRight,
      contrast: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05) };
  });
  assert.equal(selectStyle.appearance, "none");
  assert.equal(selectStyle.colorScheme, "dark");
  assert.ok(selectStyle.contrast >= 4.5);
  assert.equal(selectStyle.fontSize, "15px");
  await player.page.locator("#cuantos-cupos").screenshot({ path: path.join(output, "quantity-select.png") });
  report.selectStyle = selectStyle;
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
  console.log("PASS unmount-cancels-success-navigation");

  // Native SSR controls must not accept input before their React state exists.
  // This covers a real WebKit file chooser, not programmatic file injection.
  const early = await actor("Local slow-script receipt player");
  const slow = pool(admin.id, "Slow JavaScript receipt readiness");
  let releaseScripts;
  const scriptsReady = new Promise(resolve => { releaseScripts = resolve; });
  await early.page.route("**/_next/static/**/*.js", async route => {
    await scriptsReady; await route.continue().catch(() => {});
  });
  try {
    await early.page.goto(`${origin}/polla/${slow.slug}/pagar`, { waitUntil: "commit" });
    const picker = early.page.locator("button").filter({ has: early.page.getByText("Cargando el formulario...", { exact: true }) });
    await picker.waitFor();
    assert.equal(await picker.isDisabled(), true);
    const input = early.page.locator('input[type="file"]');
    assert.equal(await input.isDisabled(), true);
    assert.equal(await early.page.locator("#cuantos-cupos").isDisabled(), true);
    await inspect(early.page, "loading");
    const prematureChooser = early.page.waitForEvent("filechooser", { timeout: 500 }).catch(() => null);
    await input.focus(); await early.page.keyboard.press("Enter");
    assert.equal(await prematureChooser, null);
  } finally { releaseScripts(); }
  await early.page.waitForFunction(() => !document.querySelector('input[type="file"]')?.disabled);
  await early.page.locator("#cuantos-cupos").selectOption("2");
  assert.equal(await early.page.locator('input[type="file"]').count(), 2);
  const readyChooser = early.page.waitForEvent("filechooser");
  await early.page.getByRole("button", { name: "Sube aquí el comprobante", exact: true }).first().click();
  const chooser = await readyChooser;
  await chooser.setFiles({ name: "local-after-ready.png", mimeType: "image/png", buffer: bytes });
  await early.page.getByAltText("Vista previa del comprobante").waitFor();
  await early.page.getByRole("button", { name: "Enviar el comprobante", exact: true }).first().click();
  await early.page.getByText("Comprobante 1 de 2 enviado", { exact: true }).waitFor();
  report.cases.push({ name: "slow-scripts-safe-native-controls", ...await verify(slow, early.id) });
  console.log("PASS slow-scripts-safe-native-controls");

  // Lose only this synthetic browser's session, then restore the SAME actor's
  // fixture cookies. Real auth rejects the first write before touching the DB.
  const expiry = pool(admin.id, "Receipt session recovery");
  await open(player, expiry); await choose(player, bytes);
  const originalCookies = await player.context.cookies();
  await player.context.clearCookies();
  const expiryRequests = [];
  await player.page.route(expiry.url, async route => {
    expiryRequests.push(route.request().postDataJSON()); await route.continue();
  });
  await player.page.getByRole("button", { name: "Enviar el comprobante", exact: true }).click();
  const login = player.page.getByRole("link", { name: "Ingresar de nuevo", exact: true });
  await login.waitFor();
  assert.equal(await player.page.getByAltText("Vista previa del comprobante").count(), 1);
  await inspect(player.page, "session-recovery");
  const popupOpened = player.page.waitForEvent("popup"); await login.click();
  const popup = await popupOpened;
  try {
    await popup.waitForURL(url => url.pathname === "/login");
    assert.equal(await login.getAttribute("target"), "_blank");
    assert.equal(new URL(player.page.url()).pathname, `/polla/${expiry.slug}/pagar`);
    await player.context.addCookies(originalCookies);
  } finally { await popup.close(); }
  await player.page.getByRole("button", { name: /^Reintentar/ }).click();
  await player.page.getByText("Comprobante 1 de 1 enviado", { exact: true }).waitFor();
  const beginRequests = expiryRequests.filter(request => request.action === "begin");
  assert.equal(beginRequests.length, 2);
  assert.equal(new Set(beginRequests.map(request => request.requestId)).size, 1);
  report.cases.push({ name: "session-recovery-keeps-receipt-and-request", requestId: beginRequests[0].requestId, ...await verify(expiry, player.id) });
  console.log("PASS session-recovery-keeps-receipt-and-request");

  // A confirmation acknowledgement can arrive after the form has unmounted.
  // The committed receipt remains valid, but its old form must not redirect.
  const late = pool(admin.id, "Navigation during receipt confirmation");
  const reservation = await player.context.request.post(late.url, { headers: { "X-Casa-Contract": "2" }, data: {
    action: "begin", requestId: randomUUID(), ticketNumber: null, entryNumber: null,
    sha256: hash(bytes), contentType: "image/png", bytes: bytes.length,
  } }); assert.equal(reservation.status(), 200);
  await open(player, late); await choose(player, bytes);
  let releaseConfirmation, confirmationStarted;
  const confirmationGate = new Promise(resolve => { releaseConfirmation = resolve; });
  const confirmationReady = new Promise(resolve => { confirmationStarted = resolve; });
  await player.page.route(late.url, async route => {
    if (route.request().postDataJSON().action !== "confirm") return route.continue();
    const response = await route.fetch({ timeout: 30_000 });
    assert.equal(response.status(), 200); confirmationStarted();
    await confirmationGate; await route.fulfill({ response }).catch(() => {});
  });
  try {
    await player.page.getByRole("button", { name: "Enviar el comprobante", exact: true }).click();
    let deadline;
    try { await Promise.race([confirmationReady, new Promise((_, reject) => {
      deadline = setTimeout(() => reject(new Error("Confirmation request did not arrive")), 30_000);
    })]); } finally { clearTimeout(deadline); }
    await player.page.getByRole("link", { name: "Perfil", exact: true }).click();
    await player.page.waitForURL("**/perfil");
  } finally { releaseConfirmation(); }
  await player.page.waitForTimeout(2400);
  assert.equal(new URL(player.page.url()).pathname, "/perfil");
  report.cases.push({ name: "unmount-before-confirmation-acknowledgement", ...await verify(late, player.id) });
  console.log("PASS unmount-before-confirmation-acknowledgement");

  const success = pool(admin.id, "Standalone confirmation next action");
  const reserveSuccess = await player.context.request.post(success.url, { headers: { "X-Casa-Contract": "2" }, data: {
    action: "begin", requestId: randomUUID(), ticketNumber: null, entryNumber: null,
    sha256: hash(bytes), contentType: "image/png", bytes: bytes.length,
  } }); assert.equal(reserveSuccess.status(), 200);
  await open(player, success); await choose(player, bytes);
  // Real 1600ms cancellation is tested above. Hold only this visual case's
  // automatic redirect so slow screenshot/font operations cannot race the CTA.
  await player.page.evaluate(() => {
    window.__proofOriginalTimeout = window.setTimeout;
    window.setTimeout = (handler, delay, ...args) => window.__proofOriginalTimeout(handler, delay === 1600 ? 60_000 : delay, ...args);
  });
  await player.page.getByRole("button", { name: "Enviar el comprobante", exact: true }).click();
  await player.page.getByText("Pago registrado", { exact: true }).waitFor();
  const next = player.page.getByRole("link", { name: "Ver mi cupo y pronosticar", exact: true });
  assert.equal(await next.getAttribute("href"), `/polla/${success.slug}?p=1`);
  await inspect(player.page, "standalone-success");
  await player.page.evaluate(() => { window.setTimeout = window.__proofOriginalTimeout; delete window.__proofOriginalTimeout; });
  await next.click(); await player.page.waitForURL(url => url.pathname === `/polla/${success.slug}`);
  await player.page.getByText("Pago en revisión", { exact: true }).waitFor();
  report.cases.push({ name: "standalone-success-next-action", ...await verify(success, player.id) });
  console.log("PASS standalone-success-next-action"); report.passed = true;
} catch (error) {
  report.passed = false; report.failure = { message: error.message, stack: error.stack };
  if (currentPage && !currentPage.isClosed()) {
    report.failure.page = await currentPage.evaluate(() => ({ url: location.href, body: document.body.innerText })).catch(() => null);
    await currentPage.screenshot({ path: path.join(output, "failure.png"), fullPage: true }).catch(() => {});
  }
  console.error(error); process.exitCode = 1;
} finally {
  report.completedAt = new Date().toISOString();
  await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  await writeFile(path.join(output, "browser-errors.json"), JSON.stringify(report.browserErrors, null, 2));
  await browser.close(); console.log(`REPORT ${path.join(output, "report.json")}`);
}
