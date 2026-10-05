// Browser regression with the real React boards and synthetic requests only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const repo = fileURLToPath(new URL('..', import.meta.url));
const staticDir = path.join(repo, '.next/static');
const cssDir = path.join(staticDir, 'css');
assert.ok(fs.existsSync(cssDir), 'Run npm run build before the browser check.');
const cssFiles = fs.readdirSync(cssDir).filter(f => f.endsWith('.css'));
const css = cssFiles.map(f => fs.readFileSync(path.join(cssDir, f), 'utf8')).join('\n');
const fontBody = css.match(/--font-body:([^;}]+)/)?.[1];
const fontDisplay = css.match(/--font-display:([^;}]+)/)?.[1];
assert.ok(fontBody && fontDisplay, 'The build must contain the real font variables.');
const downloads = path.join(os.homedir(), 'Downloads');
fs.mkdirSync(downloads, { recursive: true });
const root = fs.mkdtempSync(path.join(downloads, 'la-polla-draft-browser-'));
const artifacts = process.env.BROWSER_ARTIFACT_DIR ?? path.join(downloads, 'agent-work/la-polla-browser-check');
fs.mkdirSync(artifacts, { recursive: true });
fs.symlinkSync(path.join(repo, 'node_modules'), path.join(root, 'node_modules'), 'junction');
fs.writeFileSync(path.join(root, 'index.html'), `<html lang="es"><head><title>Casa regression fixture</title><meta name="viewport" content="width=device-width,initial-scale=1">${cssFiles.map(f => `<link rel="stylesheet" href="/_next/static/css/${f}">`).join('')}<style>:root{--font-body:${fontBody};--font-display:${fontDisplay}}body{font-family:var(--font-body)}</style></head><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>`);
fs.writeFileSync(path.join(root, 'navigation.ts'), 'const router={refresh(){},push(){}};export const useRouter=()=>router;');
fs.writeFileSync(path.join(root, 'link.tsx'), 'export default function Link({children,...props}:any){return <a {...props}>{children}</a>;}');
fs.writeFileSync(path.join(root, 'main.tsx'), `
import {createRoot} from 'react-dom/client';
import {PicksBoard} from '@/components/casa/PicksBoard';
import {QuestionsBoard} from '@/components/casa/QuestionsBoard';
import {CrearPollaForm} from '@/components/casa/CrearPollaForm';
import {UnirmeGratis} from '@/components/casa/UnirmeGratis';
import {ToastProvider} from '@/components/ui/Toast';
const mode=new URLSearchParams(location.search).get('mode');
const match={id:'m',home_team:'Millonarios',away_team:'Junior',home_team_flag:null,away_team_flag:null,scheduled_at:mode==='provisional'?'2020-01-01T00:00:00Z':'2099-01-01T18:00:00Z',scheduled_at_confirmed:mode!=='provisional',status:'scheduled',home_score:null,away_score:null,final_verified_at:null};
const content=mode==='creator'?<CrearPollaForm/>:mode==='free'?<UnirmeGratis slug="fixture" nombre="Polla regalo del campeonato colombiano" premio="Una camiseta oficial del equipo ganador"/>:mode==='questions'?
<QuestionsBoard slug="fixture" questions={[{id:'q',prompt:'¿Quién será el primer goleador del campeonato colombiano?',points:3,input_kind:'texto',resolved_at:null,resolved_text:null}]} initialPicks={{}} distribution={{}} canEdit/>:
<PicksBoard slug="fixture" scoringMode="marcador" matches={[match]} initialPicks={{}} distribution={{}} canEdit canViewOthers={false}/>;
createRoot(document.getElementById('root')!).render(<ToastProvider><main className="mx-auto max-w-3xl px-4 py-6"><h1 className="lp-display-sm mb-4">{mode==='creator'?'Crear polla':mode==='free'?'Polla regalo':'Pronósticos'}</h1>{content}</main></ToastProvider>);
`);
const server = await createServer({
  root, publicDir: path.join(repo, 'public'), configFile: false, logLevel: 'error', cacheDir: path.join(root, '.cache'),
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: { alias: { '@': repo, 'next/navigation': path.join(root, 'navigation.ts'), 'next/link': path.join(root, 'link.tsx') }, dedupe: ['react', 'react-dom'] },
  plugins: [{ name: 'built-static', configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      if (!req.url?.startsWith('/_next/static/')) return next();
      const file = path.resolve(staticDir, decodeURIComponent(req.url.split('?')[0].slice('/_next/static/'.length)));
      if (!file.startsWith(`${staticDir}${path.sep}`) || !fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
      res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream');
      fs.createReadStream(file).pipe(res);
    });
  } }],
  server: { host: '127.0.0.1', port: 3197, strictPort: true, fs: { allow: [root, repo] } },
});
let browser;
const probes = [];
const requestedModes = process.argv.slice(2);
const allModes = ['matches', 'provisional', 'questions', 'free', 'creator'];
assert.ok(requestedModes.every(mode => allModes.includes(mode)), 'Unknown fixture mode');
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const mode of requestedModes.length ? requestedModes : allModes) {
    const context = await browser.newContext({ viewport: { width: 320, height: 900 }, colorScheme: 'dark', reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let release;
    const sent = [];
    let joined = 0;
    await page.route('**/api/casa/pollas/fixture/unirme', async route => {
      joined++;
      assert.equal(route.request().method(), 'POST');
      assert.deepEqual(route.request().postDataJSON(), {});
      await route.fulfill({ json: { ok: true, entry_id: 'entry', created: true } });
    });
    await page.route('**/api/casa/admin/**', async route => {
      const url = new URL(route.request().url());
      const today = new Date().toISOString().slice(0, 10);
      const json = url.pathname.endsWith('/matches') ? { matches: [{ id:'provisional', home_team:'Millonarios', away_team:'Junior', home_team_flag:null, away_team_flag:null, scheduled_at:today+'T00:00:00Z', scheduled_at_confirmed:false }], ventanaDias:10 } : url.pathname.endsWith('/prize-preview') ? { prizeCop:0 } : { pollas:[] };
      await route.fulfill({ json });
    });
    await page.route('**/api/casa/pollas/fixture/picks', async route => {
      sent.push(route.request().postDataJSON());
      if (sent.length === 1) await new Promise(resolve => { release = resolve; });
      await route.fulfill({ json: { ok: true } });
    });
    await page.goto(`http://127.0.0.1:3197/?mode=${mode}`);
    if (mode === 'creator') {
      await page.getByLabel('Buscar equipo', { exact: true }).fill('Millonarios');
      await page.getByRole('button', { name: /Millonarios vs Junior, hora por confirmar/ }).click();
      await expect(page.getByRole('group', { name: /^Cierre de respaldo/ })).toBeVisible();
      await expect(page.getByText(/Los pronósticos siguen abiertos/)).toBeVisible();
    } else if (mode === 'free') {
      await expect(page.getByRole('button', { name:'Entrar gratis', exact:true })).toBeVisible();
      assert.equal(await page.locator('input[type="file"]').count(), 0);
      assert.equal(await page.getByText(/Transferir|Subir comprobante|Esperando aprobación/).count(), 0);
    } else {
    const input = page.locator('input').first();
    const save = page.getByRole('button', { name: /Guardar/ });
    await input.fill(mode !== 'questions' ? '1' : 'A');
    if (mode !== 'questions') await page.locator('input').nth(1).fill('0');
    await save.click();
    await expect.poll(() => Boolean(release)).toBe(true);
    await input.fill(mode !== 'questions' ? '2' : 'B');
    release();
    await expect(page.getByText('Guardamos el envío anterior. Tienes cambios nuevos sin guardar.')).toBeVisible();
    await expect(save).toBeEnabled();
    await expect(page.locator('[data-app-update-blocked]')).toHaveAttribute('data-app-update-blocked', 'true');
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({path:path.join(artifacts,`pending-${mode}-320.png`),fullPage:true});
    const first = sent[0].picks[0];
    assert.equal(mode !== 'questions' ? first.homeScore : first.freeText, mode !== 'questions' ? 1 : 'A');
    await save.click();
    await expect(page.locator('[data-app-update-blocked]')).toHaveAttribute('data-app-update-blocked', 'false');
    assert.equal(mode !== 'questions' ? sent[1].picks[0].homeScore : sent[1].picks[0].freeText, mode !== 'questions' ? 2 : 'B');
    assert.deepEqual(errors, []);
    console.log(`PASS ${mode}: held response acknowledges A, leaves B pending, then saves B`);
    }
    await page.evaluate(() => document.fonts.ready);
    for (const width of [320, 639, 640, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const zoom of [1, 2]) {
        await page.evaluate(scale => {
          const nodes = [...document.querySelectorAll('main, main *')];
          const sizes = nodes.map(el => Number(el.getAttribute('data-original-font-size')) || parseFloat(getComputedStyle(el).fontSize));
          nodes.forEach((el, i) => { el.setAttribute('data-original-font-size', String(sizes[i])); el.style.fontSize = sizes[i] * scale + 'px'; });
        }, zoom);
        const probe = await page.evaluate(() => {
          const main = document.querySelector('main');
          const button = main.querySelector('button');
          const heading = main.querySelector('h1');
          const body = getComputedStyle(button);
          const display = getComputedStyle(heading);
          return { overflow:document.documentElement.scrollWidth > innerWidth, bodyFont:body.fontFamily, bodySize:body.fontSize, bodyWeight:body.fontWeight, displayFont:display.fontFamily, fontsLoaded:document.fonts.check(`600 15px ${body.fontFamily.split(',')[0]}`), hiddenEssential:[...main.querySelectorAll('button, label')].filter(el=>getComputedStyle(el).display!=='none' && !(el.closest('details:not([open])') && !el.closest('summary')) && el.getBoundingClientRect().width===0).map(el=>({text:el.textContent,class:el.className})) };
        });
        probes.push({mode,width,zoom,...probe});
        assert.equal(probe.overflow, false, JSON.stringify(probes.at(-1)));
        assert.deepEqual(probe.hiddenEssential, []);
        assert.ok(/outfit/i.test(probe.bodyFont));
        assert.ok(/bebas/i.test(probe.displayFont));
        assert.equal(probe.fontsLoaded, true);
        await page.screenshot({path:path.join(artifacts,`${mode}-${width}-${zoom}x.png`),fullPage:true});
        if (mode === 'creator') {
          await page.getByRole('group', { name: /^Cierre de respaldo/ }).scrollIntoViewIfNeeded();
          await page.screenshot({path:path.join(artifacts,`closure-${width}-${zoom}x.png`)});
        }
      }
    }
    if (mode === 'free') {
      await page.getByRole('button', {name:'Entrar gratis',exact:true}).click();
      await expect(page.getByRole('button', {name:'Ya estás dentro',exact:true})).toBeDisabled();
      assert.equal(joined, 1);
    }
    await page.evaluate(() => document.querySelectorAll('[data-original-font-size]').forEach(el=>el.style.fontSize=el.getAttribute('data-original-font-size')+'px'));
    const {violations} = await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();
    assert.deepEqual(violations.filter(v=>['critical','serious'].includes(v.impact)).map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);
    assert.deepEqual(errors, []);
    console.log(`PASS ${mode}: interaction, CSS/fonts, five widths, 200% text, axe`);
    await context.close();
  }
  fs.writeFileSync(path.join(artifacts,'probes.json'),JSON.stringify(probes,null,2));
  console.log(`Browser evidence: ${artifacts}`);
} finally {
  await browser?.close();
  await server.close();
  assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(downloads));
  fs.rmSync(root, { recursive: true });
}
