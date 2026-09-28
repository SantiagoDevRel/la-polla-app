// scripts/rifas-e2e-local.mjs — recorrido completo de rifas contra el stack LOCAL.
//
// Requiere: base local (scripts/local-pg/apply-migrations.sh), el Supabase
// local (scripts/local-pg/local-supabase.mjs) y la app en :3101
// (node scripts/rifas-local-env.mjs start 3101). Nunca toca producción.
//
// Recorrido (spec §Verificación):
//   admin habilita creador → aparece «Crear mi rifa» en su Perfil → crea una
//   rifa Privada → un comprador no-admin recibe 404 → un admin la prueba:
//   reserva, sube comprobante → el creador aprueba → número Pagado → la rifa
//   pasa a Pública → otro comprador reserva y su reserva vence → venta por
//   fuera → visita sin sesión y registro → exportar imagen (2 plantillas) →
//   resultado del sorteo.
// Capturas: 320, 390 y 768 px, modo oscuro, y 320 px con texto al 200 %.
//   RIFAS_SHOTS=<carpeta> (por defecto ./rifas-screenshots, fuera de git)
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServerClient } from "@supabase/ssr";
import { anonKey, serviceKey } from "./local-pg/local-supabase.mjs";

const APP = process.env.RIFAS_APP_URL ?? "http://localhost:3101";
const SUPA = "http://127.0.0.1:54321";
const SHOTS = process.env.RIFAS_SHOTS ?? join(process.cwd(), "rifas-screenshots");
const PGPORT = process.env.PGPORT_LOCAL ?? "54322";
const DB = process.env.PGDB_LOCAL ?? "la_polla_local";
mkdirSync(SHOTS, { recursive: true });

function psql(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn("psql", ["-h", "127.0.0.1", "-p", PGPORT, "-U", "postgres", "-d", DB, "-X", "-tA", "-v", "ON_ERROR_STOP=1", "-c", sql]);
    let out = "", err = "";
    child.stdout.on("data", (c) => { out += c; });
    child.stderr.on("data", (c) => { err += c; });
    child.on("close", (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err))));
  });
}

const run = Date.now().toString(36);
const people = {
  admin: { email: `admin-${run}@rifas.local`, phone: `57319${String(Date.now()).slice(-6)}1`, name: `Admin ${run}`, admin: true },
  creator: { email: `creadora-${run}@rifas.local`, phone: `57319${String(Date.now()).slice(-6)}2`, name: `Creadora ${run}` },
  buyer: { email: `comprador-${run}@rifas.local`, phone: `57319${String(Date.now()).slice(-6)}3`, name: `Comprador ${run}` },
};
const PASSWORD = "local-only-password-123";

async function createUser(p) {
  const res = await fetch(`${SUPA}/auth/v1/admin/users`, {
    method: "POST", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: p.email, password: PASSWORD, phone: p.phone, email_confirm: true, phone_confirm: true }),
  });
  const body = await res.json();
  assert.ok(res.ok, `GoTrue admin/users: ${JSON.stringify(body)}`);
  p.id = body.id;
  await psql(`UPDATE public.users SET display_name = '${p.name}', avatar_url = 'verde', is_admin = ${p.admin ? "true" : "false"},
    default_payout_method = 'nequi', default_payout_account = '300${p.phone.slice(-7)}' WHERE id = '${p.id}'`);
}

/** Sesión real de GoTrue en cookies de @supabase/ssr (las mismas que pone el login). */
async function sessionCookies(p) {
  const jar = new Map();
  const client = createServerClient(SUPA, anonKey, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (list) => list.forEach(({ name, value }) => jar.set(name, value)) },
  });
  const { error } = await client.auth.signInWithPassword({ email: p.email, password: PASSWORD });
  assert.ifError(error);
  return [...jar].map(([name, value]) => ({ name, value, domain: "localhost", path: "/", sameSite: "Lax" }));
}

