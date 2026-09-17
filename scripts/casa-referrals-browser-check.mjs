// Migración 135 (invitaciones) de punta a punta contra el Supabase LOCAL y un dev server local.
//   node scripts/casa-v2-local-env.mjs dev 3137
//   CASA_ORIGIN=http://localhost:3137 node scripts/casa-referrals-browser-check.mjs
// Páginas reales: enlace con ?ref, cookie, comprobante real al Storage local,
// aprobación desde el panel, cupo de regalo automático, remover/restaurar,
// código escrito a mano e interruptor del editor. Los datos quedan en la base
// local para revisarlos; las capturas van a CASA_CAPTURES.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { createLocalBrowserActor, localDb, localSql, sqlQuote as q } from "./casa-local-browser-helpers.mjs";

const origin = process.env.CASA_ORIGIN ?? "http://localhost:3137";
if (!/^http:\/\/localhost:\d+$/.test(origin)) throw new Error("Local origin only.");
const output = process.env.CASA_CAPTURES ?? "C:/Users/STZTR/Downloads/la-polla-referidos-browser";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const shots = [];

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
async function shot(locator, name, caption) {
  // Al centro: la barra de navegación fija no tapa la parte de abajo del elemento.
  await locator.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await locator.page().waitForTimeout(250);
  await locator.screenshot({ path: `${output}/${name}.png` });
  shots.push({ name, caption });
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
  // Recargar: un re-render después del zoom podía conservar tamaños dobles en capturas siguientes.
  await page.setViewportSize({ width: 390, height: 900 });
  await page.reload();
  await hydrated(page);
}
// El aviso es fijo, así que zoom() no lo revisa: al 200 % la tarjeta cabe y nada se sale por el lado.
async function zoomDialog(page, name) {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.evaluate(() => { for (const [el, size] of [...document.querySelectorAll('[role="dialog"], [role="dialog"] *')].map(el => [el, parseFloat(getComputedStyle(el).fontSize)])) el.style.setProperty("font-size", `${size * 2}px`, "important"); });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${output}/${name}-zoom200.png` });
  const report = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const box = dialog.getBoundingClientRect();
    const outside = [...dialog.querySelectorAll("*")].filter((el) => el.getBoundingClientRect().right > box.right + 1)
      .slice(0, 5).map((el) => `${el.tagName} "${(el.textContent || "").trim().slice(0, 30)}"`);
    return { right: box.right, width: innerWidth, sideways: dialog.scrollWidth > dialog.clientWidth + 1, scrolls: dialog.scrollHeight > dialog.clientHeight, outside };
  });
  assert.ok(report.right <= report.width + 1 && !report.sideways && report.outside.length === 0, `${name}: ${JSON.stringify(report)}`);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.reload();
  await hydrated(page);
}
async function hydrated(page) {
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some(b => Object.keys(b).some(k => k.startsWith("__reactProps$"))));
}
// Con hidratación selectiva, un botón del layout puede estar listo antes que el
// formulario: un clic antes de hidratar no existe para React.
async function ready(locator) {
  await locator.waitFor();
  const handle = await locator.elementHandle();
  await locator.page().waitForFunction((el) => Object.keys(el).some((k) => k.startsWith("__reactProps$")), handle);
  return locator;
}
async function receipt(page, text) {
  const data = await page.evaluate((label) => {
    const c = document.createElement("canvas"); c.width = 520; c.height = 260;
    const x = c.getContext("2d"); x.fillStyle = "#ffffff"; x.fillRect(0, 0, 520, 260);
    x.fillStyle = "#6b21a8"; x.font = "bold 28px sans-serif"; x.fillText("Comprobante Nequi", 24, 60);
    x.fillStyle = "#111111"; x.font = "22px sans-serif"; x.fillText(label, 24, 120); x.fillText("$ 20.000", 24, 170);
    return c.toDataURL("image/png").split(",")[1];
  }, text);
  return Buffer.from(data, "base64");
}
// psql -tA imprime los valores y también las etiquetas de comando (BEGIN, INSERT 0 1…).
const TAG = /^(BEGIN|COMMIT|ROLLBACK|SET|INSERT \d+ \d+|UPDATE \d+|DELETE \d+|SELECT \d+)$/;
const rows = (sql) => localSql(sql).split("\n").map((line) => line.trim()).filter((line) => line && !TAG.test(line));
const json = (sql) => JSON.parse(rows(sql).find((line) => line.startsWith("{")));
const one = (sql) => rows(sql).at(-1);

// Como en producción: la cuenta de acceso crea la fila pública (on_auth_user_created),
// y la regla de persona nueva mira auth.users.
function sqlUser(name) {
  const id = randomUUID();
  const phone = `1888${String(Math.floor(Math.random() * 1e10)).padStart(10, "0")}`;
  localSql(`INSERT INTO auth.users(id,phone,created_at,updated_at) VALUES(${q(id)},${q(phone)},now(),now());
    UPDATE public.users SET display_name=${q(name)},avatar_url='millos' WHERE id=${q(id)};`);
  return id;
}
const PROMO = "dialog";
async function noPromo(page) {
  await page.waitForTimeout(1500);
  assert.equal(await page.getByRole(PROMO).count(), 0, "no invitation notice here");
}

const opened = [];
try {
  const suffix = randomUUID().slice(0, 6);
  const admin = await createLocalBrowserActor(browser, { name: "Administración Casa", admin: true, origin });
  const juan = await createLocalBrowserActor(browser, { name: "Juan Pérez", origin });
  const ana = await createLocalBrowserActor(browser, { name: "Ana Gómez", origin });
  const pedro = await createLocalBrowserActor(browser, { name: "Pedro Ruiz", origin });
  const carla = await createLocalBrowserActor(browser, { name: "Carla Díaz", origin });
  const diego = await createLocalBrowserActor(browser, { name: "Diego Mora", origin });
  opened.push(admin.page, juan.page, ana.page, pedro.page, carla.page, diego.page);
  for (const actor of [admin, juan, ana, pedro, carla, diego]) { actor.page.setDefaultTimeout(60000); actor.page.setDefaultNavigationTimeout(180000); }
  const png = await receipt(admin.page, "Referencia local");

  async function sqlPay(pollaId, userId, sha, approve = true) {
    const begin = json(`BEGIN; SELECT public.casa_v2_context(2);
      SELECT public.casa_begin_entry_proof_v3(${q(pollaId)},${q(userId)},gen_random_uuid(),NULL,NULL,repeat(${q(sha)},64),'image/png',${png.length},2)::text; COMMIT;`);
    const upload = await localDb.storage.from("payment-proofs").upload(begin.proof_path, png, { contentType: "image/png", upsert: false });
    if (upload.error) throw upload.error;
    localSql(`BEGIN; SELECT public.casa_v2_context(2);
      SELECT public.casa_confirm_entry_proof_v2(${q(begin.attempt_id)},${q(userId)},2);
      ${approve ? `SELECT public.casa_review_attempt_v3(${q(begin.attempt_id)},0,'pagada',NULL,2,${q(admin.id)});` : ""}
      COMMIT;`);
    return begin.entry_id;
  }

  // ── Fixture: polla de partidos, $20.000, invitaciones cada 5 (DEFAULT de la 135).
  // Fecha única por corrida: la deduplicación de partidos rechaza dos candidatos en la misma ventana.
  const at = `now()+interval '${45 + Math.floor(Math.random() * 300)} days'+interval '${Math.floor(Math.random() * 1400)} minutes'`;
  const m1 = one(`SELECT public.upsert_match_safe('lpref-1-${suffix}','premier_2025',1,'league','Arsenal','Chelsea',NULL,NULL,${at},NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);`);
  const m2 = one(`SELECT public.upsert_match_safe('lpref-2-${suffix}','premier_2025',1,'league','Liverpool','Manchester City',NULL,NULL,${at}+interval '3 hours',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);`);
  // Se llama OFIGOLAZO para ver el aviso de invitaciones. Las de corridas anteriores
  // (mismo prefijo de slug, solo datos de este script) se archivan para que el inicio
  // de Casa muestre la de esta corrida.
  const pollaName = "OFIGOLAZO", slug = `ofigolazo-invitaciones-${suffix}`;
  localSql(`BEGIN; SELECT public.casa_v2_context(2);
    UPDATE public.casa_pollas SET archived_at=now() WHERE slug LIKE 'ofigolazo-invitaciones-%' AND archived_at IS NULL; COMMIT;`);
  const pollaId = one(`BEGIN; SELECT public.casa_v2_context(2);
    INSERT INTO public.casa_pollas(slug,name,kind,tournament,scoring_mode,status,closes_at,created_by,entry_price_cop,house_cut_pct,
      payout_method,payout_account,payout_account_name,max_entries_per_user,publication_mode,opens_at)
    VALUES(${q(slug)},${q(pollaName)},'partidos','premier_2025','marcador','abierta',now()+interval '44 days',${q(admin.id)},20000,30,
      'Nequi','3000000000','Cuenta ficticia local',5,'ahora',now()-interval '1 minute') RETURNING id; COMMIT;`);
  assert.match(pollaId, /^[0-9a-f-]{36}$/);
  localSql(`BEGIN; SELECT public.casa_v2_context(2);
    INSERT INTO public.casa_polla_matches(polla_id,match_id,order_index) VALUES(${q(pollaId)},${q(m1)},0),(${q(pollaId)},${q(m2)},1); COMMIT;`);
  assert.equal(one(`SELECT referral_every FROM public.casa_pollas WHERE id=${q(pollaId)}`), "5");

  const code = (id) => one(`SELECT public.casa_referral_code_v1(${q(id)});`);
  const codeJuan = code(juan.id), codeAna = code(ana.id);
  assert.match(codeJuan, /^JUANPE\d{4}$/);
  assert.match(codeAna, /^ANAGOM\d{4}$/);
  // El aviso se prueba con Juan (y el administrador, que no lo ve); los demás ya lo vieron.
  for (const actor of [ana, pedro, carla, diego]) {
    await actor.context.addInitScript((key) => { try { localStorage.setItem(key, "1"); } catch { /* sin almacenamiento */ } }, `lp_promo_invitados:${pollaId}`);
  }
  await juan.context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  await juan.context.addInitScript(() => { Object.defineProperty(navigator, "share", { value: undefined, configurable: true }); });

  // Juan paga su cupo y cuatro invitados suyos pagan (SQL, comprobantes reales en Storage).
  await sqlPay(pollaId, juan.id, "c");
  for (let i = 1; i <= 4; i += 1) {
    const guest = sqlUser(`Invitado ${i} de Juan`);
    assert.equal(json(`SELECT public.casa_set_referrer_v1(${q(guest)},${q(codeJuan)},'enlace')::text;`).ok, true);
    await sqlPay(pollaId, guest, "a");
  }
  // Ana paga; tres invitados suyos pagan y uno queda en revisión.
  await sqlPay(pollaId, ana.id, "d");
  for (let i = 1; i <= 4; i += 1) {
    const guest = sqlUser(i === 4 ? "Laura Invitada" : `Invitada ${i} de Ana`);
    assert.equal(json(`SELECT public.casa_set_referrer_v1(${q(guest)},${q(codeAna)},'codigo')::text;`).ok, true);
    await sqlPay(pollaId, guest, "b", i < 4);
  }

  // ── 0) Aviso al entrar: «Por 5 invitados, te damos un cupo en la OFIGOLAZO», con el código.
  await juan.page.goto(`${origin}/casa`);
  await hydrated(juan.page);
  const promo = juan.page.getByRole(PROMO, { name: "Por 5 invitados, te damos un cupo en la OFIGOLAZO" });
  await promo.waitFor();
  assert.equal(await promo.locator("#copiar-codigo-promo").textContent(), codeJuan);
  const focused = () => juan.page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.getAttribute("role") ?? document.activeElement?.textContent);
  assert.equal(await focused(), "dialog", "focus moves into the notice");
  assert.equal(await promo.getByText("Invita y gana").count(), 0, "one title, no eyebrow");
  assert.equal(await promo.getByRole("link", { name: "Ver la polla" }).getAttribute("href"), `/casa/${slug}`);
  await shot(promo, "00-aviso-ofigolazo", "Al entrar: el aviso de la OFIGOLAZO con tu código para copiar y el botón para compartir.");
  for (const [width, height] of [[320, 640], [390, 844], [768, 1024], [1440, 900]]) {
    await juan.page.setViewportSize({ width, height });
    await juan.page.waitForTimeout(300);
    await juan.page.screenshot({ path: `${output}/aviso-vista-${width}.png` });
    const box = await promo.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1 && box.y >= 0, `aviso/${width}: ${JSON.stringify(box)}`);
  }
  await zoomDialog(juan.page, "aviso");
  await promo.waitFor();
  // El teclado después de las capturas: el anillo de foco no sale en las imágenes.
  assert.equal(await focused(), "dialog", "focus moves into the notice again");
  await juan.page.keyboard.press("Shift+Tab");
  assert.equal(await focused(), "Ver la polla", "Shift+Tab stays inside");
  await juan.page.keyboard.press("Tab");
  assert.equal(await focused(), "Cerrar", "Tab wraps to Cerrar");
  await (await ready(promo.getByRole("button", { name: "Copiar tu código" }))).click();
  await promo.getByText("Copiado", { exact: true }).waitFor();
  assert.equal(await juan.page.evaluate(() => navigator.clipboard.readText()), codeJuan);
  await (await ready(promo.getByRole("button", { name: /^Compartir OFIGOLAZO/ }))).click();
  await promo.getByText("Mensaje copiado").waitFor();
  const promoClip = await juan.page.evaluate(() => navigator.clipboard.readText());
  assert.ok(promoClip.includes(`/casa/${slug}?ref=${codeJuan}`) && promoClip.includes(`Usa mi código ${codeJuan}`), promoClip);
  await juan.page.keyboard.press("Escape");
  await promo.waitFor({ state: "detached" });
  await juan.page.reload();
  await hydrated(juan.page);
  await noPromo(juan.page);
  await admin.page.goto(`${origin}/casa`);
  await hydrated(admin.page);
  await noPromo(admin.page);

  // ── 1) Pedro abre el enlace de Juan: cookie, URL limpia y la pregunta con Juan.
  await pedro.page.goto(`${origin}/casa/${slug}?ref=${codeJuan.toLowerCase()}`);
  await hydrated(pedro.page);
  assert.equal(new URL(pedro.page.url()).search, "", "the referral code leaves the address bar");
  const pedroCookies = await pedro.context.cookies(origin);
  assert.equal(pedroCookies.find((c) => c.name === "lp_ref")?.value, codeJuan);
  assert.equal(pedroCookies.find((c) => c.name === "lp_ref")?.httpOnly, true);
  const hint = pedro.page.getByRole("region", { name: "¿Te invitó esta persona?" });
  await hint.getByText("Juan Pérez", { exact: true }).waitFor();
  await shot(hint, "01-pedro-llega-con-enlace", "Pedro abre el enlace de Juan: la polla le pregunta si fue él quien lo invitó.");
  assert.equal(await pedro.page.locator("details", { hasText: "te damos un cupo*" }).count(), 0,
    "who has not joined yet only needs to join");
  await noPromo(pedro.page);
  await screen(pedro.page, "pedro-polla");

  await pedro.page.getByRole("link", { name: /Entrar por/ }).click();
  await pedro.page.waitForURL(`**/casa/${slug}/pagar`);
  await hydrated(pedro.page);
  const payHint = pedro.page.getByRole("region", { name: "¿Te invitó esta persona?" });
  await payHint.getByText("Se guarda al enviar tu comprobante.", { exact: true }).waitFor();
  await shot(payHint, "02-pedro-pagar", "En /pagar ve a Juan; se guarda solo al enviar el comprobante. «No es así» lo descarta.");
  await screen(pedro.page, "pedro-pagar");
  await zoom(pedro.page, "pedro-pagar");
  const pedroPng = await receipt(pedro.page, "Pedro Ruiz");
  await (await ready(pedro.page.locator("input[type=file]").first())).setInputFiles({ name: "pedro.png", mimeType: "image/png", buffer: pedroPng });
  await pedro.page.waitForFunction(() => [...document.querySelectorAll("button")].some(b => b.textContent === "Enviar el comprobante" && !b.disabled));
  await pedro.page.locator("button:not([disabled])", { hasText: "Enviar el comprobante" }).first().click();
  await pedro.page.getByText("Comprobante 1 de 1 enviado").waitFor();
  const link = json(`SELECT row_to_json(r)::text FROM (SELECT referrer_user_id, via, locked_at FROM public.casa_referrals WHERE referred_user_id=${q(pedro.id)}) r;`);
  assert.equal(link.referrer_user_id, juan.id);
  assert.equal(link.via, "enlace");
  assert.equal(link.locked_at, null, "the referrer can still change until the first approval");
  assert.equal((await pedro.context.cookies(origin)).some((c) => c.name === "lp_ref"), false, "the cookie did its job");

  // ── 2) El administrador ve «Invitado por» y aprueba: el regalo de Juan aparece solo.
  await admin.page.goto(`${origin}/admin/pollas/recibos?pollaId=${pollaId}`);
  await hydrated(admin.page);
  const pedroRow = admin.page.locator("li", { hasText: "Pedro Ruiz" }).first();
  await pedroRow.getByText("Invitado por Juan Pérez").waitFor();
  await shot(pedroRow, "03-admin-invitado-por", "La cola de pagos muestra quién invitó a cada jugador, para compararlo con el comprobante.");
  assert.equal(one(`SELECT count(*) FROM public.casa_entries WHERE polla_id=${q(pollaId)} AND user_id=${q(juan.id)} AND origin='invitacion'`), "0");
  await (await ready(pedroRow.getByRole("button", { name: "Aprobar el pago de Pedro Ruiz" }))).click();
  await admin.page.waitForFunction(() => !document.body.textContent.includes("Invitado por Juan Pérez"));
  const gift = json(`SELECT row_to_json(g)::text FROM (SELECT id, status, amount_cop, entry_number FROM public.casa_entries
    WHERE polla_id=${q(pollaId)} AND user_id=${q(juan.id)} AND origin='invitacion') g;`);
  assert.deepEqual([gift.status, gift.amount_cop, gift.entry_number], ["pagada", 0, 2]);
  assert.equal(one(`SELECT gross_cop FROM public.casa_polla_pot(${q(pollaId)})`), "200000", "the gift adds no money");
  assert.equal(one(`SELECT locked_at IS NOT NULL FROM public.casa_referrals WHERE referred_user_id=${q(pedro.id)}`), "t");

  // ── 3) Juan: regla junto a Compartir, avance, código y el cupo de regalo.
  await juan.page.goto(`${origin}/casa/${slug}`);
  await hydrated(juan.page);
  await noPromo(juan.page);
  const share = juan.page.getByRole("button", { name: /^Compartir OFIGOLAZO/ });
  assert.equal(await share.getAttribute("title"), "Por cada 5 invitados, te damos un cupo en esta polla.");
  await (await ready(share)).click();
  await juan.page.getByText("Mensaje copiado").waitFor();
  const clip = await juan.page.evaluate(() => navigator.clipboard.readText());
  assert.ok(clip.includes(`/casa/${slug}?ref=${codeJuan}`), clip);
  assert.ok(clip.includes(`Usa mi código ${codeJuan} al inscribirte.`), clip);
  const invite = juan.page.locator("details", { hasText: "te damos un cupo*" }).first();
  await invite.getByText("1 cupo ganado").waitFor();
  await shot(invite, "04-juan-regla-compartir", "Junto a Compartir: la regla en una frase y el avance. Pasar el cursor por Compartir dice lo mismo.");
  await invite.locator("summary").click();
  await invite.getByText("Tu cupo de regalo ya está en Tus cupos.").waitFor();
  await invite.getByText("*Solo aplica para usuarios nuevos, 1 polla por usuario.").waitFor();
  await shot(invite, "05-juan-detalle", "Desplegado: avance, el cupo ya activo, el código para copiar y una sola letra menuda.");
  await screen(juan.page, "juan-polla");
  await zoom(juan.page, "juan-polla");
  const cupos = juan.page.getByLabel("Elige el cupo para ver o editar sus pronósticos", { exact: true });
  assert.ok((await cupos.locator("option").allTextContents()).some((t) => t.startsWith("Cupo 2 · Regalo")));
  await (await ready(cupos)).selectOption("2");
  await juan.page.waitForURL(`**/casa/${slug}?p=2`);
  await hydrated(juan.page);
  const tusCupos = juan.page.locator(".lp-card", { has: juan.page.getByRole("heading", { name: "Tus cupos" }) }).last();
  await juan.page.getByText("Regalo por invitar", { exact: true }).waitFor();
  await shot(tusCupos, "06-juan-tus-cupos", "El cupo 2 aparece solo en Tus cupos, marcado como regalo, listo para pronosticar.");
  await (await ready(juan.page.getByRole("tab", { name: "Info" }))).click();
  const rule = juan.page.locator("details", { hasText: "Invita y gana cupos" }).first();
  await rule.locator("summary").click();
  await rule.getByText("Por cada 5 invitados, te damos un cupo en esta polla.").waitFor();
  await rule.getByText("*Solo aplica para usuarios nuevos, 1 polla por usuario.").waitFor();
  assert.equal(await rule.locator("li").count(), 0, "one sentence, no bullet list");
  await shot(rule, "07-info-regla", "Info: una frase y la letra menuda, sin lista de condiciones.");
  await juan.page.goto(`${origin}/perfil`);
  await hydrated(juan.page);
  const perfil = juan.page.getByRole("region", { name: "Invita y gana cupos" });
  await perfil.getByText(codeJuan, { exact: true }).waitFor();
  await perfil.getByText("5 invitados con pago · 1 cupo de regalo").waitFor();
  await shot(perfil, "08-perfil-codigo", "Perfil: su código, invitados con pago y cupos de regalo.");
  await screen(juan.page, "juan-perfil");

  // ── 4) Ana: 3 de 5 y una invitada en revisión.
  await ana.page.goto(`${origin}/casa/${slug}`);
  await hydrated(ana.page);
  const anaInvite = ana.page.locator("details", { hasText: "te damos un cupo*" }).first();
  await anaInvite.getByText("Llevas 3 de 5").waitFor();
  await anaInvite.locator("summary").click();
  await anaInvite.getByText("(+1 en revisión)", { exact: false }).waitFor();
  await shot(anaInvite, "09-ana-avance", "Ana lleva 3 de 5; la cuarta invitada está en revisión.");

  // ── 5) Carla entró sin enlace: escribe el código a mano (error y acierto).
  await carla.page.goto(`${origin}/casa`);
  await hydrated(carla.page);
  const card = carla.page.getByRole("region", { name: "¿Alguien te invitó?" });
  await card.getByText("Escribe su código (opcional).").waitFor();
  await shot(card, "10-carla-sin-enlace", "Quien entró sin enlace ve «¿Alguien te invitó?», opcional.");
  await (await ready(card.getByRole("button", { name: "Escribir código" }))).click();
  await (await ready(card.getByLabel("Código de la persona que te invitó"))).fill("NOEXISTE0000");
  await card.getByRole("button", { name: "Guardar" }).click();
  await card.getByRole("alert").getByText("No encontramos ese código", { exact: false }).waitFor();
  await shot(card, "11-carla-codigo-malo", "Un código que no existe se explica y cuenta para el tope de intentos.");
  await card.getByLabel("Código de la persona que te invitó").fill(codeAna.toLowerCase());
  await card.getByRole("button", { name: "Guardar" }).click();
  const saved = carla.page.getByRole("region", { name: "Te invitó" });
  await saved.getByText("Ana Gómez", { exact: true }).waitFor();
  await saved.getByText("Guardado", { exact: true }).waitFor();
  await shot(saved, "12-carla-guardado", "Guardado. Se puede cambiar hasta que confirmemos su primer pago.");
  assert.equal(one(`SELECT via FROM public.casa_referrals WHERE referred_user_id=${q(carla.id)} AND referrer_user_id=${q(ana.id)}`), "codigo");
  await screen(carla.page, "carla-casa");

  // «Nadie me invitó» oculta la tarjeta en Casa y no vuelve al recargar.
  await diego.page.goto(`${origin}/casa`);
  await hydrated(diego.page);
  await (await ready(diego.page.getByRole("button", { name: "Nadie me invitó" }))).click();
  await diego.page.waitForFunction(() => !document.body.textContent.includes("¿Alguien te invitó?"));
  await diego.page.reload();
  await hydrated(diego.page);
  assert.equal(await diego.page.getByText("¿Alguien te invitó?").count(), 0);

  // ── 6) Panel: el regalo de Juan, remover (con motivo) y restaurar.
  await admin.page.goto(`${origin}/admin/pollas`);
  await hydrated(admin.page);
  await (await ready(admin.page.locator(`#polla-toggle-${pollaId}`))).click();
  const regalos = admin.page.getByRole("region", { name: "Cupos de regalo por invitar" });
  const juanGift = regalos.locator("li", { hasText: "Juan Pérez · Cupo #2" });
  await juanGift.getByText("Activo", { exact: true }).waitFor();
  await shot(regalos, "13-admin-regalo-activo", "Administrar pollas: el regalo se creó solo. «Remover cupo» es opcional.");
  await (await ready(juanGift.getByRole("button", { name: "Remover cupo" }))).click();
  await juanGift.getByLabel("Motivo (queda en el historial)").fill("Prueba local: varias cuentas de la misma persona");
  await shot(juanGift, "14-admin-remover", "Remover pide un motivo, que queda en el historial.");
  await juanGift.getByRole("button", { name: "Remover cupo" }).click();
  await juanGift.getByText("Removido", { exact: true }).waitFor();
  assert.equal(one(`SELECT status FROM public.casa_entries WHERE id=${q(gift.id)}`), "anulada");
  await shot(juanGift, "15-admin-removido", "Removido: sale de la tabla y no vuelve solo. Se puede restaurar.");
  await screen(admin.page, "admin-regalos", [320, 1440]);
  await (await ready(juanGift.getByRole("button", { name: "Restaurar cupo" }))).click();
  await juanGift.getByText("Activo", { exact: true }).waitFor();
  assert.equal(one(`SELECT status FROM public.casa_entries WHERE id=${q(gift.id)}`), "pagada");

  // ── 7) Editor: el interruptor solo sin inscripciones.
  const emptySlug = `sin-inscritos-${suffix}`;
  const emptyId = one(`BEGIN; SELECT public.casa_v2_context(2);
    INSERT INTO public.casa_pollas(slug,name,kind,tournament,scoring_mode,status,closes_at,created_by,entry_price_cop,house_cut_pct,
      payout_method,payout_account,publication_mode,opens_at)
    VALUES(${q(emptySlug)},'Polla sin inscritos','partidos','premier_2025','marcador','abierta',now()+interval '44 days',${q(admin.id)},20000,30,
      'Nequi','3000000000','ahora',now()-interval '1 minute') RETURNING id; COMMIT;`);
  localSql(`BEGIN; SELECT public.casa_v2_context(2); INSERT INTO public.casa_polla_matches(polla_id,match_id,order_index) VALUES(${q(emptyId)},${q(m1)},0); COMMIT;`);
  await admin.page.goto(`${origin}/admin/pollas/${emptyId}/editar`);
  await hydrated(admin.page);
  const toggle = await ready(admin.page.getByLabel(/Cupo de regalo por invitar/));
  assert.equal(await toggle.isChecked(), true);
  await shot(admin.page.locator("label", { has: toggle }), "16-editor-interruptor", "Editor: el programa viene activo en las pollas nuevas y se puede apagar mientras nadie se inscriba.");
  await toggle.uncheck();
  await admin.page.getByRole("button", { name: "Guardar cambios" }).click();
  await admin.page.getByText("Cambios guardados.").waitFor();
  assert.equal(one(`SELECT coalesce(referral_every::text,'null') FROM public.casa_pollas WHERE id=${q(emptyId)}`), "null");
  await admin.page.reload();
  await hydrated(admin.page);
  await (await ready(admin.page.getByLabel(/Cupo de regalo por invitar/))).check();
  await admin.page.getByRole("button", { name: "Guardar cambios" }).click();
  await admin.page.getByText("Cambios guardados.").waitFor();
  assert.equal(one(`SELECT referral_every FROM public.casa_pollas WHERE id=${q(emptyId)}`), "5");
  await screen(admin.page, "admin-editor", [320, 768]);

  // ── 8) Mis pollas (Perfil de Juan): el cupo de regalo en el selector.
  await juan.page.goto(`${origin}/perfil`);
  await hydrated(juan.page);
  const mine = juan.page.locator("li", { hasText: pollaName }).first();
  await mine.getByText("2 cupos").waitFor();
  assert.ok((await mine.locator("option").allTextContents()).some((t) => t.startsWith("Cupo 2 · Regalo")));

  await writeFile(`${output}/shots.json`, JSON.stringify({ origin, slug, pollaId, codeJuan, codeAna, shots }, null, 2));
  console.log(JSON.stringify({ ok: true, output, slug, pollaId, codeJuan, codeAna, shots: shots.length }));
} finally {
  for (const page of opened) await page.context().close().catch(() => {});
  await browser.close();
}
