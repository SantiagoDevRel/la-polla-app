// scripts/casa-live-payouts-browser-check.mjs — recorrido en navegador de lo
// pedido el 2026-09-16: «En vivo» en /casa, tarjetas compactas por partido con
// secciones y desplegable de pronósticos, premio provisional en la Tabla,
// regla «solo marcador exacto» en Info y prueba de pago a los ganadores.
//
// SOLO contra el Supabase LOCAL de Docker y un dev server local:
//   node scripts/casa-v2-local-env.mjs dev 3191
//   node scripts/casa-live-payouts-browser-check.mjs
// Crea sus fixtures (slugs `e2e-vivo-%`, partidos `e2e-vivo:%`, gente
// +5730000009xx) y las borra al empezar. Capturas en Downloads.

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import path from "node:path";
import { createLocalBrowserActor, localSql, sqlQuote } from "./casa-local-browser-helpers.mjs";

const origin = process.env.CASA_ORIGIN ?? "http://localhost:3191";
const shots = process.env.CASA_SHOTS ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", "Downloads", "la-polla-casa-vivo-shots");
mkdirSync(shots, { recursive: true });
const report = { steps: [], failures: [] };
const ok = (name, condition, detail = "") => {
  report.steps.push({ name, ok: Boolean(condition), detail });
  if (!condition) report.failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${condition ? "OK " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

/** PNG sólido (sin dependencias) para subir como comprobante. */
function solidPng(width, height, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = (buf) => { let c = 0xffffffff; for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body)); return Buffer.concat([len, body, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const row = Buffer.alloc(1 + width * 3); for (let x = 0; x < width; x++) { row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b; }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const U = (n) => `e2e0e2e0-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const M = (n) => `e2e0e2e0-2222-4222-8222-0000000000${String(n).padStart(2, "0")}`;
const P1 = "e2e0e2e0-3333-4333-8333-000000000001";
const P2 = "e2e0e2e0-3333-4333-8333-000000000002";
const P3 = "e2e0e2e0-3333-4333-8333-000000000003";
const E = (n) => `e2e0e2e0-4444-4444-8444-0000000000${String(n).padStart(2, "0")}`;

function fixtures(jugadorId, adminId) {
  const fakes = Array.from({ length: 25 }, (_, i) => i + 1);
  const scores = ["2-0", "2-1", "1-0", "2-0", "0-0"]; // varias personas ponen 2-0 exacto en m1
  const lines = [
    "SELECT public.casa_transition_mode((SELECT mode FROM public.casa_operation_control), 'v2');",
    "SELECT set_config('app.casa_contract','2',false);",
    "DELETE FROM public.casa_payouts WHERE polla_id IN (SELECT id FROM public.casa_pollas WHERE slug LIKE 'e2e-vivo-%');",
    "DELETE FROM public.casa_picks WHERE polla_id IN (SELECT id FROM public.casa_pollas WHERE slug LIKE 'e2e-vivo-%');",
    "DELETE FROM public.casa_entries WHERE polla_id IN (SELECT id FROM public.casa_pollas WHERE slug LIKE 'e2e-vivo-%');",
    "DELETE FROM public.casa_polla_matches WHERE polla_id IN (SELECT id FROM public.casa_pollas WHERE slug LIKE 'e2e-vivo-%');",
    "DELETE FROM public.casa_match_issues WHERE match_id IN (SELECT id FROM public.matches WHERE external_id LIKE 'e2e-vivo:%');",
    "DELETE FROM public.casa_pollas WHERE slug LIKE 'e2e-vivo-%';",
    "DELETE FROM public.matches WHERE external_id LIKE 'e2e-vivo:%';",
    "DELETE FROM public.users WHERE whatsapp_number LIKE '+5730000009%';",
    `UPDATE public.users SET default_payout_method='nequi', default_payout_account='3001234567', default_payout_account_name='Jugador E2E' WHERE id=${sqlQuote(jugadorId)};`,
    ...fakes.map((n) => `INSERT INTO public.users(id, whatsapp_number, display_name, avatar_url, is_admin) VALUES(${sqlQuote(U(n))}, '+57300000090${String(n).padStart(2, "0")}', 'Jugador ${n}', 'junior', false);`),
    // Partidos: los cinco nacen programados a futuro (el guard de pronósticos
    // exige eso); después de guardar los picks, dos pasan a finalizados y
    // verificados, uno a en vivo, y dos quedan próximos (hoy y mañana).
    `INSERT INTO public.matches(id, external_id, tournament, home_team, away_team, scheduled_at, status) VALUES
      (${sqlQuote(M(1))}, 'e2e-vivo:1', 'premier_2025', 'Manchester City', 'Arsenal', now() + interval '1 day', 'scheduled'),
      (${sqlQuote(M(2))}, 'e2e-vivo:2', 'premier_2025', 'Liverpool', 'Chelsea', now() + interval '1 day', 'scheduled'),
      (${sqlQuote(M(3))}, 'e2e-vivo:3', 'premier_2025', 'Tottenham Hotspur', 'Newcastle United', now() + interval '1 day', 'scheduled'),
      (${sqlQuote(M(4))}, 'e2e-vivo:4', 'premier_2025', 'Aston Villa', 'Everton', now() + interval '3 hours', 'scheduled'),
      (${sqlQuote(M(5))}, 'e2e-vivo:5', 'premier_2025', 'Brighton & Hove Albion', 'Wolverhampton Wanderers', now() + interval '27 hours', 'scheduled'),
      (${sqlQuote(M(6))}, 'e2e-vivo:6', 'premier_2025', 'Real Madrid', 'FC Barcelona', now() + interval '1 day', 'scheduled'),
      (${sqlQuote(M(7))}, 'e2e-vivo:7', 'premier_2025', 'Sevilla', 'Valencia', now() + interval '1 day', 'scheduled'),
      (${sqlQuote(M(8))}, 'e2e-vivo:8', 'premier_2025', 'Napoli', 'AS Roma', now() + interval '1 day', 'scheduled'),
      (${sqlQuote(M(9))}, 'e2e-vivo:9', 'premier_2025', 'Juventus', 'Inter', now() + interval '1 day', 'scheduled');`,
    // P1: marcador exacto (3/3/0), abierta.
    `INSERT INTO public.casa_pollas(id, slug, name, kind, tournament, scoring_mode, entry_price_cop, house_cut_pct, status, closes_at, created_by, payout_method, payout_account, payout_account_name, points_exact, points_one_team, points_result)
      VALUES(${sqlQuote(P1)}, 'e2e-vivo-marcador', 'Polla E2E marcador', 'partidos', 'premier_2025', 'marcador', 10000, 30, 'abierta', now() + interval '3 hours', ${sqlQuote(adminId)}, 'Nequi', '3000000000', 'La Casa', 3, 0, 3);`,
    ...[1, 2, 3, 4, 5, 6, 9].map((n, i) => `INSERT INTO public.casa_polla_matches(polla_id, match_id, order_index) VALUES(${sqlQuote(P1)}, ${sqlQuote(M(n))}, ${i});`),
    `INSERT INTO public.casa_entries(id, polla_id, user_id, status, amount_cop, entry_number) VALUES(${sqlQuote(E(0))}, ${sqlQuote(P1)}, ${sqlQuote(jugadorId)}, 'pagada', 10000, 1);`,
    ...fakes.map((n) => `INSERT INTO public.casa_entries(id, polla_id, user_id, status, amount_cop, entry_number) VALUES(${sqlQuote(E(n))}, ${sqlQuote(P1)}, ${sqlQuote(U(n))}, 'pagada', 10000, 1);`),
    `INSERT INTO public.casa_picks(entry_id, polla_id, user_id, match_id, home_score, away_score) VALUES
      (${sqlQuote(E(0))}, ${sqlQuote(P1)}, ${sqlQuote(jugadorId)}, ${sqlQuote(M(1))}, 2, 0),
      (${sqlQuote(E(0))}, ${sqlQuote(P1)}, ${sqlQuote(jugadorId)}, ${sqlQuote(M(2))}, 2, 1),
      (${sqlQuote(E(0))}, ${sqlQuote(P1)}, ${sqlQuote(jugadorId)}, ${sqlQuote(M(3))}, 1, 0),
      (${sqlQuote(E(0))}, ${sqlQuote(P1)}, ${sqlQuote(jugadorId)}, ${sqlQuote(M(4))}, 1, 1),
      (${sqlQuote(E(0))}, ${sqlQuote(P1)}, ${sqlQuote(jugadorId)}, ${sqlQuote(M(6))}, 2, 2),
      (${sqlQuote(E(0))}, ${sqlQuote(P1)}, ${sqlQuote(jugadorId)}, ${sqlQuote(M(9))}, 0, 0);`,
    ...fakes.map((n) => { const [h, a] = scores[n % scores.length].split("-"); return `INSERT INTO public.casa_picks(entry_id, polla_id, user_id, match_id, home_score, away_score) VALUES(${sqlQuote(E(n))}, ${sqlQuote(P1)}, ${sqlQuote(U(n))}, ${sqlQuote(M(1))}, ${h}, ${a}), (${sqlQuote(E(n))}, ${sqlQuote(P1)}, ${sqlQuote(U(n))}, ${sqlQuote(M(3))}, ${n % 2}, 0);`; }),
    // P2: 1X2 resuelta con empate entre el jugador y Jugador 1 → dos premios.
    `INSERT INTO public.casa_pollas(id, slug, name, kind, tournament, scoring_mode, entry_price_cop, house_cut_pct, status, closes_at, created_by, payout_method, payout_account, payout_account_name)
      VALUES(${sqlQuote(P2)}, 'e2e-vivo-resuelta', 'Polla E2E resuelta', 'partidos', 'premier_2025', '1x2', 10000, 30, 'abierta', now() + interval '1 hour', ${sqlQuote(adminId)}, 'Nequi', '3000000000', 'La Casa');`,
    `INSERT INTO public.casa_polla_matches(polla_id, match_id, order_index) VALUES(${sqlQuote(P2)}, ${sqlQuote(M(1))}, 0);`,
    `INSERT INTO public.casa_entries(id, polla_id, user_id, status, amount_cop, entry_number) VALUES(${sqlQuote(E(90))}, ${sqlQuote(P2)}, ${sqlQuote(jugadorId)}, 'pagada', 10000, 1), (${sqlQuote(E(91))}, ${sqlQuote(P2)}, ${sqlQuote(U(1))}, 'pagada', 10000, 1);`,
    `INSERT INTO public.casa_picks(entry_id, polla_id, user_id, match_id, pick_1x2) VALUES(${sqlQuote(E(90))}, ${sqlQuote(P2)}, ${sqlQuote(jugadorId)}, ${sqlQuote(M(1))}, 'L'), (${sqlQuote(E(91))}, ${sqlQuote(P2)}, ${sqlQuote(U(1))}, ${sqlQuote(M(1))}, 'L');`,
    // P3: marcador, todos los partidos verificados y cierre vencido → lista para repartir.
    // El jugador acierta el 1-0 de M7 y Jugador 2 el 2-1 de M8: empate a 3, pozo 14.000.
    `INSERT INTO public.casa_pollas(id, slug, name, kind, tournament, scoring_mode, entry_price_cop, house_cut_pct, status, closes_at, created_by, payout_method, payout_account, payout_account_name, points_exact, points_one_team, points_result)
      VALUES(${sqlQuote(P3)}, 'e2e-vivo-lista', 'Polla E2E lista', 'partidos', 'premier_2025', 'marcador', 10000, 30, 'abierta', now() + interval '2 hours', ${sqlQuote(adminId)}, 'Nequi', '3000000000', 'La Casa', 3, 0, 3);`,
    `INSERT INTO public.casa_polla_matches(polla_id, match_id, order_index) VALUES(${sqlQuote(P3)}, ${sqlQuote(M(7))}, 0), (${sqlQuote(P3)}, ${sqlQuote(M(8))}, 1);`,
    `INSERT INTO public.casa_entries(id, polla_id, user_id, status, amount_cop, entry_number) VALUES(${sqlQuote(E(92))}, ${sqlQuote(P3)}, ${sqlQuote(jugadorId)}, 'pagada', 10000, 1), (${sqlQuote(E(93))}, ${sqlQuote(P3)}, ${sqlQuote(U(2))}, 'pagada', 10000, 1);`,
    `INSERT INTO public.casa_picks(entry_id, polla_id, user_id, match_id, home_score, away_score) VALUES(${sqlQuote(E(92))}, ${sqlQuote(P3)}, ${sqlQuote(jugadorId)}, ${sqlQuote(M(7))}, 1, 0), (${sqlQuote(E(93))}, ${sqlQuote(P3)}, ${sqlQuote(U(2))}, ${sqlQuote(M(8))}, 2, 1);`,
    // Ahora sí: se juegan. Dos verificados a 90', uno en vivo al minuto 34.
    `UPDATE public.matches SET scheduled_at = now() - interval '30 hours', status = 'finished', home_score = 2, away_score = 0, final_verified_at = now() - interval '28 hours', elapsed = 90, live_status_detail = 'STATUS_FULL_TIME' WHERE external_id = 'e2e-vivo:1';`,
    `UPDATE public.matches SET scheduled_at = now() - interval '28 hours', status = 'finished', home_score = 1, away_score = 1, final_verified_at = now() - interval '26 hours', elapsed = 90, live_status_detail = 'STATUS_FULL_TIME' WHERE external_id = 'e2e-vivo:2';`,
    `UPDATE public.matches SET scheduled_at = now() - interval '35 minutes', status = 'live', home_score = 1, away_score = 0, elapsed = 34, live_status_detail = 'STATUS_FIRST_HALF' WHERE external_id = 'e2e-vivo:3';`,
    `UPDATE public.matches SET scheduled_at = now() - interval '75 minutes', status = 'live', home_score = 2, away_score = 2, elapsed = 61, live_status_detail = 'STATUS_SECOND_HALF' WHERE external_id = 'e2e-vivo:6';`,
    // M9: pasó la hora de inicio y la fuente todavía no reporta nada.
    `UPDATE public.matches SET scheduled_at = now() - interval '40 minutes' WHERE external_id = 'e2e-vivo:9';`,
    `UPDATE public.matches SET scheduled_at = now() - interval '30 hours', status = 'finished', home_score = 1, away_score = 0, final_verified_at = now() - interval '28 hours', elapsed = 90 WHERE external_id = 'e2e-vivo:7';`,
    `UPDATE public.matches SET scheduled_at = now() - interval '29 hours', status = 'finished', home_score = 2, away_score = 1, final_verified_at = now() - interval '27 hours', elapsed = 90 WHERE external_id = 'e2e-vivo:8';`,
    `UPDATE public.casa_pollas SET closes_at = now() - interval '31 hours' WHERE id = ${sqlQuote(P3)};`,
    `SELECT public.casa_score_polla(${sqlQuote(P3)});`,
    `SELECT public.casa_score_polla(${sqlQuote(P1)});`,
    `UPDATE public.casa_pollas SET status = 'cerrada' WHERE id = ${sqlQuote(P2)};`,
    `SELECT public.casa_settle_polla_v2(${sqlQuote(P2)}, 2, ${sqlQuote(adminId)}, NULL);`,
    `SELECT count(*) FROM public.casa_payouts WHERE polla_id = ${sqlQuote(P2)};`,
  ];
  return localSql(lines.join("\n"));
}

async function shot(page, name, widths = [320, 390, 768]) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(shots, `${name}-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 900 });
}

async function noHorizontalOverflow(page, name) {
  const result = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  ok(`${name}: sin scroll horizontal`, result.scroll <= result.client + 1, `${result.scroll}/${result.client}`);
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const jugador = await createLocalBrowserActor(browser, { name: "Jugador E2E", origin });
  const admin = await createLocalBrowserActor(browser, { name: "Admin E2E", origin, admin: true });
  const payoutCount = fixtures(jugador.id, admin.id).split("\n").pop();
  ok("fixtures: polla resuelta con 2 premios", payoutCount === "2", payoutCount);

  // ── 1. /casa: En vivo arriba ────────────────────────────────────────────
  const page = jugador.page;
  await page.goto(`${origin}/casa`, { waitUntil: "networkidle" });
  await page.locator("[data-live-now]").waitFor({ timeout: 30_000 });
  // innerText respeta text-transform (las etiquetas van en mayúsculas): se compara sin caja.
  const casaText = (await page.locator("body").innerText()).toLowerCase();
  ok("/casa: franja En vivo con el partido y el pronóstico", /tu marcador:\s*1-0/.test(casaText) && casaText.includes("vivo · 34'"), "");
  ok("/casa: el partido sin datos dice «Esperando datos»", casaText.includes("esperando datos") && casaText.includes("juventus"), "");
  ok("/casa: el resumen cuenta solo los que están en juego", casaText.includes("2 en juego"), "");
  const strip = page.getByRole("list", { name: "Partidos en vivo de tus pollas" });
  const stripMetrics = await strip.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth, overflowX: getComputedStyle(el).overflowX, items: el.children.length }));
  ok("/casa: la franja se desliza de lado", stripMetrics.items === 3 && stripMetrics.scroll > stripMetrics.client && stripMetrics.overflowX === "auto", JSON.stringify(stripMetrics));
  const liveHeader = page.getByRole("button", { name: /En vivo/ });
  await liveHeader.click();
  ok("/casa: «En vivo» se pliega", (await liveHeader.getAttribute("aria-expanded")) === "false" && (await strip.count()) === 0);
  await liveHeader.click();
  const liveBox = await page.locator("[data-live-now]").boundingBox();
  const abiertasBox = await page.locator("#pollas-abiertas").boundingBox();
  ok("/casa: En vivo queda por encima de Pollas abiertas", liveBox && abiertasBox && liveBox.y < abiertasBox.y, `${liveBox?.y} < ${abiertasBox?.y}`);
  // «Pollas cerradas» arranca cerrada: se lee el contenido, no lo visible.
  const cerradasText = await page.locator("#pollas-cerradas").evaluate((el) => el.textContent ?? "");
  ok("/casa: la polla cerrada muestra el estado del pago", cerradasText.includes("Pago del premio en curso · 0 de 2"), "");
  await shot(page, "casa");
  await noHorizontalOverflow(page, "/casa 390");
  await page.setViewportSize({ width: 320, height: 900 });
  await noHorizontalOverflow(page, "/casa 320");
  await page.setViewportSize({ width: 390, height: 900 });
  // Cada tarjeta abre la ficha del partido.
  await page.getByRole("link", { name: /Tottenham Hotspur/ }).first().click();
  await page.waitForURL(/\/futbol\/partidos\/e2e0e2e0-2222-4222-8222-000000000003/, { timeout: 30_000 });
  ok("/casa: la tarjeta abre la ficha del partido", page.url().includes("/futbol/partidos/e2e0e2e0-2222-4222-8222-000000000003"));
  await page.waitForTimeout(1500);
  ok("ficha: sin letrero del proveedor", !/api-football/i.test(await page.locator("body").innerText()));
  await page.goto(`${origin}/futbol`, { waitUntil: "networkidle" });
  ok("calendario: sin letrero del proveedor ni hora de consulta", !/api-football|última consulta/i.test(await page.locator("body").innerText()));

  // ── 2. La polla: secciones, tarjetas compactas, desplegable ─────────────
  await page.goto(`${origin}/casa/e2e-vivo-marcador`, { waitUntil: "networkidle" });
  const finalizados = page.getByRole("button", { name: /Finalizados · 2/ });
  await finalizados.waitFor({ timeout: 30_000 });
  ok("polla: Finalizados cerrado por defecto", (await finalizados.getAttribute("aria-expanded")) === "false");
  const text = (await page.locator("body").innerText()).toLowerCase();
  ok("polla: En vivo · 3 con minuto y el que espera datos", text.includes("en vivo · 3") && text.includes("vivo · 34'") && text.includes("esperando datos"));
  const liveToggle = page.getByRole("button", { name: /En vivo · 3/ });
  ok("polla: «En vivo» abierto por defecto", (await liveToggle.getAttribute("aria-expanded")) === "true");
  await liveToggle.click();
  ok("polla: «En vivo» se pliega", (await liveToggle.getAttribute("aria-expanded")) === "false" && (await page.locator("article", { hasText: "Tottenham" }).count()) === 0);
  await liveToggle.click();
  // Los días dependen de la hora de la corrida (Hoy/Mañana/«vie 18 sep»): se cuentan los grupos abiertos.
  const dayGroups = await page.locator("section button[aria-expanded]").filter({ hasText: /^(Hoy|Mañana|[a-zé]{3} \d{1,2} [a-z]{3})\s*·\s*\d+$/i }).evaluateAll((els) => els.map((el) => [el.textContent?.trim(), el.getAttribute("aria-expanded")]));
  ok("polla: Próximos por día, cada día abierto", text.includes("próximos · 2") && dayGroups.length >= 1 && dayGroups.every(([, open]) => open === "true"), JSON.stringify(dayGroups));
  ok("polla: tarjeta en vivo con Tu marcador 1-0", /tu marcador:\s*1-0/.test(text));
  ok("polla: pestañas arriba de Tus cupos", (await page.getByRole("tab", { name: "Partidos" }).boundingBox())?.y < (await page.getByRole("heading", { name: "Tus cupos" }).boundingBox())?.y);
  ok("polla: sin encabezado repetido «Tus pronósticos»", !text.includes("tus pronósticos"));
  const liveCard = page.locator("article", { hasText: "Tottenham" });
  ok("polla: escudos y marcador en la misma fila", await liveCard.evaluate((card) => {
    const crests = card.querySelectorAll("[data-team-crest]");
    const cells = card.querySelectorAll(".lp-money");
    if (crests.length < 2 || cells.length < 2) return false;
    const y = (el) => el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2;
    return Math.abs(y(crests[0]) - y(cells[0])) < 12 && Math.abs(y(crests[1]) - y(cells[1])) < 12;
  }));
  const upcomingInput = page.getByLabel("Goles de Aston Villa");
  await upcomingInput.fill("2");
  ok("polla: auto-salto local → visitante", await page.evaluate(() => document.activeElement?.getAttribute("aria-label")) === "Goles de Everton");

  await finalizados.click();
  const cardM1 = page.locator("article", { hasText: "Manchester City" });
  await cardM1.waitFor();
  const m1Text = await cardM1.innerText();
  ok("polla: partido finalizado muestra Tu marcador 2-0 con +3 pts", /Tu marcador:\s*2-0/.test(m1Text) && m1Text.includes("+3 pts"), m1Text.replace(/\s+/g, " ").slice(0, 160));
  const cardM2 = page.locator("article", { hasText: "Liverpool" });
  ok("polla: solo marcador exacto suma (2-1 contra 1-1 = 0 pts)", (await cardM2.innerText()).includes("0 pts"));
  ok("polla: 0 pts en amarillo y +3 en verde", await cardM2.evaluate((card) => [...card.querySelectorAll("span")].some((s) => /^0\s*pts$/.test((s.textContent ?? "").trim()) && s.className.includes("text-amber")))
    && await cardM1.evaluate((card) => [...card.querySelectorAll("span")].some((s) => (s.textContent ?? "").includes("+3") && s.className.includes("text-turf"))));
  const toggle = cardM1.getByRole("button", { name: /Ver pronósticos de otros/ });
  ok("polla: el desplegable dice cuántos pronosticaron", (await toggle.innerText()).includes("(26)"), await toggle.innerText());
  await toggle.click();
  const list = cardM1.locator("[aria-label^='Pronósticos de otros']");
  await list.waitFor({ timeout: 20_000 });
  await list.locator("li").first().waitFor();
  const before = await list.locator("li").count();
  const metrics = await list.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
  ok("polla: la lista de otros scrollea adentro, no la página", metrics.scroll > metrics.client && before <= 20, `${before} filas, ${metrics.scroll}/${metrics.client}`);
  await list.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.waitForFunction((count) => document.querySelectorAll("[aria-label^='Pronósticos de otros'] li").length > count, before, { timeout: 20_000 });
  ok("polla: bajar dentro del desplegable trae la página siguiente", (await list.locator("li").count()) === 26, String(await list.locator("li").count()));
  // Mi fila puede caer en cualquier página (orden por id): se busca con la lista completa.
  ok("polla: mi fila marcada (tú)", (await list.innerText()).includes("(tú)"));
  ok("polla: los puntos de cada uno aparecen al estar verificado", (await list.innerText()).includes("+3"));
  await shot(page, "polla-partidos");
  await noHorizontalOverflow(page, "polla 390");

  // Texto al 200 %: nada se sale ni desaparece.
  await page.setViewportSize({ width: 320, height: 900 });
  await page.evaluate(() => {
    const all = [...document.querySelectorAll("body *")];
    const sizes = all.map((el) => parseFloat(getComputedStyle(el).fontSize));
    all.forEach((el, i) => { if (Number.isFinite(sizes[i])) el.style.fontSize = `${sizes[i] * 2}px`; });
  });
  await page.waitForTimeout(300);
  await noHorizontalOverflow(page, "polla 320 texto 200%");
  ok("polla 320 texto 200%: los nombres siguen visibles", await liveCard.evaluate((card) => [...card.querySelectorAll("span")].some((s) => s.textContent?.includes("Tottenham") && s.getBoundingClientRect().width > 40)));
  await page.screenshot({ path: path.join(shots, "polla-partidos-320-zoom200.png"), fullPage: true });
  await page.reload({ waitUntil: "networkidle" });
  await page.setViewportSize({ width: 390, height: 900 });

  // ── 3. Tabla con premio provisional · Info con la regla nueva ───────────
  await page.getByRole("tab", { name: "Tabla" }).click();
  await page.getByText("Si la polla terminara ahora").waitFor({ timeout: 20_000 });
  const tabla = await page.locator("table").innerText();
  ok("tabla: los líderes muestran cuánto ganarían", tabla.includes("Ganaría"), tabla.slice(0, 120));
  const ganarias = (tabla.match(/Ganaría/g) ?? []).length;
  ok("tabla: solo los empatados arriba llevan premio provisional", ganarias > 0 && ganarias < 26, String(ganarias));
  await shot(page, "polla-tabla", [390]);
  await page.getByRole("tab", { name: "Info" }).click();
  await page.getByText("Cómo sumas puntos").click();
  const info = await page.locator("body").innerText();
  ok("info: regla solo marcador exacto", info.includes("Solo el marcador exacto suma: 3 puntos.") && info.includes("Cualquier otro resultado: 0 puntos"));
  await shot(page, "polla-info", [390]);

  // ── 3.5 Polla terminada sin confirmar: el jugador lo ve claro ───────────
  await page.goto(`${origin}/casa/e2e-vivo-lista`, { waitUntil: "networkidle" });
  await page.getByText("Todos los partidos terminaron").waitFor({ timeout: 20_000 });
  await page.getByRole("tab", { name: "Tabla" }).click();
  await page.getByText("La polla terminó").waitFor({ timeout: 20_000 });
  ok("lista: la Tabla dice «Se lleva» a los dos empatados", ((await page.locator("table").innerText()).match(/Se lleva/g) ?? []).length === 2);
  await shot(page, "lista-jugador", [390]);

  // ── 4. Polla resuelta: reparto y prueba de pago pendiente ───────────────
  await page.goto(`${origin}/casa/e2e-vivo-resuelta`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Prueba de pago" }).waitFor({ timeout: 20_000 });
  const resuelta = await page.locator("body").innerText();
  ok("resuelta: el ganador ve cómo se distribuye", /Pozo \$14\.000 · 2 ganadores · \$7\.000 cada uno/.test(resuelta), "");
  ok("resuelta: prueba de pago pendiente", resuelta.includes("0 de 2 pagados") && resuelta.includes("Pago pendiente"));
  await shot(page, "resuelta-antes", [390]);

  // ── 4.5 Admin: polla lista → ganadores calculados → confirmar ──────────
  const apage = admin.page;
  await apage.goto(`${origin}/admin/pollas`, { waitUntil: "networkidle" });
  const banner = apage.getByRole("button", { name: /lista[s]? para repartir/ });
  await banner.waitFor({ timeout: 30_000 });
  ok("admin: aviso de pollas listas para repartir", (await banner.innerText()).includes("Polla E2E lista"));
  await apage.getByRole("button", { name: /Polla E2E lista/ }).first().click();
  const lista = apage.locator("section[aria-labelledby^='pagos-']", { hasText: "Ganadores calculados" });
  await lista.waitFor({ timeout: 30_000 });
  const listaText = await lista.innerText();
  ok("admin: ganadores calculados con montos y cuentas", listaText.includes("Jugador E2E") && listaText.includes("Jugador 2") && (listaText.match(/\$7\.000/g) ?? []).length >= 2 && listaText.includes("3001234567") && listaText.includes("todavía no registró su cuenta"), listaText.replace(/\s+/g, " ").slice(0, 200));
  ok("admin: sin el botón viejo de «Repartir el pozo»", (await apage.getByRole("button", { name: "Repartir el pozo" }).count()) === 0);
  for (const width of [320, 768]) {
    await apage.setViewportSize({ width, height: 900 });
    await apage.waitForTimeout(250);
    await lista.screenshot({ path: path.join(shots, `admin-lista-${width}.png`) });
  }
  await apage.setViewportSize({ width: 390, height: 900 });
  await lista.getByRole("button", { name: "Confirmar ganadores y repartir" }).click();
  await lista.getByRole("button", { name: "Sí, repartir" }).click();
  const repartida = apage.locator("section[aria-labelledby^='pagos-']", { hasText: "Pago a ganadores" });
  await repartida.first().waitFor({ timeout: 30_000 });
  await apage.getByText("0 de 2 pagados").first().waitFor({ timeout: 30_000 });
  ok("admin: al confirmar queda repartida y lista para pagar uno a uno", (await repartida.first().getByRole("button", { name: "Registrar pago con comprobante" }).count()) === 2);

  // ── 5. Admin paga uno a uno con comprobante ─────────────────────────────
  await apage.goto(`${origin}/admin/pollas`, { waitUntil: "networkidle" });
  await apage.getByRole("button", { name: /Polla E2E resuelta/ }).first().click();
  await apage.getByRole("heading", { name: "Pago a ganadores" }).waitFor({ timeout: 30_000 });
  await apage.getByText("0 de 2 pagados").waitFor({ timeout: 20_000 });
  // La tarjeta de la polla también es un <li>: se apunta a la lista de premios.
  const primero = apage.locator("section[aria-labelledby^='pagos-'] > ul > li", { hasText: "Transferir a" }).first();
  ok("admin: ve la cuenta del ganador con botón de copiar", (await primero.innerText()).includes("3001234567"));
  await primero.locator("input[type=file]").setInputFiles({ name: "comprobante.png", mimeType: "image/png", buffer: solidPng(900, 1200, [30, 120, 60]) });
  await primero.getByAltText("Vista previa del comprobante").waitFor({ timeout: 20_000 });
  await primero.getByLabel("Referencia o nota (opcional)").fill("Nequi prueba E2E");
  await primero.getByRole("button", { name: "Registrar pago con comprobante" }).click();
  await apage.getByText("1 de 2 pagados").waitFor({ timeout: 30_000 });
  ok("admin: el primer premio queda pagado con fecha", (await apage.locator("body").innerText()).includes("Pagado ·"));
  await apage.getByRole("button", { name: "Ver comprobante" }).first().click();
  const adminImg = apage.locator("img[alt^='Comprobante del pago a']").first();
  await adminImg.waitFor();
  ok("admin: el comprobante se abre desde la URL firmada", await adminImg.evaluate((img) => new Promise((resolve) => { if (img.complete) resolve(img.naturalWidth > 0); else { img.onload = () => resolve(img.naturalWidth > 0); img.onerror = () => resolve(false); } })));
  // /admin/pollas lista cientos de pollas locales: se captura solo la sección de pagos.
  for (const width of [390, 768]) {
    await apage.setViewportSize({ width, height: 900 });
    await apage.waitForTimeout(250);
    await apage.locator("section[aria-labelledby^='pagos-']").screenshot({ path: path.join(shots, `admin-pagos-${width}.png`) });
  }

  // ── 6. El ganador y la polla cerrada ven la prueba de pago ──────────────
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Prueba de pago" }).waitFor({ timeout: 20_000 });
  const despues = await page.locator("body").innerText();
  ok("resuelta: avance 1 de 2 pagados y referencia", despues.includes("1 de 2 pagados") && despues.includes("Ref. Nequi prueba E2E"));
  const summary = page.getByText("Ver comprobante de pago").first();
  await summary.click();
  const img = page.locator("img[alt^='Comprobante del pago a']").first();
  await img.waitFor();
  ok("resuelta: el comprobante carga para el participante", await img.evaluate((el) => new Promise((resolve) => { if (el.complete) resolve(el.naturalWidth > 0); else { el.onload = () => resolve(el.naturalWidth > 0); el.onerror = () => resolve(false); } })));
  await shot(page, "resuelta-despues", [320, 390]);
  await page.goto(`${origin}/casa`, { waitUntil: "networkidle" });
  ok("/casa: la polla cerrada refleja el pago en curso", (await page.locator("#pollas-cerradas").evaluate((el) => el.textContent ?? "")).includes("Pago del premio en curso · 1 de 2"));

  // ── 7. Alguien que no participó ve el hecho, no el pantallazo ───────────
  const otro = await createLocalBrowserActor(browser, { name: "Otro E2E", origin });
  await otro.page.goto(`${origin}/casa/e2e-vivo-resuelta`, { waitUntil: "networkidle" });
  await otro.page.getByRole("heading", { name: "Prueba de pago" }).waitFor({ timeout: 20_000 });
  const otroText = await otro.page.locator("body").innerText();
  ok("otro: ve Pagado · fecha y el avance", /Pagado · \d+ \w+ 2026/.test(otroText) && otroText.includes("1 de 2 pagados"));
  ok("otro: no recibe la imagen del comprobante", !otroText.includes("Ver comprobante de pago") && (await otro.page.locator("img[alt^='Comprobante del pago a']").count()) === 0);
  await otro.context.close();

  await jugador.context.close();
  await admin.context.close();
} finally {
  await browser.close();
  writeFileSync(path.join(shots, "report.json"), JSON.stringify(report, null, 2));
  console.log(`\n${report.failures.length === 0 ? "TODO OK" : `${report.failures.length} FALLAS`} · capturas en ${shots}`);
  if (report.failures.length > 0) process.exitCode = 1;
}