// PLAYWRIGHT_CHROMIUM: navegador ya instalado cuando la versión de Playwright no coincide (sin descargar).
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
async function contextFor(p, { width = 390, textZoom = false } = {}) {
  const context = await browser.newContext({
    viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: width < 700, hasTouch: width < 700,
    colorScheme: "dark", locale: "es-CO", timezoneId: "America/Bogota",
  });
  if (p) await context.addCookies(await sessionCookies(p));
  // Sin el splash de arranque (una vez por sesión, ~3 s): si no, tapa las capturas.
  await context.addInitScript(() => { try { sessionStorage.setItem("lp_splash_seen_v2", "1"); } catch {} });
  if (textZoom) {
    // Texto del teléfono al 200 % (lo que hace Android con «Tamaño de fuente»).
    await context.addInitScript(() => {
      const apply = () => {
        const style = document.createElement("style");
        style.textContent = "html{-webkit-text-size-adjust:200% !important;text-size-adjust:200% !important}";
        document.head.appendChild(style);
      };
      if (document.head) apply(); else document.addEventListener("DOMContentLoaded", apply);
    });
  }
  return context;
}

async function shot(page, name) {
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 1, `${name}: desborda ${overflow}px en horizontal`);
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
  console.log(`  captura ${name}.png`);
}

const log = (s) => console.log(`· ${s}`);

// app/(app)/loading.tsx hace streaming de todo el grupo (app): notFound() pinta la
// página 404 de Next con HTTP 200. Lo que importa es que no llegue ningún dato.
async function expectNotFound(page, url, mustNotContain) {
  await page.goto(url);
  await page.getByText(/could not be found|404/i).first().waitFor();
  const html = await page.content();
  for (const text of mustNotContain) assert.ok(!html.includes(text), `${url} filtró «${text}»`);
}

