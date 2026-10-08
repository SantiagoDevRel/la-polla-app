// Real React components, built CSS/fonts and an isolated synthetic HTTP journal.
// This checks the browser contract; test:casa:sql checks the real SQL writer.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium, webkit, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const repo = fileURLToPath(new URL('..', import.meta.url));
const staticDir = path.resolve(process.env.BROWSER_STATIC_DIR ?? path.join(repo, '.next/static'));
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
const artifacts = path.resolve(process.env.BROWSER_ARTIFACT_DIR ?? path.join(downloads, 'agent-work/la-polla-browser-check'));
fs.mkdirSync(artifacts, { recursive: true });
const ids = {
  owner: '10000000-0000-4000-8000-000000000001', ownerB: '10000000-0000-4000-8000-000000000002',
  entry: '20000000-0000-4000-8000-000000000001', entryB: '20000000-0000-4000-8000-000000000002',
  match: '30000000-0000-4000-8000-000000000001', match2: '30000000-0000-4000-8000-000000000002',
  question: '40000000-0000-4000-8000-000000000001', question2: '40000000-0000-4000-8000-000000000002',
  option: '50000000-0000-4000-8000-000000000001',
};
const allModes = ['matches', 'outcomes', 'provisional', 'questions', 'free', 'creator'];
const modes = process.argv.slice(2).length ? process.argv.slice(2) : allModes;
assert.ok(modes.every(mode => allModes.includes(mode)), 'Unknown fixture mode');
const selectedCases = new Set((process.env.BROWSER_CASES ?? '').split(',').filter(Boolean));
const evidence = { source: 'real React with synthetic HTTP only', staticDir, modes, selectedCases: [...selectedCases], cases: [], probes: [], axe: [] };
const port = Number(process.env.BROWSER_FIXTURE_PORT ?? 3197);
fs.symlinkSync(path.join(repo, 'node_modules'), path.join(root, 'node_modules'), 'junction');
fs.writeFileSync(path.join(root, 'index.html'), `<html lang="es"><head><title>Casa regression fixture</title><meta name="viewport" content="width=device-width,initial-scale=1">${cssFiles.map(f => `<link rel="stylesheet" href="/_next/static/css/${f}">`).join('')}<style>:root{--font-body:${fontBody};--font-display:${fontDisplay}}body{font-family:var(--font-body)}</style></head><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>`);
fs.writeFileSync(path.join(root, 'navigation.ts'), 'const router={refresh(){(window as any).__refreshCount=((window as any).__refreshCount??0)+1;},push(url:string){(window as any).__navigation=url;}};export const useRouter=()=>router;');
fs.writeFileSync(path.join(root, 'link.tsx'), 'export default function Link({children,...props}:any){return <a {...props}>{children}</a>;}');
fs.writeFileSync(path.join(root, 'main.tsx'), `
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PicksBoard} from '@/components/casa/PicksBoard';
import {QuestionsBoard} from '@/components/casa/QuestionsBoard';
import {CrearPollaForm} from '@/components/casa/CrearPollaForm';
import {UnirmeGratis} from '@/components/casa/UnirmeGratis';
import {ToastProvider} from '@/components/ui/Toast';
const ids=${JSON.stringify(ids)};
const params=new URLSearchParams(location.search), mode=params.get('mode'), scenario=params.get('case');
const loadedAt=Date.now();
const multiple=['closed','incomplete','rebase','restore-fresh','touch','autojump'].includes(scenario);
const initialPicks=['rebase','restore-fresh'].includes(scenario)?{[mode==='questions'?ids.question2:ids.match2]:{pick1x2:null,homeScore:mode==='questions'?null:1,awayScore:mode==='questions'?null:0,optionId:null,freeText:mode==='questions'?'Respuesta inicial':null}}:{};
function App(){
 const [state,setState]=useState({ownerId:ids.owner,entryId:ids.entry,mount:0,closed:false,initialPicks,initialRevision:0});
 (window as any).__fixture={remount:(ownerId=state.ownerId,entryId=state.entryId,snapshot={})=>setState(s=>({...s,...snapshot,ownerId,entryId,mount:s.mount+1})),closeFirst:()=>setState(s=>({...s,closed:true}))};
 const common={slug:'fixture',ownerId:state.ownerId,entryId:state.entryId,entryNumber:1,initialRevision:state.initialRevision,initialPicks:state.initialPicks,distribution:{},canEdit:true};
 const match={id:ids.match,home_team:'Millonarios',away_team:'Junior',home_team_flag:null,away_team_flag:null,scheduled_at:mode==='provisional'?'2020-01-01T00:00:00Z':new Date(loadedAt+(scenario==='closed'?310000:86400000)).toISOString(),scheduled_at_confirmed:mode!=='provisional',status:'scheduled',home_score:null,away_score:null,final_verified_at:null};
 const matches=multiple?[match,{...match,id:ids.match2,home_team:'Atlético Nacional',away_team:'Deportivo Cali',scheduled_at:new Date(loadedAt+86400000).toISOString()}]:[match];
 const question={id:ids.question,prompt:'¿Quién será el primer goleador del campeonato colombiano?',points:3,input_kind:'texto' as const,resolved_at:state.closed?new Date().toISOString():null,resolved_text:state.closed?'Respuesta oficial':null};
 const questions=multiple?[question,{...question,id:ids.question2,prompt:'¿Quién dará la primera asistencia?',resolved_at:null,resolved_text:null}]:scenario==='options'?[{...question,input_kind:'opciones' as const,options:[{id:ids.option,label:'Un jugador con un nombre largo del equipo Millonarios que anota durante el segundo tiempo del partido'}]}]:[question];
 const content=mode==='creator'?<CrearPollaForm/>:mode==='free'?<UnirmeGratis slug="fixture" ownerId={state.ownerId} nombre="Polla regalo del campeonato colombiano" premio="Una camiseta oficial del equipo ganador"/>:mode==='questions'?<QuestionsBoard {...common} key={state.ownerId+state.entryId+state.mount} questions={questions}/>:<PicksBoard {...common} key={state.ownerId+state.entryId+state.mount} scoringMode={mode==='outcomes'?'1x2':'marcador'} matches={matches} canViewOthers={false}/>;
 return <ToastProvider><main className="mx-auto max-w-3xl px-4 py-6"><h1 className="lp-display-sm mb-4">{mode==='creator'?'Crear polla':mode==='free'?'Polla regalo':'Pronósticos'}</h1>{content}</main></ToastProvider>;
}
createRoot(document.getElementById('root')!).render(<App/>);
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
  server: { host: '127.0.0.1', port, strictPort: true, fs: { allow: [root, repo] } },
});
let browser;
const jsonHeaders = { 'Cache-Control': 'private, no-store' };
const clone = value => JSON.parse(JSON.stringify(value));
const normal = p => ({ pick1x2:p.pick1x2??null, homeScore:p.homeScore??null, awayScore:p.awayScore??null, optionId:p.optionId??null, freeText:p.freeText?.trim()||null });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Independent wire fixture: mutations use compare-and-set and replay identity.
// It does not import the client validator or hook under test.
function journal(mode,scenario) {
  const state = { entryId:ids.entry, ownerId:ids.owner, revision:0, picks:{}, lastResult:null };
  if(['rebase','restore-fresh'].includes(scenario)) state.picks[mode==='questions'?ids.question2:ids.match2]=normal(mode==='questions'?{freeText:'Respuesta inicial'}:{homeScore:1,awayScore:0});
  return {
    state, sent:[], reads:[], closed:new Set(), authenticated:true, ownerId:ids.owner,
    lastInput:null, behavior:null, held:null, joined:0, freeJoined:false,
    commit(op) {
      assert.match(op.requestId, uuid);
      assert.equal(op.entryId, ids.entry);
      assert.equal(op.entryNumber, 1);
      assert.ok(Number.isSafeInteger(op.expectedRevision));
      assert.ok(Array.isArray(op.picks) && op.picks.length);
      if (state.lastResult?.requestId === op.requestId) {
        if (JSON.stringify(this.lastInput) !== JSON.stringify(op)) return {status:409,json:{ok:false,error:'La solicitud ya se usó con otro contenido.'}};
        return {status:200,json:clone(state.lastResult)};
      }
      if (op.expectedRevision !== state.revision) return {status:409,json:{ok:false,revision:state.revision,error:'Hay pronósticos más recientes. Revisa tus cambios antes de volver a guardar.'}};
      const results = op.picks.map(p => {
        const targetId = p.matchId ?? p.questionId;
        assert.ok([ids.match,ids.match2,ids.question,ids.question2].includes(targetId));
        const values = normal(p);
        const error = this.closed.has(targetId) ? 'Este pronóstico cerró antes de guardarse.'
          : mode==='questions' ? (!values.optionId && !values.freeText ? 'Completa esta respuesta antes de guardar.' : null)
          : mode==='outcomes' ? (!['L','E','V'].includes(values.pick1x2) ? 'Completa este pronóstico antes de guardar.' : null)
            : values.homeScore===null || values.awayScore===null ? 'Completa este pronóstico antes de guardar.' : null;
        if (error) return {targetId,status:'rejected',error};
        state.picks[targetId]=values;
        return {targetId,status:'saved',values};
      });
      const ack={ok:true,requestId:op.requestId,revision:state.revision+1,guardados:results.filter(r=>r.status==='saved').length,avisos:results.filter(r=>r.error).map(r=>r.error),results};
      state.revision=ack.revision; state.lastResult=clone(ack); this.lastInput=clone(op);
      return {status:200,json:ack};
    },
    externalWrite(values,targetId=mode==='questions'?ids.question:ids.match) {
      state.picks[targetId]=normal(values);
      state.revision++; state.lastResult=null; this.lastInput=null;
    },
  };
}
async function fixture(mode, scenario='') {
  const touch=['touch','autojump'].includes(scenario);
  const context=await browser.newContext({viewport:{width:320,height:900},colorScheme:'dark',reducedMotion:'reduce',hasTouch:touch,isMobile:touch});
  const page=await context.newPage();
  // Install before the component creates its interval, so closure uses real UI time.
  if(['closed','autojump'].includes(scenario)) await page.clock.install();
  // Installation alone keeps wall time running; freeze it for 299/300 ms checks.
  if(scenario==='autojump') await page.clock.pauseAt(new Date(Date.now()+60_000));
  const errors=[]; const unexpected=[]; const store=journal(mode,scenario);
  page.on('pageerror', error=>errors.push(error.message));
  await page.route('**/api/**', async route=>{
    unexpected.push({method:route.request().method(),url:route.request().url()});
    await route.fulfill({status:500,json:{error:'Unexpected synthetic endpoint'}});
  });
  await page.route('**/api/casa/admin/**', async route=>{
    const url=new URL(route.request().url());
    const today=new Date().toISOString().slice(0,10);
    const json=url.pathname.endsWith('/matches')?{matches:[{id:ids.match,home_team:'Millonarios',away_team:'Junior',home_team_flag:null,away_team_flag:null,scheduled_at:today+'T00:00:00Z',scheduled_at_confirmed:false}],ventanaDias:10}:url.pathname.endsWith('/prize-preview')?{prizeCop:0}:{pollas:[]};
    await route.fulfill({json,headers:jsonHeaders});
  });
  await page.route('**/api/casa/pollas/fixture/unirme', async route=>{
    if (route.request().method()==='GET') {
      await route.fulfill({json:{ok:true,owner_id:store.ownerId,slug:'fixture',joined:store.freeJoined,entry:store.freeJoined?{entry_id:ids.entry,entry_number:1,status:'pagada'}:null},headers:jsonHeaders}); return;
    }
    assert.equal(route.request().method(),'POST');
    assert.equal(route.request().headers()['x-casa-owner'],ids.owner);
    assert.deepEqual(route.request().postDataJSON(),{});
    store.joined++; store.freeJoined=true;
    if(store.behavior==='drop') {await route.abort('failed');return;}
    await route.fulfill({json:{ok:true,owner_id:store.ownerId,slug:'fixture',entry_id:ids.entry,entry_number:1,created:true},headers:jsonHeaders});
  });
  await page.route('**/api/casa/pollas/fixture/picks**', async route=>{
    const request=route.request(); const url=new URL(request.url());
    if (request.method()==='GET') {
      assert.equal(url.searchParams.get('state'),'1');
      assert.equal(url.searchParams.get('p'),'1');
      assert.equal(url.searchParams.get('entryId'),ids.entry);
      store.reads.push(url.search);
      if(store.behavior==='offline') {await route.abort('internetdisconnected');return;}
      if(!store.authenticated) {await route.fulfill({status:401,json:{error:'Ingresa de nuevo.'},headers:jsonHeaders});return;}
      await route.fulfill({json:{...clone(store.state),ownerId:store.ownerId},headers:jsonHeaders});return;
    }
    assert.equal(request.method(),'PUT'); assert.equal(url.search,'');
    const op=request.postDataJSON(); store.sent.push(clone(op));
    if(store.behavior==='offline') {await route.abort('internetdisconnected');return;}
    if(!store.authenticated) {await route.fulfill({status:401,json:{error:'Ingresa de nuevo.'},headers:jsonHeaders});return;}
    if(store.behavior==='html') {await route.fulfill({contentType:'text/html',body:'<!doctype html><title>Login</title>'});return;}
    if(store.behavior==='wrong-ack') {
      await route.fulfill({json:{ok:true,requestId:op.requestId,revision:1,guardados:op.picks.length,avisos:[],results:op.picks.map(p=>({targetId:p.matchId??p.questionId,status:'saved',values:{...normal(p),freeText:'Not the submitted answer',homeScore:9}}))}});return;
    }
    const response=store.commit(op);
    if(store.behavior==='hold') {
      await new Promise(resolve=>{store.held=resolve;});
      store.held=null;
      // The fetch may already have been aborted by the client's own deadline.
      try {await route.fulfill({...response,headers:jsonHeaders});} catch { /* Closed synthetic request. */ }
      return;
    }
    if(store.behavior==='drop') {await route.abort('failed');return;}
    await route.fulfill({...response,headers:jsonHeaders});
  });
  const open=()=>page.goto(`http://127.0.0.1:${port}/?mode=${mode}&case=${scenario}`);
  const close=async()=>{store.held?.();assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);await context.close();};
  return {page,store,open,close,context};
}
const saveButton=page=>page.locator('[data-app-update-blocked] button.lp-btn-primary');
const blocked=page=>page.locator('[data-app-update-blocked]');
async function fillPick(page,mode,value,index=0,complete=true) {
  if(mode==='questions') await page.locator('input').nth(index).fill(String(value));
  else if(mode==='outcomes') await page.locator('article').nth(index).getByRole('button',{name:value==='L'?'Gana Millonarios':value==='V'?'Gana Junior':'Empate',exact:true}).click();
  else {
    await page.locator('article').nth(index).locator('input').first().fill(String(value));
    if(complete) await page.locator('article').nth(index).locator('input').nth(1).fill('0');
  }
}
const target=mode=>mode==='questions'?ids.question:ids.match;
const secondTarget=mode=>mode==='questions'?ids.question2:ids.match2;
const pickInput=(page,mode,index=0)=>mode==='questions'?page.locator('input').nth(index):page.locator('article').nth(index).locator('input').first();
const value=mode=>mode==='questions'?'freeText':'homeScore';
const pick=mode=>mode==='questions'?{freeText:'Other device'}:{homeScore:3,awayScore:0};
async function saved(page,total=1){await expect(saveButton(page)).toHaveText(`Guardado ${total}/${total}`);await expect(blocked(page)).toHaveAttribute('data-app-update-blocked','false');}
async function record(name,mode,store,page) {
  evidence.cases.push({name,mode,requests:clone(store.sent),stateReads:store.reads.length,persisted:clone(store.state),joined:store.joined});
  await page.screenshot({path:path.join(artifacts,`${name}-${mode}.png`),fullPage:true});
  console.log(`PASS ${mode}: ${name}`);
}
async function runCase(name,mode,scenario,work) {
  if(selectedCases.size && !selectedCases.has(name)) return;
  const f=await fixture(mode,scenario);
  try{await f.open();await work(f);await record(name,mode,f.store,f.page);}finally{await f.close();}
}
async function inspectVisual(page,mode) {
  await page.evaluate(()=>document.fonts.ready);
  for(const width of [320,639,640,641,768,1280]) {
    await page.setViewportSize({width,height:900});
    for(const zoom of [1,2]) {
      await page.evaluate(scale=>{
        const nodes=[...document.querySelectorAll('main, main *')];
        const sizes=nodes.map(el=>Number(el.getAttribute('data-original-font-size'))||parseFloat(getComputedStyle(el).fontSize));
        nodes.forEach((el,i)=>{el.setAttribute('data-original-font-size',String(sizes[i]));el.style.fontSize=sizes[i]*scale+'px';});
      },zoom);
      const probe=await page.evaluate(()=>{
        const main=document.querySelector('main'), button=main.querySelector('button'), heading=main.querySelector('h1');
        const body=getComputedStyle(button),display=getComputedStyle(heading);
        return {overflow:document.documentElement.scrollWidth>innerWidth,bodyFont:body.fontFamily,bodySize:body.fontSize,bodyWeight:body.fontWeight,displayFont:display.fontFamily,fontsLoaded:document.fonts.check(`600 15px ${body.fontFamily.split(',')[0]}`),hiddenEssential:[...main.querySelectorAll('button,label')].filter(el=>getComputedStyle(el).display!=='none'&&!(el.closest('details:not([open])')&&!el.closest('summary'))&&el.getBoundingClientRect().width===0).map(el=>({text:el.textContent,class:el.className}))};
      });
      evidence.probes.push({mode,width,zoom,...probe});
      assert.equal(probe.overflow,false,JSON.stringify(evidence.probes.at(-1)));
      assert.deepEqual(probe.hiddenEssential,[]);
      assert.ok(/outfit/i.test(probe.bodyFont));assert.ok(/bebas/i.test(probe.displayFont));assert.equal(probe.fontsLoaded,true);
      if(mode==='outcomes') {
        const layout=await page.locator('article [role="group"]').first().evaluate(group=>{
          const buttons=[...group.querySelectorAll('button')];
          return {columns:getComputedStyle(group).gridTemplateColumns.split(' ').length,
            labels:buttons.map(button=>{const label=button.querySelector(':scope > span:last-child');return {text:label.textContent,height:label.getBoundingClientRect().height,lineHeight:parseFloat(getComputedStyle(label).lineHeight)};})};
        });
        assert.equal(layout.columns,width<640?1:3);
        if(width<640) assert.ok(layout.labels.every(label=>label.height<=label.lineHeight+1),JSON.stringify(layout));
      }
      await page.screenshot({path:path.join(artifacts,`${mode}-${width}-${zoom}x.png`),fullPage:true});
      if(mode==='creator') {await page.getByRole('group',{name:/^Cierre de respaldo/}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(artifacts,`closure-${width}-${zoom}x.png`)});}
    }
  }
  await page.evaluate(()=>document.querySelectorAll('[data-original-font-size]').forEach(el=>el.style.fontSize=el.getAttribute('data-original-font-size')+'px'));
  const {violations}=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();
  evidence.axe.push({mode,violations:violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}))});
  assert.deepEqual(violations.filter(v=>['critical','serious'].includes(v.impact)).map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);
  console.log(`PASS ${mode}: CSS/fonts, six widths, 200% text, axe`);
}
try {
  await server.listen();
  // Use installed Chrome on every platform, matching the project's E2E gate.
  browser=process.env.BROWSER_ENGINE==='webkit' ? await webkit.launch() : await chromium.launch({channel:'chrome',headless:true});
  for(const mode of modes) {
    if(mode==='creator') {
      await runCase('provisional-creator',mode,'',async({page})=>{
        await page.getByLabel('Buscar equipo',{exact:true}).fill('Millonarios');
        await page.getByRole('button',{name:/Millonarios vs Junior, hora por confirmar/}).click();
        await expect(page.getByRole('group',{name:/^Cierre de respaldo/})).toBeVisible();
        await expect(page.getByText(/Los pronósticos siguen abiertos/)).toBeVisible();
        await inspectVisual(page,mode);
      });continue;
    }
    if(mode==='free') {
      await runCase('one-click-free',mode,'',async({page,store})=>{
        await expect(page.getByRole('button',{name:'Entrar gratis',exact:true})).toBeVisible();
        assert.equal(await page.locator('input[type="file"]').count(),0);
        assert.equal(await page.getByText(/Transferir|Subir comprobante|Esperando aprobación/).count(),0);
        await inspectVisual(page,mode);
        await page.getByRole('button',{name:'Entrar gratis',exact:true}).click();
        await expect(page.getByRole('button',{name:'Ya estás dentro',exact:true})).toBeDisabled();assert.equal(store.joined,1);
      });
      await runCase('free-lost-response',mode,'',async({page,store})=>{
        store.behavior='drop';await page.getByRole('button',{name:'Entrar gratis',exact:true}).click();
        await expect(page.getByRole('button',{name:'Ya estás dentro',exact:true})).toBeDisabled();assert.equal(store.joined,1);
      });continue;
    }
    if(mode==='outcomes') {
      await runCase('outcomes-all-choices',mode,'',async({page,store})=>{
        for(const choice of ['L','E','V']) {
          await fillPick(page,mode,choice);await saveButton(page).click();await saved(page);
          assert.equal(store.state.picks[ids.match].pick1x2,choice);
        }
        await inspectVisual(page,mode);
      });
      await runCase('outcomes-edit-during-save',mode,'',async({page,store})=>{
        store.behavior='hold';await fillPick(page,mode,'L');await saveButton(page).click();
        await expect.poll(()=>Boolean(store.held)).toBe(true);
        await fillPick(page,mode,'V');store.behavior=null;store.held();
        await expect(page.getByText('Guardamos el envío anterior. Tienes cambios nuevos sin guardar.')).toBeVisible();
        assert.equal(store.state.picks[ids.match].pick1x2,'L');
        await saveButton(page).click();await saved(page);assert.equal(store.state.picks[ids.match].pick1x2,'V');
      });
      await runCase('outcomes-lost-response',mode,'',async({page,store})=>{
        store.behavior='drop';await fillPick(page,mode,'E');await saveButton(page).click();await saved(page);
        assert.equal(store.sent.length,1);assert.equal(store.reads.length,1);
      });
      await runCase('outcomes-offline-recovery',mode,'',async({page,store})=>{
        store.behavior='offline';await fillPick(page,mode,'L');await saveButton(page).click();
        await expect(saveButton(page)).toHaveText('Comprobar guardado');assert.equal(store.state.revision,0);
        const requestId=store.sent[0].requestId;store.behavior=null;
        await saveButton(page).click();await saved(page);assert.equal(store.sent[1].requestId,requestId);
      });continue;
    }
    await runCase('offline-before-write-recovers',mode,'',async({page,store})=>{
      store.behavior='offline';await fillPick(page,mode,mode==='questions'?'Mi respuesta':12);await saveButton(page).click();
      await expect(saveButton(page)).toHaveText('Comprobar guardado');assert.equal(store.state.revision,0);
      await expect(blocked(page)).toHaveAttribute('data-app-update-blocked','true');
      const requestId=store.sent[0].requestId;store.behavior=null;await saveButton(page).click();await saved(page);
      assert.equal(store.sent[1].requestId,requestId);
    });
    await runCase('synchronous-double-click-one-write',mode,'',async({page,store})=>{
      store.behavior='hold';await fillPick(page,mode,mode==='questions'?'Una respuesta':3);
      await saveButton(page).evaluate(button=>{button.click();button.click();});
      await expect.poll(()=>Boolean(store.held)).toBe(true);assert.equal(store.sent.length,1);
      store.behavior=null;store.held();await saved(page);assert.equal(store.state.revision,1);
    });
    if(mode==='matches') await runCase('keyboard-two-digit-score-and-enter',mode,'',async({page,store})=>{
      const inputs=page.locator('article').first().locator('input');
      await inputs.first().click();await page.keyboard.type('10');await expect(inputs.first()).toHaveValue('10');
      await expect(inputs.first()).toBeFocused();await page.keyboard.press('Enter');await expect(inputs.nth(1)).toBeFocused();
      await page.keyboard.type('12');await expect(inputs.nth(1)).toHaveValue('12');
      await saveButton(page).click();await saved(page);assert.equal(store.state.picks[ids.match].homeScore,10);
      assert.equal(store.state.picks[ids.match].awayScore,12);
    });
    if(mode==='matches') await runCase('keyboard-click-replaces-existing-score',mode,'',async({page,store})=>{
      await fillPick(page,mode,7);await saveButton(page).click();await saved(page);
      const inputs=page.locator('article').first().locator('input');
      await inputs.first().click();await page.keyboard.type('12');
      await expect(inputs.first()).toHaveValue('12');await page.keyboard.press('Enter');
      await page.keyboard.type('10');await expect(inputs.nth(1)).toHaveValue('10');
      await saveButton(page).click();await saved(page);
      assert.equal(store.state.picks[ids.match].homeScore,12);assert.equal(store.state.picks[ids.match].awayScore,10);
    });
    if(mode==='matches') await runCase('touch-score-focus-and-batch-save',mode,'touch',async({page,store})=>{
      // A shortened viewport also exercises scrolling past the sticky save bar.
      await page.setViewportSize({width:320,height:420});
      const inputs=page.locator('article input');
      await expect(inputs.first()).toBeEnabled();
      await page.evaluate(()=>{
        window.__scoreTouches=[];
        document.addEventListener('pointerdown',event=>{
          if(event.target instanceof HTMLInputElement) window.__scoreTouches.push({pointerType:event.pointerType,cancelled:event.defaultPrevented,trusted:event.isTrusted});
        });
      });
      for(const [index,score] of ['10','12','2','1'].entries()) {
        await inputs.nth(index).tap();await expect(inputs.nth(index)).toBeFocused();
        await page.keyboard.type(score);await expect(inputs.nth(index)).toHaveValue(score);
      }
      // A tap on an existing value must replace both digits, without saving each match.
      await inputs.first().tap();await expect(inputs.first()).toBeFocused();
      await page.keyboard.type('3');await expect(inputs.first()).toHaveValue('3');
      const touches=await page.evaluate(()=>window.__scoreTouches);
      assert.equal(touches.length,5);
      assert.ok(touches.every(event=>event.pointerType==='touch'&&event.trusted&&!event.cancelled),JSON.stringify(touches));
      assert.equal(store.sent.length,0);
      await saveButton(page).tap();await saved(page,2);assert.equal(store.sent.length,1);
      assert.equal(store.state.picks[ids.match].homeScore,3);assert.equal(store.state.picks[ids.match].awayScore,12);
      assert.equal(store.state.picks[ids.match2].homeScore,2);assert.equal(store.state.picks[ids.match2].awayScore,1);
      await inspectVisual(page,'matches-touch');
    });
    if(mode==='matches') await runCase('touch-score-autojump',mode,'autojump',async({page,store})=>{
      const inputs=page.locator('article input');
      await inputs.first().tap();await page.keyboard.type('1');
      await page.clock.runFor(299);await expect(inputs.first()).toBeFocused();
      await page.clock.runFor(1);await expect(inputs.nth(1)).toBeFocused();
      await page.keyboard.type('2');await page.clock.runFor(300);
      await expect(inputs.nth(2)).toBeFocused();
      await page.keyboard.type('0');await page.clock.runFor(300);
      await expect(inputs.nth(3)).toBeFocused();
      await page.keyboard.type('3');await page.clock.runFor(300);
      await expect(inputs.nth(3)).not.toBeFocused();
      // Each new digit restarts the pause, so 10–30 remain editable.
      await inputs.first().tap();await page.keyboard.type('1');await page.clock.runFor(150);
      await page.keyboard.type('2');await page.clock.runFor(299);
      await expect(inputs.first()).toBeFocused();await expect(inputs.first()).toHaveValue('12');
      await page.clock.runFor(1);await expect(inputs.nth(1)).toBeFocused();
      // Deleting and manually leaving a field must cancel its pending jump.
      await inputs.first().tap();await page.keyboard.press('Backspace');await page.clock.runFor(1000);
      await expect(inputs.first()).toHaveValue('');await expect(inputs.first()).toBeFocused();
      await page.keyboard.type('4');await inputs.nth(2).tap();await page.clock.runFor(1000);
      await expect(inputs.nth(2)).toBeFocused();
      // Collapsing the day unmounts the fields and cancels their timers.
      await inputs.first().tap();await page.keyboard.type('5');
      const day=page.getByRole('button',{name:/Ma\u00f1ana/});
      await day.tap();await expect(inputs).toHaveCount(0);await page.clock.runFor(1000);
      await day.tap();await page.clock.runFor(1000);
      await expect(inputs.first()).not.toBeFocused();await expect(inputs.first()).toHaveValue('5');
      assert.equal(store.sent.length,0);
      await saveButton(page).tap();await saved(page,2);assert.equal(store.sent.length,1);
      assert.equal(store.state.picks[ids.match].homeScore,5);assert.equal(store.state.picks[ids.match].awayScore,2);
      assert.equal(store.state.picks[ids.match2].homeScore,0);assert.equal(store.state.picks[ids.match2].awayScore,3);
    });
    await runCase('pending-a-then-b',mode,'',async({page,store})=>{
      store.behavior='hold';await fillPick(page,mode,mode==='questions'?'A':1);await saveButton(page).click();
      await expect.poll(()=>Boolean(store.held)).toBe(true);
      await fillPick(page,mode,mode==='questions'?'B':2);store.behavior=null;store.held();
      await expect(page.getByText('Guardamos el envío anterior. Tienes cambios nuevos sin guardar.')).toBeVisible();
      await expect(blocked(page)).toHaveAttribute('data-app-update-blocked','true');await expect(saveButton(page)).toBeEnabled();
      assert.equal(await page.evaluate(()=>window.__refreshCount),1);
      assert.equal(store.state.picks[target(mode)][value(mode)],mode==='questions'?'A':1);
      await page.screenshot({path:path.join(artifacts,`pending-${mode}-320.png`),fullPage:true});
      await saveButton(page).click();await saved(page);
      assert.equal(store.sent.length,2);assert.equal(store.sent[1].expectedRevision,1);
      assert.notEqual(store.sent[0].requestId,store.sent[1].requestId);
      assert.equal(store.state.picks[target(mode)][value(mode)],mode==='questions'?'B':2);
      await inspectVisual(page,mode);
    });
    // Provisional dates stay editable even when their placeholder timestamp passed.
    if(mode==='provisional') continue;
    await runCase('partial-closed',mode,'closed',async({page,store})=>{
      await fillPick(page,mode,mode==='questions'?'A':1,0);await fillPick(page,mode,mode==='questions'?'B':2,1);
      store.closed.add(target(mode));
      if(mode==='questions') await page.evaluate(()=>window.__fixture.closeFirst());
      else await page.clock.fastForward(12000);
      await saveButton(page).click();await expect(page.getByText(/Guardamos 1\./)).toBeVisible();
      await expect(blocked(page)).toHaveAttribute('data-app-update-blocked','true');
      assert.equal(await page.getByRole('button',{name:'Guardado 2/2',exact:true}).count(),0);
      assert.equal(store.sent[0].picks.length,2);assert.equal(Object.keys(store.state.picks).length,1);
      assert.equal(store.state.picks[target(mode)],undefined);
      if(mode==='questions') await expect(page.locator('input').first()).toHaveValue('');
      else {
        assert.equal(await page.locator('article').first().locator('input').count(),0);
        assert.equal(await page.locator('article').first().getByText(/^Tú /).count(),0);
      }
    });
    if(mode==='matches') await runCase('partial-incomplete',mode,'incomplete',async({page,store})=>{
      await fillPick(page,mode,1,0,false);await fillPick(page,mode,2,1);await saveButton(page).click();
      await expect(page.getByText(/Guardamos 1\. Completa este pronóstico/)).toBeVisible();
      await expect(blocked(page)).toHaveAttribute('data-app-update-blocked','true');
      await expect(page.locator('article').first().locator('input').first()).toHaveValue('1');
      assert.equal(await page.getByRole('button',{name:'Guardado 2/2',exact:true}).count(),0);
      assert.equal(store.state.picks[ids.match],undefined);assert.equal(store.state.picks[ids.match2].homeScore,2);
    });
    for(const behavior of ['drop','hold']) await runCase(behavior==='drop'?'commit-lost-response':'commit-deadline',mode,'',async({page,store})=>{
      if(behavior==='hold') await page.clock.install();store.behavior=behavior;
      await fillPick(page,mode,mode==='questions'?'A':1);await saveButton(page).click();
      await expect.poll(()=>store.sent.length).toBe(1);
      if(behavior==='hold'){await expect.poll(()=>Boolean(store.held)).toBe(true);await page.clock.fastForward(15001);}
      await saved(page);assert.equal(store.sent.length,1);assert.equal(store.reads.length,1);
      assert.equal(await page.evaluate(()=>window.__refreshCount),1);
      assert.equal(store.state.picks[target(mode)][value(mode)],mode==='questions'?'A':1);store.held?.();
    });
    for(const behavior of ['html','wrong-ack']) await runCase(`uncertain-${behavior}`,mode,'',async({page,store})=>{
      store.behavior=behavior;await fillPick(page,mode,mode==='questions'?'A':1);await saveButton(page).click();
      await expect(saveButton(page)).toHaveText('Comprobar guardado');await expect(saveButton(page)).toBeEnabled();
      await expect(blocked(page)).toHaveAttribute('data-app-update-blocked','true');assert.equal(store.state.revision,0);
      assert.equal(await page.getByRole('button',{name:'Guardado 1/1',exact:true}).count(),0);
      assert.equal(await page.evaluate(()=>window.__refreshCount??0),0);
      const identity=store.sent[0].requestId;store.behavior=null;await saveButton(page).click();await saved(page);
      assert.equal(store.sent.length,2);assert.equal(store.sent[1].requestId,identity);
    });
    await runCase('version-conflict-keeps-b',mode,'',async({page,store})=>{
      store.behavior='hold';await fillPick(page,mode,mode==='questions'?'A':1);await saveButton(page).click();
      await expect.poll(()=>Boolean(store.held)).toBe(true);await fillPick(page,mode,mode==='questions'?'B':2);
      store.externalWrite(pick(mode));store.behavior=null;store.held();
      await expect(page.getByText('Guardamos el envío anterior. Tienes cambios nuevos sin guardar.')).toBeVisible();
      await saveButton(page).click();await expect(page.getByText(/Hay pronósticos más recientes/)).toBeVisible();
      await expect(blocked(page)).toHaveAttribute('data-app-update-blocked','true');
      assert.equal(store.state.picks[target(mode)][value(mode)],mode==='questions'?'Other device':3);
      await fillPick(page,mode,mode==='questions'?'B':2);await saveButton(page).click();await saved(page);
      assert.equal(store.sent[2].expectedRevision,2);assert.equal(store.state.revision,3);
      const older=clone(store.sent[0]);const replay=await page.evaluate(async op=>{
        const response=await fetch('/api/casa/pollas/fixture/picks',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(op)});return response.status;
      },older);
      assert.equal(replay,409);assert.equal(store.state.revision,3);
      assert.equal(store.state.picks[target(mode)][value(mode)],mode==='questions'?'B':2);
    });
    await runCase('pending-conflict-no-old-write',mode,'',async({page,store})=>{
      store.behavior='html';await fillPick(page,mode,mode==='questions'?'A':1);await saveButton(page).click();
      await expect(saveButton(page)).toHaveText('Comprobar guardado');await fillPick(page,mode,mode==='questions'?'B':2);
      store.externalWrite(pick(mode));store.behavior=null;await saveButton(page).click();
      await expect(page.getByText(/Hay pronósticos más recientes/)).toBeVisible();
      assert.equal(store.sent.length,1);await expect(blocked(page)).toHaveAttribute('data-app-update-blocked','true');
      await saveButton(page).click();await saved(page);assert.equal(store.sent[1].expectedRevision,1);
      assert.notEqual(store.sent[0].requestId,store.sent[1].requestId);
      assert.equal(store.state.picks[target(mode)][value(mode)],mode==='questions'?'B':2);
    });
    await runCase('session-recovery-same-owner',mode,'',async({page,store})=>{
      store.authenticated=false;await fillPick(page,mode,mode==='questions'?'A':1);await saveButton(page).click();
      await expect(page.getByRole('link',{name:'Ingresar de nuevo'})).toBeVisible();
      await expect(page.getByRole('link',{name:'Ingresar de nuevo'})).toHaveAttribute('target','_blank');
      await expect(saveButton(page)).toHaveText('Comprobar guardado');assert.equal(store.state.revision,0);
      assert.equal(await page.evaluate(()=>window.__refreshCount??0),0);
      const identity=store.sent[0].requestId;store.authenticated=true;await saveButton(page).click();await saved(page);
      assert.equal(store.sent[1].requestId,identity);
    });
    await runCase('session-owner-change-blocked',mode,'',async({page,store})=>{
      store.authenticated=false;await fillPick(page,mode,mode==='questions'?'A':1);await saveButton(page).click();
      await expect(page.getByRole('link',{name:'Ingresar de nuevo'})).toBeVisible();
      store.authenticated=true;store.ownerId=ids.ownerB;await saveButton(page).click();
      await expect(saveButton(page)).toHaveText('Comprobar guardado');await expect(saveButton(page)).toBeEnabled();
      assert.equal(store.sent.length,1);assert.equal(store.state.revision,0);
      await expect(blocked(page)).toHaveAttribute('data-app-update-blocked','true');
      store.ownerId=ids.owner;await saveButton(page).click();await saved(page);
    });
    await runCase('restore-scoped-draft',mode,'',async({page,store})=>{
      await fillPick(page,mode,mode==='questions'?'A':1);await page.reload();
      await expect(page.getByText('Recuperamos tus cambios sin guardar. Revisa y pulsa Guardar.')).toBeVisible();
      await expect(page.locator('input').first()).toHaveValue(mode==='questions'?'A':'1');
      await page.evaluate(ids=>window.__fixture.remount(ids.ownerB,ids.entryB),ids);
      await expect(page.locator('input').first()).toHaveValue('');await expect(blocked(page)).toHaveAttribute('data-app-update-blocked','false');
      await page.evaluate(ids=>window.__fixture.remount(ids.owner,ids.entry),ids);
      await expect(page.locator('input').first()).toHaveValue(mode==='questions'?'A':'1');
      assert.equal(store.sent.length,0);await saveButton(page).click();await saved(page);
    });
    await runCase('restore-pending-request',mode,'',async({page,store})=>{
      store.behavior='html';await fillPick(page,mode,mode==='questions'?'A':1);await saveButton(page).click();
      await expect(saveButton(page)).toHaveText('Comprobar guardado');const identity=store.sent[0].requestId;
      await page.reload();await expect(page.getByText('Hay un envío por confirmar. Comprueba el guardado antes de enviar nuevos cambios.')).toBeVisible();
      await expect(page.locator('input').first()).toHaveValue(mode==='questions'?'A':'1');store.behavior=null;
      await saveButton(page).click();await saved(page);assert.equal(store.sent[1].requestId,identity);
    });
    await runCase('conflict-refreshes-untouched-y',mode,'rebase',async({page,store})=>{
      await fillPick(page,mode,mode==='questions'?'Edited X':2);
      store.externalWrite(mode==='questions'?{freeText:'Fresh Y'}:{homeScore:4,awayScore:0},secondTarget(mode));
      await saveButton(page).click();await expect(page.getByText(/Hay pronósticos más recientes/)).toBeVisible();
      await expect(pickInput(page,mode)).toHaveValue(mode==='questions'?'Edited X':'2');
      await expect(pickInput(page,mode,1)).toHaveValue(mode==='questions'?'Fresh Y':'4');
      assert.equal(store.sent.length,1);assert.equal(store.sent[0].picks.length,1);
      await page.screenshot({path:path.join(artifacts,`conflict-pending-${mode}.png`),fullPage:true});
      await saveButton(page).click();await saved(page,2);
      assert.equal(store.sent[1].expectedRevision,1);assert.equal(store.sent[1].picks.length,1);
      assert.equal(store.sent[1].picks[0].matchId??store.sent[1].picks[0].questionId,target(mode));
      assert.equal(store.state.picks[secondTarget(mode)][value(mode)],mode==='questions'?'Fresh Y':4);
    });
    await runCase('two-remounts-preserve-conflict-and-fresh-y',mode,'restore-fresh',async({page,store})=>{
      await fillPick(page,mode,mode==='questions'?'Edited X':2);
      const storageKey='casa-pick-draft-v1:'+ids.owner+':'+ids.entry+':fixture';
      const stored=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)),storageKey);
      assert.equal(stored.version,2);assert.deepEqual(Object.keys(stored.changes),[target(mode)]);
      store.externalWrite(mode==='questions'?{freeText:'Fresh server X'}:{homeScore:3,awayScore:0});
      store.externalWrite(mode==='questions'?{freeText:'Fresh Y'}:{homeScore:4,awayScore:0},secondTarget(mode));
      for(let remount=0;remount<2;remount++){
        await page.evaluate(({ids,snapshot})=>window.__fixture.remount(ids.owner,ids.entry,snapshot),{ids,snapshot:{initialPicks:clone(store.state.picks),initialRevision:store.state.revision}});
        await expect(page.getByText('Hay pronósticos más recientes y recuperamos tus cambios. Revísalos antes de pulsar Guardar.')).toBeVisible();
        await expect(pickInput(page,mode)).toHaveValue(mode==='questions'?'Edited X':'2');
        await expect(pickInput(page,mode,1)).toHaveValue(mode==='questions'?'Fresh Y':'4');
        const restored=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)),storageKey);
        assert.equal(restored.version,2);assert.deepEqual(Object.keys(restored.changes),[target(mode)]);
        assert.deepEqual(restored.changes[target(mode)].baseline,stored.changes[target(mode)].baseline);
        await page.screenshot({path:path.join(artifacts,`restored-conflict-${mode}-${remount+1}.png`),fullPage:true});
      }
      assert.equal(store.sent.length,0);await saveButton(page).click();await saved(page,2);
      assert.equal(store.sent[0].expectedRevision,2);assert.equal(store.sent[0].picks.length,1);
      assert.equal(store.sent[0].picks[0].matchId??store.sent[0].picks[0].questionId,target(mode));
      assert.equal(store.state.picks[secondTarget(mode)][value(mode)],mode==='questions'?'Fresh Y':4);
    });
    if(mode==='questions') await runCase('long-option-wraps',mode,'options',async({page,store})=>{
      await page.getByRole('button',{name:/Un jugador con un nombre largo/}).click();await saveButton(page).click();await saved(page);
      assert.equal(store.state.picks[ids.question].optionId,ids.option);await inspectVisual(page,'questions-options');
    });
  }
  assert.ok(evidence.cases.length > 0, 'The selected modes and cases must execute a browser case');
  evidence.status='passed';console.log(`Browser evidence: ${artifacts}`);
} catch(error) {
  evidence.status='failed';evidence.error=error.stack;throw error;
} finally {
  fs.writeFileSync(path.join(artifacts,'evidence.json'),JSON.stringify(evidence,null,2));
  fs.writeFileSync(path.join(artifacts,'probes.json'),JSON.stringify(evidence.probes,null,2));
  await browser?.close();await server.close();
  // Only our verified scratch directory and our junction; never traverse repo deps.
  assert.equal(path.dirname(fs.realpathSync(root)),fs.realpathSync(downloads));
  fs.unlinkSync(path.join(root,'node_modules'));fs.rmSync(root,{recursive:true});
}
