// Reproducible local browser regression. All actors/data are fresh Docker fixtures.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { createLocalBrowserActor, localDb, localSql, sqlQuote as q } from "./casa-local-browser-helpers.mjs";

const origin = process.env.CASA_ORIGIN ?? "http://localhost:3191";
const output = "C:/Users/STZTR/Downloads/la-polla-mejoras-2026-09-13/info";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const evidence = [];
let currentPage;
try {
  const admin = await createLocalBrowserActor(browser, { name: "Admin Info local", admin: true });
  const player = await createLocalBrowserActor(browser, { name: "Participante Info local" });
  const other = await createLocalBrowserActor(browser, { name: "Jugador de nombre largo para comprobar el recorrido en móvil" });
  const [matchA, matchB] = await Promise.all([0, 1].map(async index => {
    const key = randomUUID();
    const result = await localDb.rpc("upsert_match_safe", { p_external_id: `info-${key}`, p_tournament: "local_info_test", p_match_day: index + 1,
      p_phase: "league", p_home_team: index ? "Arsenal" : "Millonarios", p_away_team: index ? "Chelsea" : "América de Cali",
      p_home_team_flag: null, p_away_team_flag: null, p_scheduled_at: new Date(Date.now() + (index + 2) * 3_600_000).toISOString(),
      p_venue: null, p_home_score: null, p_away_score: null, p_status: "scheduled", p_elapsed: null, p_home_team_abbr: null, p_away_team_abbr: null });
    assert.ifError(result.error); return result.data;
  }));
  const pool = randomUUID(), slug = `info-${pool}`, pool1x2 = randomUUID(), slug1x2 = `info-${pool1x2}`;
  localSql(`BEGIN; SELECT casa_v2_context(2);
    INSERT INTO casa_pollas(id,slug,name,kind,tournament,scoring_mode,status,closes_at,created_by,entry_price_cop,house_cut_pct,pot_mode,fixed_prize_cop,payout_method,payout_account,points_exact,points_one_team,points_result)
    VALUES(${q(pool)},${q(slug)},'Info y premio fijo local','partidos','local_info_test','marcador','abierta',clock_timestamp()+interval '1 hour',${q(admin.id)},10000,0,'fijo',1000000,'Nequi','CUENTA LOCAL',7,2,5),
      (${q(pool1x2)},${q(slug1x2)},'Info 1X2 local','partidos','local_info_test','1x2','abierta',clock_timestamp()+interval '1 hour',${q(admin.id)},10000,30,'proporcional',NULL,'Nequi','CUENTA LOCAL',7,2,5);
    INSERT INTO casa_polla_matches(polla_id,match_id) VALUES(${q(pool)},${q(matchA)}),(${q(pool)},${q(matchB)}),(${q(pool1x2)},${q(matchA)});
    INSERT INTO casa_entries(polla_id,user_id,status,amount_cop) VALUES(${q(pool)},${q(player.id)},'pagada',10000),(${q(pool)},${q(other.id)},'pagada',10000);
    INSERT INTO casa_picks(polla_id,entry_id,user_id,match_id,home_score,away_score)
      SELECT polla_id,id,user_id,${q(matchA)},9,8 FROM casa_entries WHERE polla_id=${q(pool)} AND user_id=${q(other.id)};
    SELECT casa_change_status_v2(${q(pool)},'cerrar',2,${q(admin.id)},NULL); COMMIT;`);

  const page = player.page;
  currentPage = page;
  async function showInfo() {
    // Concurrent dev compilation can refresh a page between click/hydration.
    // Retrying tab selection is harmless; account writes below are never retried.
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.getByRole("tab", { name: "Info", exact: true }).click();
      try { await page.getByRole("heading", { name: "Info de esta polla" }).waitFor({ timeout: 5000 }); return; } catch (error) { if (attempt === 2) throw error; }
    }
  }
  await page.goto(`${origin}/casa/${slug}`, { waitUntil: "networkidle" });
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await showInfo();
    await page.evaluate(() => document.fonts.ready);
    assert.ok(await page.getByText("Marcador exacto: 7 puntos.", { exact: true }).isVisible());
    assert.ok(await page.getByText("Goles de un solo equipo: 2 puntos.", { exact: true }).isVisible());
    assert.equal(await page.getByText("Acertar el resultado:", { exact: false }).count(), 0);
    assert.ok(await page.getByText("Pozo fijo", { exact: true }).isVisible());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: `${output}/info-${width}.png`, fullPage: true });
    evidence.push({ width, font: await page.getByRole("heading", { name: "Info de esta polla" }).evaluate(el => { const s = getComputedStyle(el); return { family: s.fontFamily, size: s.fontSize, weight: s.fontWeight, line: s.lineHeight }; }) });
  }

  // A real PUT works after inscription closure while the next game remains open.
  const save = await page.request.put(`${origin}/api/casa/pollas/${slug}/picks`, { data: { picks: [{ matchId: matchB, homeScore: 2, awayScore: 1 }] } });
  assert.equal(save.status(), 200, await save.text());
  const denied = await page.request.get(`${origin}/api/casa/pollas/${slug}/match-picks?match=${matchA}`);
  assert.equal(denied.status(), 409); assert.match(denied.headers()["cache-control"], /no-store/);
  await page.getByRole("tab", { name: "Partidos", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Ver pronósticos de otros", exact: true }).count(), 0);
  assert.equal(await page.getByText("9-8", { exact: false }).count(), 0);
  localSql(`UPDATE matches SET scheduled_at=clock_timestamp()-interval '10 minutes',status='live',elapsed=10,live_status_detail='STATUS_FIRST_HALF' WHERE id=${q(matchA)};`);
  await page.reload({ waitUntil: "networkidle" });
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByRole("button", { name: "Ver pronósticos de otros", exact: true }).click();
    try { await page.getByText("9 – 8", { exact: true }).waitFor({ timeout: 5000 }); break; } catch (error) { if (attempt === 2) throw error; }
  }
  assert.ok(await page.getByText("9 – 8", { exact: true }).isVisible());
  await page.screenshot({ path: `${output}/pronosticos-iniciados.png`, fullPage: true });
  await page.getByRole("button", { name: "Ocultar pronósticos de otros", exact: true }).click();
  await page.route("**/match-picks?*", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ rows: [], hasMore: false, page: 0 }) }));
  await page.getByRole("button", { name: "Ver pronósticos de otros", exact: true }).click();
  await page.getByText("Todavía no hay pronósticos de participantes con pago aprobado.").waitFor();
  await page.screenshot({ path: `${output}/pronosticos-vacio.png`, fullPage: true });
  await page.unroute("**/match-picks?*");

  await showInfo();
  await page.setViewportSize({ width: 320, height: 1000 });
  let releaseAccountLoad;
  const accountLoad = new Promise(resolve => { releaseAccountLoad = resolve; });
  await page.route("**/api/users/me", async route => { await accountLoad; await route.continue(); });
  await page.getByRole("button", { name: "Llenar o revisar mi cuenta de pago" }).click();
  const dialog = page.getByRole("dialog", { name: "Tu cuenta de pago" });
  await dialog.getByText("Cargando tu cuenta de pago").waitFor({ state: "attached" });
  await page.screenshot({ path: `${output}/cuenta-cargando-320.png` });
  releaseAccountLoad();
  await dialog.getByLabel("Número de celular", { exact: true }).fill("3001234567");
  await page.unroute("**/api/users/me");
  await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
  await dialog.getByText("Tu cuenta de pago quedó guardada.").waitFor();
  let profile = await (await page.request.get(`${origin}/api/users/me`)).json();
  assert.equal(profile.profile.default_payout_account, "3001234567");
  assert.equal(profile.profile.default_payout_method, "nequi");
  await page.screenshot({ path: `${output}/cuenta-nequi-320.png` });
  await dialog.getByRole("button", { name: "Editar cuenta", exact: true }).click();
  await dialog.getByRole("button", { name: "Bancolombia", exact: true }).click();
  await dialog.getByLabel("Número de cuenta", { exact: true }).fill("12345678901");
  await dialog.getByRole("button", { name: "Ahorros", exact: true }).click();
  await dialog.getByLabel("Nombre como aparece en la cuenta", { exact: true }).fill("Participante Info local");
  await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
  await dialog.getByRole("button", { name: "Editar cuenta", exact: true }).waitFor();
  profile = await (await page.request.get(`${origin}/api/users/me`)).json();
  assert.equal(profile.profile.default_payout_account, "12345678901");
  assert.equal(profile.profile.default_payout_method, "bancolombia");
  assert.equal(profile.profile.default_payout_account_type, "ahorros");
  const otherProfile = await (await other.page.request.get(`${origin}/api/users/me`)).json();
  assert.equal(otherProfile.profile.default_payout_account, null);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.ok(await page.getByRole("button", { name: "Llenar o revisar mi cuenta de pago" }).evaluate(el => el === document.activeElement));
  await page.route("**/api/users/me", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Fallo simulado local" }) }));
  await page.getByRole("button", { name: "Llenar o revisar mi cuenta de pago" }).click();
  await dialog.getByText("No se pudo cargar tu cuenta de pago.").waitFor();
  await page.screenshot({ path: `${output}/cuenta-error-320.png` });
  await page.unroute("**/api/users/me");
  await dialog.getByRole("button", { name: "Reintentar" }).click();
  await dialog.getByRole("button", { name: "Editar cuenta", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });

  // Two-pass text zoom catches fixed-width controls that swallow boosted text.
  await page.evaluate(() => { const all = [...document.querySelectorAll("body *")].map(el => [el, parseFloat(getComputedStyle(el).fontSize)]); for (const [el, size] of all) el.style.fontSize = `${size * 2}px`; });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: `${output}/info-320-text200.png`, fullPage: true });
  await page.getByRole("button", { name: "Llenar o revisar mi cuenta de pago" }).click();
  await dialog.getByRole("button", { name: "Editar cuenta", exact: true }).click();
  await dialog.evaluate(root => { const all = [...root.querySelectorAll("*")].map(el => [el, parseFloat(getComputedStyle(el).fontSize)]); for (const [el, size] of all) el.style.fontSize = `${size * 2}px`; });
  assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  await page.screenshot({ path: `${output}/cuenta-320-text200.png` });

  await page.goto(`${origin}/casa/${slug1x2}`, { waitUntil: "domcontentloaded" });
  await showInfo();
  assert.ok(await page.getByText("Acertar el resultado: 5 puntos.", { exact: true }).isVisible());
  assert.equal(await page.getByText("Marcador exacto:", { exact: false }).count(), 0);
  await page.screenshot({ path: `${output}/info-1x2.png`, fullPage: true });
  const anon = await browser.newContext({ colorScheme: "dark" });
  const publicPage = await anon.newPage();
  await publicPage.goto(`${origin}/casa/${slug}`, { waitUntil: "domcontentloaded" });
  await publicPage.getByText("Pozo fijo", { exact: true }).waitFor();
  assert.ok(await publicPage.getByText("Pozo fijo", { exact: true }).isVisible());
  assert.equal(await publicPage.getByRole("tab", { name: "Info", exact: true }).count(), 0);
  const anonymousResponse = await publicPage.request.get(`${origin}/api/casa/pollas/${slug}/match-picks?match=${matchA}`, { maxRedirects: 0 });
  assert.ok([401, 307].includes(anonymousResponse.status()));
  if (anonymousResponse.status() === 307) assert.match(anonymousResponse.headers().location, /\/login/);
  await writeFile(`${output}/evidence.json`, JSON.stringify({ evidence, slug, slug1x2, checks: ["320/768/1440", "text zoom 200%", "Nequi save", "Bancolombia save", "Escape restores focus", "other account untouched", "started-only DOM and API", "fixed public hero", "separate scoring copy", "mock empty predictions", "controlled account loading", "mock account error and real retry"] }, null, 2));
  console.log("PASS Info, privacy, fixed prize, scoped account saves, three widths and text zoom 200%");
} catch (error) {
  if (currentPage) { await currentPage.screenshot({ path: `${output}/failure.png`, fullPage: true }); await writeFile(`${output}/failure.txt`, await currentPage.locator("body").innerText()); }
  throw error;
} finally { await browser.close(); }
