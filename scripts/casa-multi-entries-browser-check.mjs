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
async function sendProof(page, label) {
  await hydrated(page);
  const png = await page.evaluate((text) => { const c = document.createElement("canvas"); c.width = 520; c.height = 200; const x = c.getContext("2d"); x.fillStyle = "white"; x.fillRect(0, 0, 520, 200); x.fillStyle = "black"; x.font = "24px sans-serif"; x.fillText(text, 12, 100); return c.toDataURL("image/png").split(",")[1]; }, label);
  await page.locator("input[type=file]").setInputFiles({ name: `${label}.png`, mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await page.getByRole("button", { name: "Enviar el comprobante", exact: true }).click();
}

const opened = [];
try {
  const suffix = randomUUID().slice(0, 6);
  const admin = await createLocalBrowserActor(browser, { name: "Administrador multi local", admin: true, origin });
  const ana = await createLocalBrowserActor(browser, { name: "Ana Participaciones", origin });
  opened.push(admin.page, ana.page);
  for (const actor of [admin, ana]) { actor.page.setDefaultTimeout(45000); actor.page.setDefaultNavigationTimeout(120000); }

  // ── Fixture: a real match pool with two future matches, $20.000, up to 5 per person.
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

  // ── 1) Primera participación: el recorrido de siempre.
  await page.goto(`${origin}/casa/${slug}`, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: /^Entrar por \$\s?20\.000$/ }).click();
  await page.waitForURL(`**/casa/${slug}/pagar`);
  assert.equal(await page.getByText("Otra participación, otra transferencia").count(), 0, "first entry must not warn about another participation");
  await sendProof(page, "COMPROBANTE UNO");
  await page.getByText("Pago registrado", { exact: true }).waitFor({ timeout: 60000 });
  await page.waitForURL(`**/casa/${slug}?p=1`, { timeout: 60000 });
  await page.getByRole("heading", { name: "Tus participaciones" }).waitFor();
  await page.getByRole("link", { name: "Participación 1: En revisión" }).waitFor();
  await hydrated(page);
  await page.getByLabel(`Goles de ${home}`, { exact: true }).fill("2");
  await page.getByLabel(`Goles de ${away}`, { exact: true }).fill("1");
  await page.getByRole("button", { name: /^Guardar/ }).click();
  await page.getByText(/^Guardado \d+ de \d+/).waitFor();
  await screen(page, "polla-participacion-1");
  console.log("PASS first participation: proof, redirect to #1, own picks saved while in review");

  // ── 2) Sumar otra participación: su propia transferencia y su propio comprobante.
  await page.getByRole("link", { name: /Sumar otra participación por \$\s?20\.000/ }).click();
  await page.waitForURL(`**/casa/${slug}/pagar?participacion=nueva`);
  await page.getByText("Otra participación, otra transferencia").waitFor();
  await page.getByText("Participación 2", { exact: true }).waitFor();
  await screen(page, "pagar-otra-participacion");
  await zoom(page, "pagar-otra-participacion");
  await sendProof(page, "COMPROBANTE DOS");
  await page.getByText("Pago registrado", { exact: true }).waitFor({ timeout: 60000 });
  await page.waitForURL(`**/casa/${slug}?p=2`, { timeout: 60000 });
  await page.getByRole("link", { name: "Participación 2: En revisión" }).waitFor();
  await hydrated(page);
  assert.equal(await page.getByLabel(`Goles de ${home}`, { exact: true }).inputValue(), "", "participation #2 starts with its own empty picks");
  await page.getByLabel(`Goles de ${home}`, { exact: true }).fill("0");
  await page.getByLabel(`Goles de ${away}`, { exact: true }).fill("0");
  await page.getByRole("button", { name: /^Guardar/ }).click();
  await page.getByText(/^Guardado \d+ de \d+/).waitFor();
  await page.getByRole("link", { name: "Participación 1: En revisión" }).click();
  await page.waitForURL(`**/casa/${slug}?p=1`);
  await hydrated(page);
  assert.equal(await page.getByLabel(`Goles de ${home}`, { exact: true }).inputValue(), "2", "switching back shows #1 picks");
  await screen(page, "polla-dos-participaciones");
  await zoom(page, "polla-dos-participaciones");
  const picks = await localDb.from("casa_picks").select("home_score, away_score, casa_entries!inner(entry_number)").eq("polla_id", pollaId).eq("user_id", ana.id);
  assert.ifError(picks.error);
  assert.deepEqual(picks.data.map(p => [p.casa_entries.entry_number, p.home_score, p.away_score]).sort(), [[1, 2, 1], [2, 0, 0]]);
  console.log("PASS second participation: separate transfer screen, separate picks, switch between participations");

  // ── 3) El mismo comprobante no sirve para otra participación.
  await page.goto(`${origin}/casa/${slug}/pagar?participacion=nueva`, { waitUntil: "networkidle" });
  await sendProof(page, "COMPROBANTE UNO");
  await page.getByText(/Ese comprobante ya lo enviaste para la participación 1/).waitFor({ timeout: 60000 });
  const count = await localDb.from("casa_entries").select("id", { count: "exact", head: true }).eq("polla_id", pollaId).eq("user_id", ana.id).neq("status", "anulada");
  assert.equal(count.count, 2, "a duplicate receipt must not create a participation");
  console.log("PASS the same receipt cannot back a third participation");

  // ── 4) El administrador aprueba comprobante por comprobante.
  const apage = admin.page;
  await apage.goto(`${origin}/admin/pollas/recibos?pollaId=${pollaId}`, { waitUntil: "networkidle" });
  await apage.getByRole("button", { name: "Aprobar el pago de Ana Participaciones, participación 1", exact: true }).waitFor();
  await apage.getByRole("button", { name: "Aprobar el pago de Ana Participaciones, participación 2", exact: true }).waitFor();
  await screen(apage, "admin-recibos-participaciones");
  await hydrated(apage);
  await apage.getByRole("button", { name: "Aprobar el pago de Ana Participaciones, participación 1", exact: true }).click();
  await apage.getByRole("button", { name: "Aprobar el pago de Ana Participaciones, participación 1", exact: true }).waitFor({ state: "detached" });
  await apage.getByRole("button", { name: "Aprobar el pago de Ana Participaciones, participación 2", exact: true }).waitFor();

  await page.goto(`${origin}/casa/${slug}?p=1`, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Participación 1: Activa" }).waitFor();
  await page.getByRole("link", { name: "Participación 2: En revisión" }).waitFor();
  await hydrated(page);
  await page.getByRole("tab", { name: "Tabla" }).click();
  const table = page.locator("table tbody tr");
  await table.first().waitFor();
  assert.equal(await table.count(), 1, "only the approved participation is in the table");
  console.log("PASS approving #1 activates only #1; #2 stays in review and out of the table");

  await apage.reload({ waitUntil: "networkidle" });
  await hydrated(apage);
  await apage.getByRole("button", { name: "Aprobar el pago de Ana Participaciones, participación 2", exact: true }).click();
  await apage.getByRole("button", { name: "Aprobar el pago de Ana Participaciones, participación 2", exact: true }).waitFor({ state: "detached" });
  await page.goto(`${origin}/casa/${slug}?p=2`, { waitUntil: "networkidle" });
  await hydrated(page);
  await page.getByRole("tab", { name: "Tabla" }).click();
  await page.waitForFunction(() => document.querySelectorAll("table tbody tr").length === 2);
  const rows = await page.locator("table tbody tr").allInnerTexts();
  assert.ok(rows.some(r => r.includes("#1")) && rows.some(r => r.includes("#2")), `table must number both participations: ${JSON.stringify(rows)}`);
  await screen(page, "tabla-participaciones");
  console.log("PASS both approved: two table rows, #1 and #2");

  // ── 5) Mis pollas: una tarjeta por participación.
  await page.goto(`${origin}/casa`, { waitUntil: "networkidle" });
  await hydrated(page);
  const mine = page.locator("#mis-pollas");
  if (!(await mine.evaluate(el => el.open))) await mine.locator("summary").click();
  const cards = mine.getByRole("link").filter({ hasText: pollaName });
  await cards.first().waitFor();
  assert.equal(await cards.count(), 2, "one card per participation");
  assert.equal(await cards.filter({ hasText: "Participación 1" }).getAttribute("href"), `/casa/${slug}?p=1`);
  assert.equal(await cards.filter({ hasText: "Participación 2" }).getAttribute("href"), `/casa/${slug}?p=2`);
  await mine.scrollIntoViewIfNeeded();
  await screen(page, "mis-pollas-participaciones");
  console.log("PASS Mis pollas lists Ofigolazo · Participación 1 and · Participación 2 with deep links");
  console.log(`Captures: ${output}`);
} catch (error) {
  for (const [index, openPage] of opened.entries()) await openPage.screenshot({ path: `${output}/FALLO-${index}.png`, fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
