// Migración 131 end-to-end against the LOCAL Supabase Docker project and a local dev server.
//   CASA_ORIGIN=http://localhost:3107 CASA_LOCAL_SUPABASE_URL=http://127.0.0.1:18321 node scripts/casa-multi-entries-browser-check.mjs
// Real pages, real upload to local Storage, real admin approvals. Fixtures stay in the local DB for inspection.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { createLocalBrowserActor, localDb, localSql, sqlQuote as q } from "./casa-local-browser-helpers.mjs";

const origin = process.env.CASA_ORIGIN ?? "http://localhost:3107";
if (!/^http:\/\/localhost:\d+$/.test(origin)) throw new Error("Local origin only.");
const output = process.env.CASA_CAPTURES ?? "C:/Users/STZTR/Downloads/la-polla-multi-entradas-browser";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });

async function screen(page, name, widths = [320, 768, 1440]) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${output}/${name}-${width}.png`, fullPage: true });
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(scroll <= width + 1, `${name}/${width}: horizontal overflow (${scroll})`);
  }
  await page.setViewportSize({ width: 390, height: 900 });
}
async function zoom(page, name) {
  await page.setViewportSize({ width: 320, height: 1000 });
  await page.evaluate(() => { for (const [el, size] of [...document.querySelectorAll("body *")].map(el => [el, parseFloat(getComputedStyle(el).fontSize)])) el.style.setProperty("font-size", `${size * 2}px`, "important"); });
  await page.screenshot({ path: `${output}/${name}-zoom200.png`, fullPage: true });
  const offenders = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 ? [] : [...document.querySelectorAll("body *")]
    .filter(el => { const r = el.getBoundingClientRect(); if (!(r.width > 0 && r.right > innerWidth + 1)) return false;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const o = getComputedStyle(a); if (["hidden", "clip", "auto", "scroll"].includes(o.overflowX) || o.position === "fixed") return false; }
      return getComputedStyle(el).position !== "fixed"; })
    .slice(0, 12).map(el => `${el.tagName}.${String(el.className).slice(0, 70)} "${(el.textContent || "").trim().slice(0, 40)}" right=${Math.round(el.getBoundingClientRect().right)}`));
  assert.deepEqual(offenders, [], `${name}: overflow at 200% text`);
  await page.evaluate(() => { for (const el of document.querySelectorAll("body *")) el.style.removeProperty("font-size"); });
  await page.setViewportSize({ width: 390, height: 900 });
}
async function hydrated(page) {
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some(b => Object.keys(b).some(k => k.startsWith("__reactProps$"))));
}
async function sendProof(page, label, slot = 0) {
  await hydrated(page);
  const png = await page.evaluate((text) => { const c = document.createElement("canvas"); c.width = 520; c.height = 200; const x = c.getContext("2d"); x.fillStyle = "white"; x.fillRect(0, 0, 520, 200); x.fillStyle = "black"; x.font = "24px sans-serif"; x.fillText(text, 12, 100); return c.toDataURL("image/png").split(",")[1]; }, label);
  await page.locator("input[type=file]").nth(slot).setInputFiles({ name: `${label}.png`, mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  const send = page.getByRole("button", { name: "Enviar el comprobante", exact: true }).first();
  await send.waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some(b => b.textContent === "Enviar el comprobante" && !b.disabled));
  await page.locator("button:not([disabled])", { hasText: "Enviar el comprobante" }).first().click();
}

async function chooseCupo(page, slug, n) {
  await page.getByLabel("Elige el cupo para ver o editar sus pronósticos", { exact: true }).selectOption(String(n));
  await page.waitForURL(`**/casa/${slug}?p=${n}`);
  await hydrated(page);
}

const opened = [];
try {
  const suffix = randomUUID().slice(0, 6);
  const admin = await createLocalBrowserActor(browser, { name: "Administrador multi local", admin: true, origin });
  const ana = await createLocalBrowserActor(browser, { name: "Ana Cupos", origin });
  opened.push(admin.page, ana.page);
  for (const actor of [admin, ana]) { actor.page.setDefaultTimeout(45000); actor.page.setDefaultNavigationTimeout(120000); }

  // ── Fixture: a real match pool with two future matches, $20.000, up to 5 cupos per person.
  const home = `Local ${suffix}`, away = `Visita ${suffix}`;
  const m1 = localSql(`SELECT public.upsert_match_safe('lpmulti-1-${suffix}','premier_2025',1,'league',${q(home)},${q(away)},NULL,NULL,now()+interval '3 days',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);`);
  const m2 = localSql(`SELECT public.upsert_match_safe('lpmulti-2-${suffix}','premier_2025',1,'league',${q(away + " B")},${q(home + " B")},NULL,NULL,now()+interval '3 days 3 hours',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);`);
  const pollaName = `Ofigolazo ${suffix}`, slug = `ofigolazo-${suffix}`;
  const pollaId = localSql(`BEGIN; SELECT public.casa_v2_context(2);
    INSERT INTO public.casa_pollas(slug,name,kind,tournament,scoring_mode,status,closes_at,created_by,entry_price_cop,house_cut_pct,
      payout_method,payout_account,payout_account_name,max_entries_per_user,publication_mode,opens_at)
    VALUES(${q(slug)},${q(pollaName)},'partidos','premier_2025','marcador','abierta',now()+interval '2 days',${q(admin.id)},20000,30,
      'Nequi','3000000000','Cuenta ficticia local',5,'ahora',now()-interval '1 minute') RETURNING id;
    INSERT INTO public.casa_polla_matches(polla_id,match_id,order_index) SELECT id,${q(m1)}::uuid,0 FROM public.casa_pollas WHERE slug=${q(slug)};
    INSERT INTO public.casa_polla_matches(polla_id,match_id,order_index) SELECT id,${q(m2)}::uuid,1 FROM public.casa_pollas WHERE slug=${q(slug)};
    COMMIT;`).split("\n").find(line => /^[0-9a-f-]{36}$/.test(line.trim()))?.trim();
  assert.ok(pollaId, "fixture polla not created");
  const page = ana.page;

  // ── 1) Entrar eligiendo cuántos cupos: 2 cupos = 2 comprobantes.
  await page.goto(`${origin}/casa/${slug}`, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: /^Entrar por \$\s?20\.000$/ }).click();
  await page.waitForURL(`**/casa/${slug}/pagar`);
  await hydrated(page);
  const selector = page.getByLabel("¿Cuántos cupos quieres en esta polla?", { exact: true });
  assert.equal(await selector.inputValue(), "1");
  assert.equal(await selector.locator("option").count(), 5, "max 5 cupos in the dropdown");
  await selector.selectOption("2");
  await page.getByText("Una transferencia por cupo", { exact: true }).waitFor();
  await page.getByText(/Cada cupo debe tener su propia transferencia de \$\s?20\.000 — 2 transferencias separadas, no una de \$\s?40\.000/).waitFor();
  assert.equal(await page.locator("input[type=file]").count(), 2, "one proof picker per cupo");
  await page.getByText("Comprobante del cupo 2 de 2", { exact: true }).waitFor();
  await screen(page, "pagar-dos-cupos");
  await zoom(page, "pagar-dos-cupos");
  await sendProof(page, "COMPROBANTE UNO", 0);
  await page.getByText("Comprobante 1 de 2 enviado", { exact: true }).waitFor({ timeout: 60000 });
  assert.equal(await selector.isDisabled(), true, "the count is fixed after the first proof");
  await sendProof(page, "COMPROBANTE DOS", 0);
  await page.getByText("Comprobante 2 de 2 enviado", { exact: true }).waitFor({ timeout: 60000 });
  await screen(page, "pagar-dos-cupos-enviados");
  await page.getByRole("link", { name: "Ver mis cupos y pronosticar" }).click();
  await page.waitForURL(`**/casa/${slug}?p=1`, { timeout: 60000 });
  await page.getByRole("heading", { name: "Tus cupos" }).waitFor();
  await hydrated(page);
  const cupoSelect = page.getByLabel("Elige el cupo para ver o editar sus pronósticos", { exact: true });
  assert.deepEqual(await cupoSelect.locator("option").allInnerTexts(), ["Cupo 1 · En revisión · faltan 2", "Cupo 2 · En revisión · faltan 2"]);
  await page.getByText("Te faltan 2 pronósticos", { exact: true }).waitFor();
  assert.equal(await page.getByText("Pago en revisión", { exact: true }).count(), 1, "the status is not repeated in a separate box");
  await page.getByText(/Puedes pronosticar y guardar aunque el pago esté en revisión/).waitFor();
  await page.getByLabel(`Goles de ${home}`, { exact: true }).fill("2");
  await page.getByLabel(`Goles de ${away}`, { exact: true }).fill("1");
  await page.getByRole("button", { name: /^Guardar/ }).click();
  await page.getByText(/^Guardado \d+ de \d+/).waitFor();
  await page.reload({ waitUntil: "networkidle" });
  await hydrated(page);
  await page.getByText("También te faltan pronósticos en el cupo #2.", { exact: true }).waitFor();
  await chooseCupo(page, slug, 2);
  assert.equal(await page.getByLabel(`Goles de ${home}`, { exact: true }).inputValue(), "", "cupo #2 starts with its own empty picks");
  await page.getByLabel(`Goles de ${home}`, { exact: true }).fill("0");
  await page.getByLabel(`Goles de ${away}`, { exact: true }).fill("0");
  await page.getByRole("button", { name: /^Guardar/ }).click();
  await page.getByText(/^Guardado \d+ de \d+/).waitFor();
  await chooseCupo(page, slug, 1);
  assert.equal(await page.getByLabel(`Goles de ${home}`, { exact: true }).inputValue(), "2", "switching back shows #1 picks");
  await screen(page, "polla-dos-cupos");
  await zoom(page, "polla-dos-cupos");
  const picks = await localDb.from("casa_picks").select("home_score, away_score, casa_entries!inner(entry_number)").eq("polla_id", pollaId).eq("user_id", ana.id);
  assert.ifError(picks.error);
  assert.deepEqual(picks.data.map(p => [p.casa_entries.entry_number, p.home_score, p.away_score]).sort(), [[1, 2, 1], [2, 0, 0]]);
  console.log("PASS entering with 2 cupos: dropdown, yellow notice, one proof per cupo, separate picks per cupo");

  // ── 2) Ya inscrito: el botón principal es "Comprar otro cupo".
  await page.getByRole("link", { name: /^Comprar otro cupo · \$\s?20\.000$/ }).click();
  await page.waitForURL(`**/casa/${slug}/pagar?participacion=nueva`);
  await hydrated(page);
  const more = page.getByLabel("¿Cuántos cupos más quieres?", { exact: true });
  assert.equal(await more.locator("option").count(), 3, "5 max − 2 owned = 3 more");
  await screen(page, "pagar-otro-cupo");
  // The same receipt cannot back another cupo.
  await sendProof(page, "COMPROBANTE UNO", 0);
  await page.getByText(/Ese comprobante ya lo enviaste para el cupo 1/).waitFor({ timeout: 60000 });
  const count = await localDb.from("casa_entries").select("id", { count: "exact", head: true }).eq("polla_id", pollaId).eq("user_id", ana.id).neq("status", "anulada");
  assert.equal(count.count, 2, "a duplicate receipt must not create a cupo");
  await sendProof(page, "COMPROBANTE TRES", 0);
  await page.getByText("Comprobante 1 de 1 enviado", { exact: true }).waitFor({ timeout: 60000 });
  await page.getByText("Quedó como tu cupo #3.", { exact: false }).waitFor();
  console.log("PASS Comprar otro cupo from the pool; duplicate receipt rejected; third cupo registered");

  // ── 3) El administrador aprueba comprobante por comprobante.
  const apage = admin.page;
  const approve = (n) => apage.getByRole("button", { name: `Aprobar el pago de Ana Cupos, cupo ${n}`, exact: true });
  await apage.goto(`${origin}/admin/pollas/recibos?pollaId=${pollaId}`, { waitUntil: "networkidle" });
  for (const n of [1, 2, 3]) await approve(n).waitFor();
  await screen(apage, "admin-recibos-cupos");
  await hydrated(apage);
  await approve(1).click();
  await approve(1).waitFor({ state: "detached" });
  await approve(2).waitFor();

  await page.goto(`${origin}/casa/${slug}?p=1`, { waitUntil: "networkidle" });
  await hydrated(page);
  await page.getByText("Pagado", { exact: true }).waitFor();
  assert.deepEqual((await page.getByLabel("Elige el cupo para ver o editar sus pronósticos", { exact: true }).locator("option").allInnerTexts()).map(t => t.split(" · ").slice(0, 2).join(" · ")),
    ["Cupo 1 · Pagado", "Cupo 2 · En revisión", "Cupo 3 · En revisión"]);
  await page.getByRole("tab", { name: "Tabla" }).click();
  const table = page.locator("table tbody tr");
  await table.first().waitFor();
  assert.equal(await table.count(), 1, "only the approved cupo is in the table");
  console.log("PASS approving #1 activates only #1; the others stay in review and out of the table");

  await apage.reload({ waitUntil: "networkidle" });
  await hydrated(apage);
  await approve(2).click();
  await approve(2).waitFor({ state: "detached" });
  await page.goto(`${origin}/casa/${slug}?p=2`, { waitUntil: "networkidle" });
  await hydrated(page);
  await page.getByRole("tab", { name: "Tabla" }).click();
  await page.waitForFunction(() => document.querySelectorAll("table tbody tr").length === 2);
  const rows = await page.locator("table tbody tr").allInnerTexts();
  assert.ok(rows.some(r => r.includes("#1")) && rows.some(r => r.includes("#2")), `table must number both cupos: ${JSON.stringify(rows)}`);
  await screen(page, "tabla-cupos");
  console.log("PASS two approved: two table rows, #1 and #2");

  // ── 4) Mis pollas: una tarjeta por polla con desplegable de cupo.
  await page.goto(`${origin}/casa`, { waitUntil: "networkidle" });
  await hydrated(page);
  const mine = page.locator("#mis-pollas");
  if (!(await mine.evaluate(el => el.open))) await mine.locator("summary").click();
  const card = mine.locator("li").filter({ hasText: pollaName });
  await card.first().waitFor();
  assert.equal(await card.count(), 1, "one card per polla");
  const inner = card.getByLabel("Cupo", { exact: true });
  assert.equal(await inner.locator("option").count(), 3);
  await card.getByText("Pagado", { exact: true }).waitFor();
  await card.getByText(/También faltan pronósticos en los cupos #2, #3/).waitFor();
  await inner.selectOption("3");
  await card.getByText("Pago en revisión", { exact: true }).waitFor();
  await card.getByText("Te faltan 2 pronósticos", { exact: true }).waitFor();
  assert.equal(await card.getByRole("link", { name: "Abrir cupo 3" }).getAttribute("href"), `/casa/${slug}?p=3`);
  await mine.scrollIntoViewIfNeeded();
  await screen(page, "mis-pollas-cupos");
  await zoom(page, "mis-pollas-cupos");
  console.log("PASS Mis pollas: one Ofigolazo card, cupo dropdown, green/amber payment, red missing predictions");
  console.log(`Captures: ${output}`);
} catch (error) {
  for (const [index, openPage] of opened.entries()) await openPage.screenshot({ path: `${output}/FALLO-${index}.png`, fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
