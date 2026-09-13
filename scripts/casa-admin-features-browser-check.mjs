// Creation/publication/payment regression with real LOCAL endpoints and storage.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { createLocalBrowserActor, localDb, localSql, sqlQuote as q } from "./casa-local-browser-helpers.mjs";

const origin = process.env.CASA_ORIGIN ?? "http://localhost:3191";
const output = "C:/Users/STZTR/Downloads/la-polla-mejoras-2026-09-13/browser";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const captures = [];
let inspectedPage;
async function screen(page, name, widths = [320, 639, 641, 768, 1440]) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${output}/${name}-${width}.png`, fullPage: true });
    const metrics = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
      font: getComputedStyle(document.body).fontFamily, faces: [...document.fonts].map(f => ({ family: f.family, status: f.status })),
      overflow: [...document.querySelectorAll("button, input, p")].filter(el => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().right > innerWidth + 1 && !el.closest('header')).map(el => ({ tag: el.tagName, text: el.textContent?.slice(0,60) })) }));
    captures.push({ name, ...metrics });
    assert.ok(metrics.scroll <= width + 1, `${name}/${width} overflow: ${JSON.stringify(metrics)}`);
  }
}
async function zoom(page, name) {
  await page.setViewportSize({ width: 320, height: 1000 });
  await page.evaluate(() => { const sizes = [...document.querySelectorAll("body *")].map(el => [el,parseFloat(getComputedStyle(el).fontSize)]); for (const [el,size] of sizes) el.style.setProperty("font-size",`${size*2}px`,"important"); });
  await page.screenshot({ path: `${output}/${name}-zoom200.png`, fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} overflow at 200% text`);
}
async function api(actor, path, data, method="POST", expected=200) {
  const response = await actor.context.request.fetch(origin+path, { method, headers: { "X-Casa-Contract":"2" }, data });
  const body = await response.json(); assert.equal(response.status(), expected, `${path}: ${JSON.stringify(body)}`); return body;
}
try {
  const admin=await createLocalBrowserActor(browser,{name:"Administrador prueba local",admin:true});
  const oldest=await createLocalBrowserActor(browser,{name:"Primera transferencia local"});
  const newest=await createLocalBrowserActor(browser,{name:"Transferencia más reciente local"});
  const name=`Pozo fijo prueba ${randomUUID().slice(0,8)}`;
  const page=admin.page;
  inspectedPage=page;
  page.setDefaultTimeout(30000); page.setDefaultNavigationTimeout(90000);
  await page.goto(`${origin}/admin/pollas/crear`,{waitUntil:"networkidle"});
  await page.getByRole("button",{name:"Manual",exact:true}).click();
  await page.getByPlaceholder("Fecha 5 · Premier",{exact:true}).fill(name);
  await page.getByLabel("Premio garantizado (COP)",{exact:true}).fill("1000000");
  const cut=page.locator('input[type=number][max="100"]');
  assert.equal(await cut.inputValue(),"0");
  // Migration 109: the percentage and the prize selector are independent choices.
  await cut.fill("50");
  assert.equal(await page.getByRole("button",{name:"Pozo fijo",exact:true}).getAttribute("aria-pressed"),"true");
  await page.getByRole("button",{name:"Pozo proporcional",exact:true}).click();
  assert.equal(await cut.inputValue(),"50");
  await page.getByRole("button",{name:"Pozo fijo",exact:true}).click();
  assert.equal(await cut.inputValue(),"50");
  await page.getByText("Premio garantizado de $1.000.000. Se cubre con 100 inscritos; desde el inscrito 101, cada entrada suma $5.000 al pozo y $5.000 a la casa.",{exact:true}).waitFor();
  await page.getByPlaceholder("300 123 4567",{exact:true}).fill("3000000000");
  await page.getByPlaceholder("A nombre de...",{exact:true}).fill("Cuenta ficticia local");
  await page.getByRole("button",{name:"Fecha manual",exact:true}).last().click();
  await page.locator('input[type=date]').nth(0).fill("2030-09-22");
  await page.locator('input[type=time]').nth(0).fill("18:30");
  await page.locator('input[type=date]').nth(1).fill("2030-09-20");
  await page.locator('input[type=time]').nth(1).fill("09:15");
  await page.getByPlaceholder("¿Quién mete el primer gol?",{exact:true}).fill("¿Cuál es la respuesta correcta de prueba?");
  await page.getByPlaceholder("Opción 1",{exact:true}).fill("Primera opción");
  await page.getByPlaceholder("Opción 2",{exact:true}).fill("Segunda opción");
  await screen(page,"crear-programada");
  await zoom(page,"crear-programada");
  // Undo only this test's temporary font probes without reloading the draft.
  await page.evaluate(()=>{for(const el of document.querySelectorAll("body *"))el.style.removeProperty("font-size");});
  await page.getByRole("button",{name:"Programar publicación",exact:true}).click();
  await page.getByText(/Publicación programada:/).waitFor();
  const result=await localDb.from("casa_pollas").select("id,slug,pot_mode,fixed_prize_cop,house_cut_pct,opens_at,closes_at").eq("name",name).single();
  assert.ifError(result.error); const polla=result.data;
  assert.equal(polla.opens_at,"2030-09-20T14:15:00+00:00");
  assert.equal(polla.closes_at,"2030-09-22T23:30:00+00:00");
  assert.equal(polla.pot_mode,"fijo"); assert.equal(polla.fixed_prize_cop,1000000); assert.equal(polla.house_cut_pct,50);
  const hidden=await oldest.context.request.get(`${origin}/casa/${polla.slug}`);
  const hiddenHtml=await hidden.text();
  // Next can stream the shell before notFound: the generic page is a soft 404.
  assert.ok([200,404].includes(hidden.status())); assert.ok(!hiddenHtml.includes(name)); assert.match(hiddenHtml,/noindex/);
  await api(oldest,`/api/casa/pollas/${polla.slug}/join`,{action:"begin",requestId:randomUUID(),ticketNumber:null,sha256:"a".repeat(64),contentType:"image/png",bytes:64},"POST",404);
  const balance=localSql(`SELECT house_cop FROM casa_pot_summaries_v2(ARRAY[${q(polla.id)}::uuid]);`);
  assert.equal(balance,"0","an unpublished scheduled fixed pool must not subtract its prize from the house balance");
  console.log("PASS create real form, Berlin browser -> Bogotá dates, guaranteed minimum with 50% house cut, scheduled privacy");
  await page.goto(`${origin}/admin/pollas`,{waitUntil:"domcontentloaded"});
  const card=page.locator("li").filter({has:page.locator('button[id^="polla-toggle-"]').filter({hasText:name})});
  await page.waitForFunction((id) => { const button=document.getElementById(`polla-toggle-${id}`); return button && Object.keys(button).some(key=>key.startsWith("__reactProps$") && button[key]?.onClick); },polla.id);
  await card.locator('button[id^="polla-toggle-"]').click();
  await card.getByRole("button",{name:"Publicar ahora",exact:true}).click();
  await page.waitForTimeout(900);
  const visible=await oldest.context.request.get(`${origin}/casa/${polla.slug}`);
  assert.equal(visible.status(),200);
  console.log("PASS scheduled pool can be published from admin");
  for(const actor of [oldest,newest]) {
    // networkidle: a file chosen before hydration never reaches React and the submit stays disabled.
    await actor.page.goto(`${origin}/casa/${polla.slug}/pagar`,{waitUntil:"networkidle",timeout:90000});
    await actor.page.getByText(/con un premio mínimo garantizado de \$1\.000\.000\. Cuando las entradas superan ese mínimo, el 50% de cada nueva entrada se suma al pozo\./).waitFor();
    const png=await actor.page.evaluate(()=>{const c=document.createElement("canvas");c.width=500;c.height=180;const x=c.getContext("2d");x.fillStyle="white";x.fillRect(0,0,500,180);x.fillStyle="black";x.font="22px sans-serif";x.fillText("COMPROBANTE LOCAL DE PRUEBA",10,90);return c.toDataURL("image/png").split(",")[1];});
    await actor.page.locator('input[type=file]').setInputFiles({name:"prueba-local.png",mimeType:"image/png",buffer:Buffer.from(png,"base64")});
    await actor.page.getByRole("button",{name:"Enviar el comprobante",exact:true}).click();
    await actor.page.getByText("Pago registrado",{exact:true}).waitFor({timeout:60000});
  }
  await page.goto(`${origin}/admin/pollas/recibos?pollaId=${polla.id}`,{waitUntil:"domcontentloaded"});
  await page.getByRole("button",{name:"Aprobar el pago de Transferencia más reciente local",exact:true}).waitFor();
  const rows=await page.locator("li").filter({has:page.getByRole("button",{name:/Aprobar el pago de/})}).allTextContents();
  assert.ok(rows[0].includes("Transferencia más reciente local"));
  await screen(page,"recibos-pendientes",[320,768,1440]);
  await page.getByRole("button",{name:"Aprobar el pago de Transferencia más reciente local",exact:true}).click();
  await page.getByRole("button",{name:"Aprobar el pago de Transferencia más reciente local",exact:true}).waitFor({state:"detached"});
  await page.getByRole("link",{name:"Pagos aprobados",exact:true}).click();
  await page.getByRole("button",{name:"Desmarcar como pagado",exact:true}).waitFor();
  assert.ok(!(await page.locator("body").innerText()).includes("Primera transferencia local"));
  await page.getByRole("button",{name:"Desmarcar como pagado",exact:true}).click();
  await page.getByLabel("Motivo de la corrección",{exact:true}).fill("Comprobante aprobado por error en prueba local");
  await screen(page,"pagos-correccion",[320,768,1440]);
  await zoom(page,"pagos-correccion");
  await page.getByRole("button",{name:"Confirmar corrección",exact:true}).click();
  await page.getByText("Todavía no hay pagos aprobados",{exact:true}).waitFor();
  await page.getByRole("link",{name:"Recibos pendientes",exact:true}).click();
  await page.getByRole("button",{name:"Aprobar el pago de Transferencia más reciente local",exact:true}).waitFor();
  const entry=await localDb.from("casa_entries").select("id,status,proof_path,current_proof_attempt_id").eq("polla_id",polla.id).eq("user_id",newest.id).single();
  assert.ifError(entry.error);assert.equal(entry.data.status,"pendiente");assert.ok(entry.data.proof_path);
  const audit=localSql(`SELECT count(*) FROM casa_payment_corrections WHERE entry_id=${q(entry.data.id)};`);
  assert.equal(audit,"1");
  await screen(page,"recibos-devuelto",[320]);
  console.log("PASS real proof upload, newest first, approve removes pending, correction restores pending with immutable proof/audit");
  await writeFile(`${output}/fixtures.json`,JSON.stringify({polla,adminId:admin.id,oldestId:oldest.id,newestId:newest.id,captures},null,2));
} catch (error) {
  console.error(error);
  if(inspectedPage) { await inspectedPage.screenshot({path:`${output}/failure.png`,fullPage:true}).catch(()=>{}); await writeFile(`${output}/failure.txt`,await inspectedPage.locator("body").innerText({timeout:5000}).catch(()=>String(error))); }
  throw error;
} finally { await writeFile(`${output}/metrics.json`,JSON.stringify(captures,null,2));await browser.close(); }