try {
  for (const p of Object.values(people)) await createUser(p);
  log("usuarios locales creados en GoTrue (admin, creadora, comprador)");

  // 1 · el admin habilita a la creadora desde /admin/rifas
  let ctx = await contextFor(people.admin);
  let page = await ctx.newPage();
  await page.goto(`${APP}/admin/rifas`);
  await page.getByLabel("Buscar por nombre o celular").fill(people.creator.name);
  const row = page.locator("li", { hasText: people.creator.name }).first();
  await row.getByRole("button", { name: "Habilitar" }).click();
  await row.getByText("Creador", { exact: true }).waitFor();
  assert.equal(await psql(`SELECT count(*) FROM public.rifa_creators WHERE user_id = '${people.creator.id}' AND revoked_at IS NULL
    AND granted_by = '${people.admin.id}'`), "1", "el permiso no quedó en la base con granted_by");
  await shot(page, "01-admin-creadores-390");
  await ctx.close();
  log("admin habilitó a la creadora");

  // 2 · Perfil de la creadora muestra «Crear mi rifa»; el comprador no
  ctx = await contextFor(people.creator);
  page = await ctx.newPage();
  await page.goto(`${APP}/perfil`);
  await page.getByRole("link", { name: "Crear mi rifa" }).waitFor();
  await page.getByRole("link", { name: "Crear mi rifa" }).scrollIntoViewIfNeeded();
  await shot(page, "02-perfil-crear-mi-rifa-390");
  const buyerCtx = await contextFor(people.buyer);
  const buyerPage = await buyerCtx.newPage();
  await buyerPage.goto(`${APP}/perfil`);
  await buyerPage.waitForLoadState("networkidle");
  assert.equal(await buyerPage.getByRole("link", { name: "Crear mi rifa" }).count(), 0, "un comprador sin permiso vio «Crear mi rifa»");
  await expectNotFound(buyerPage, `${APP}/rifas/crear`, ["Crear rifa", "¿Dónde recibes los pagos?"]);
  const apiCreate = await buyerPage.request.post(`${APP}/api/rifas`, { data: {
    name: "Intento", prizeKind: "texto", prizeCop: null, prizeText: "Algo", numberCount: 100, priceCop: 5000, lotteryName: "Chontico",
    digitsRule: "ultimas_dos", drawAt: "2030-01-01T22:30", visibility: "privada", paymentMethod: "nequi", paymentAccount: "3000000000", paymentHolder: "Comprador" } });
  assert.equal(apiCreate.status(), 403, "un usuario sin permiso no crea rifas por la API");
  log("«Crear mi rifa» solo para la creadora; sin permiso: 404 en la página y 403 en la API");

  // 3 · crear rifa (Privada por defecto)
  await page.goto(`${APP}/rifas/crear`);
  await shot(page, "03-crear-rifa-390");
  await page.getByLabel("Nombre", { exact: true }).fill("Boleta Sur clásico");
  await page.getByLabel("¿Qué se rifa?").fill("Boleta de Sur para el clásico");
  await page.getByLabel("Valor por número").fill("6000");
  await page.getByLabel("¿Con qué lotería se juega?").fill("Astro Sol");
  await page.getByLabel("Número de cuenta o celular").fill("3001234567");
  await page.getByRole("button", { name: "Crear rifa" }).click();
  await page.waitForURL(/\/rifa\/[a-z0-9]{8}\/gestionar$/);
  const slug = page.url().match(/\/rifa\/([a-z0-9]{8})\//)[1];
  log(`rifa creada: /rifa/${slug} (Privada)`);

  // 4 · Privada: el comprador no-admin recibe 404, también por la API
  await expectNotFound(buyerPage, `${APP}/rifa/${slug}`, ["Boleta Sur clásico", "Boleta de Sur para el clásico", "3001234567"]);
  assert.equal((await buyerPage.request.post(`${APP}/api/rifas/${slug}/reservar`, { data: { action: "reservar", numbers: [1] } })).status(), 404);
  log("Privada: comprador no-admin → 404 (página y API)");

  // 5 · el admin prueba la Privada: reserva 07 y 08 y sube el comprobante
  const adminCtx = await contextFor(people.admin);
  const adminPage = await adminCtx.newPage();
  await adminPage.goto(`${APP}/rifa/${slug}`);
  await adminPage.getByRole("button", { name: "07, libre" }).click();
  await adminPage.getByRole("button", { name: "08, libre" }).click();
  await shot(adminPage, "04-comprador-eligiendo-390");
  await adminPage.getByRole("button", { name: "Reservar", exact: true }).click();
  await adminPage.getByText("Transfiere exactamente").waitFor();
  await adminPage.getByText("$12.000").first().waitFor();
  await shot(adminPage, "05-comprador-reservado-transferir-390");
  const proofPng = await adminPage.screenshot({ clip: { x: 0, y: 0, width: 300, height: 400 } });
  writeFileSync(join(SHOTS, "comprobante-de-prueba.png"), proofPng);
  await adminPage.setInputFiles("#rifa-comprobante", join(SHOTS, "comprobante-de-prueba.png"));
  await adminPage.getByText("Tu comprobante está en revisión").waitFor({ timeout: 20000 });
  await shot(adminPage, "06-comprador-en-revision-390");
  log("admin (probando la Privada) reservó 07 y 08 por $12.000 (SQL) y subió el comprobante");

  // 6 · la creadora aprueba: 07 y 08 pagados
  await page.goto(`${APP}/rifa/${slug}/gestionar`);
  await page.getByText("Comprobantes por revisar").waitFor();
  await shot(page, "07-creador-comprobante-pendiente-390");
  const proofLink = await page.getByRole("link", { name: "Ver comprobante" }).getAttribute("href");
  assert.equal((await buyerPage.request.get(`${APP}${proofLink}`, { maxRedirects: 0 })).status(), 404, "un tercero vio el comprobante");
  assert.equal((await page.request.get(`${APP}${proofLink}`, { maxRedirects: 0 })).status(), 302, "la creadora no pudo ver el comprobante");
  await page.getByRole("button", { name: "Aprobar" }).click();
  await page.getByRole("button", { name: "07, pagado" }).waitFor();
  log("comprobante: solo creadora y dueño lo ven; la creadora aprobó → 07 y 08 pagados");

  // 7 · pasa a Pública; el comprador reserva el 10 y su reserva vence
  await page.getByRole("button", { name: "Hacer pública" }).click();
  await page.getByText("Pública: la abre cualquiera con el enlace.").waitFor();
  await buyerPage.goto(`${APP}/rifa/${slug}`);
  await buyerPage.getByRole("button", { name: "10, libre" }).click();
  await buyerPage.getByRole("button", { name: "Reservar", exact: true }).click();
  await buyerPage.getByText("Transfiere exactamente").waitFor();
  await psql(`UPDATE public.rifa_tickets SET expires_at = now() - interval '1 minute', reserved_at = now() - interval '31 minutes'
    WHERE rifa_id = (SELECT id FROM public.rifas WHERE slug = '${slug}') AND number = 10 AND state = 'reservado'`);
  await buyerPage.reload();
  await buyerPage.getByRole("button", { name: "10, libre" }).waitFor();
  log("reserva del 10 vencida: vuelve a libre sin cron");

  // 8 · venta por fuera del 20 (pagado)
  await page.reload();
  await page.getByRole("button", { name: "20, libre" }).click();
  await page.getByLabel("Nombre", { exact: true }).fill("Don Pedro");
  await page.locator("dialog input[type=tel]").fill("3001112233");
  await shot(page, "08-creador-venta-por-fuera-390");
  await page.getByRole("button", { name: "Marcar pagado" }).click();
  await page.getByRole("button", { name: "20, pagado" }).waitFor();
  await shot(page, "09-creador-tablero-390");
  log("venta por fuera del 20 (pagado)");

  // 9 · exportar imagen: dos plantillas
  for (const [name, query] of [["neutra", "plantilla=neutra"], ["club", "plantilla=club&club=verde"]]) {
    const res = await page.request.get(`${APP}/api/rifas/${slug}/historia?${query}`);
    assert.equal(res.status(), 200, `historia ${name}`);
    assert.equal(res.headers()["content-type"], "image/png");
    writeFileSync(join(SHOTS, `10-historia-${name}.png`), await res.body());
  }
  assert.equal((await buyerPage.request.get(`${APP}/api/rifas/${slug}/historia`)).status(), 403, "un comprador exportó la historia");
  log("historia 1080×1920 exportada con plantillas neutra y club (solo la creadora)");

  // 10 · visita sin sesión: ve el tablero y elegir lleva al registro
  const anonCtx = await contextFor(null);
  const anon = await anonCtx.newPage();
  const anonRes = await anon.goto(`${APP}/rifa/${slug}`);
  assert.equal(anonRes.status(), 200);
  await anon.getByRole("button", { name: "33, libre" }).click();
  await shot(anon, "11-visitante-sin-sesion-390");
  const cookies = await anonCtx.cookies();
  assert.ok(cookies.some((c) => c.name === "lp_rifa" && c.value.startsWith(`${slug}.`)), "falta la cookie lp_rifa del embudo");
  await anon.getByRole("link", { name: "Entrar para reservar" }).click();
  await anon.waitForURL(/\/login\?returnTo=%2Frifa%2F/);
  log("sin sesión: tablero visible, cookie lp_rifa puesta y elegir lleva a /login con returnTo");

  // 11 · resultado: después del sorteo, el 07 gana
  await psql(`UPDATE public.rifas SET draw_at = now() - interval '1 minute' WHERE slug = '${slug}'`);
  await page.reload();
  await page.waitForLoadState("networkidle");
  // Escribir antes de que React hidrate deja el estado vacío: reintentar hasta que el botón se habilite.
  const save = page.getByRole("button", { name: "Guardar resultado" });
  for (let i = 0; i < 20 && !(await save.isEnabled()); i++) {
    await page.getByLabel(/Número que salió/).fill("07");
    await page.waitForTimeout(250);
  }
  await save.click();
  await page.getByText("Número ganador").waitFor();
  await shot(page, "12-creador-resultado-390");
  await adminPage.reload();
  await adminPage.getByText("Es tuyo. Ganaste.").waitFor();
  log("resultado: 07 ganador; el comprador lo ve");

  // 12 · capturas por ancho y con texto al 200 %
  for (const width of [320, 390, 768]) {
    const c = await contextFor(people.buyer, { width });
    const pg = await c.newPage();
    await pg.goto(`${APP}/rifa/${slug}`);
    await shot(pg, `20-comprador-${width}`);
    await pg.goto(`${APP}/inicio?tab=rifas`);
    await shot(pg, `21-pestana-rifas-${width}`);
    await c.close();
    const cc = await contextFor(people.creator, { width });
    const cp = await cc.newPage();
    await cp.goto(`${APP}/rifa/${slug}/gestionar`);
    await shot(cp, `22-creador-${width}`);
    await cc.close();
  }
  const zoom = await contextFor(people.buyer, { width: 320, textZoom: true });
  const zp = await zoom.newPage();
  await zp.goto(`${APP}/rifa/${slug}`);
  await shot(zp, "30-comprador-320-texto-200");
  await zp.goto(`${APP}/inicio?tab=rifas`);
  await shot(zp, "31-pestana-rifas-320-texto-200");
  const zc = await contextFor(people.creator, { width: 320, textZoom: true });
  const zcp = await zc.newPage();
  await zcp.goto(`${APP}/rifa/${slug}/gestionar`);
  await shot(zcp, "32-creador-320-texto-200");
  log("capturas 320/390/768 y 320 con texto al 200 %: sin desbordes horizontales");

  console.log(`rifas-e2e-local: OK · capturas en ${SHOTS}`);
} finally {
  await browser.close();
}
