// Isolated integration fixtures against Docker only. No production credentials or messages.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { chromium } from '@playwright/test';
import { localCredentials, localUrl } from './casa-v2-local-env.mjs';

const origin = 'http://localhost:3101';
const output = 'C:/Users/STZTR/Downloads/la-polla-implementation-20260912/browser';
await mkdir(output, { recursive: true });
const keys = localCredentials();
const db = createClient(localUrl, keys.service, { auth: { persistSession: false } });
const sql = (query) => execFileSync('docker', ['exec', '-i', 'supabase_db_la-polla', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-tA', '-v', 'ON_ERROR_STOP=1'], { input: query, encoding: 'utf8' }).trim();
const q = (value) => "'" + String(value).replaceAll("'", "''") + "'";
const browser = await chromium.launch({ channel: 'chrome', headless: true });
async function actor(name, admin = false) {
  const email = `local-${randomUUID()}@example.invalid`, password = randomUUID();
  const phone = '+1999' + String(Date.now()).slice(-8) + Math.floor(Math.random()*100);
  const result = await db.auth.admin.createUser({ email, password, phone, phone_confirm: true, email_confirm: true });
  if (result.error) throw result.error;
  const id = result.data.user.id;
  sql(`INSERT INTO public.users(id,whatsapp_number,display_name,avatar_url,is_admin) VALUES(${q(id)},${q(phone)},${q(name)},'millos',${admin}) ON CONFLICT(id) DO UPDATE SET display_name=EXCLUDED.display_name,avatar_url='millos',is_admin=EXCLUDED.is_admin;`);
  const cookies = new Map();
  const auth = createServerClient(localUrl, keys.anon, { cookies: { getAll: () => [...cookies.values()], setAll: (rows) => rows.forEach((r) => cookies.set(r.name, r)) } });
  const login = await auth.auth.signInWithPassword({ email, password });
  if (login.error) throw login.error;
  const context = await browser.newContext({ colorScheme: 'dark', locale: 'es-CO', viewport: { width: 390, height: 844 } });
  await context.addCookies([...cookies.values()].map((c) => ({ name: c.name, value: c.value, url: origin, sameSite: 'Lax' })));
  await context.addInitScript(() => { window.__DISABLE_AGENTATION__ = true; localStorage.setItem('lp_welcome_seen_v1','1'); sessionStorage.setItem('lp_splash_seen_v2','1'); });
  return { id, context, page: await context.newPage() };
}
async function api(actor, path, body, method = 'POST', expected = 200) {
  const r = await actor.context.request.fetch(origin + path, { method, headers: { 'X-Casa-Contract': '2' }, ...(body ? { data: body } : {}) });
  const data = await r.json();
  assert.equal(r.status(), expected, `${method} ${path}: ${JSON.stringify(data)}`);
  return data;
}
async function screen(actor, name, path) {
  await actor.page.goto(origin + path, { waitUntil: 'networkidle' });
  await actor.page.evaluate(() => document.fonts.ready);
  assert.ok(!actor.page.url().includes('/login'), 'Authenticated session must reach the page');
  for (const width of [320, 768, 1440]) {
    await actor.page.setViewportSize({ width, height: 1000 });
    await actor.page.waitForTimeout(650); // Let the existing entrance animation finish before capturing.
    await actor.page.screenshot({ path: `${output}/${name}-${width}.png`, fullPage: true });
    const metrics = await actor.page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, bodyFont: getComputedStyle(document.body).fontFamily,
      overflow: [...document.querySelectorAll('main *')].filter((el) => el.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(el).position !== 'fixed').slice(0, 5).map((el) => el.tagName + ':' + el.textContent?.slice(0, 60)) }));
    assert.ok(metrics.scroll <= width + 1, `${name} horizontal overflow: ${JSON.stringify(metrics)}`);
    console.log('VIEW', name, width, JSON.stringify(metrics));
  }
  await actor.page.setViewportSize({width:320,height:1000});
  await actor.page.evaluate(() => { const nodes=[...document.querySelectorAll('body *')].map(el=>[el,parseFloat(getComputedStyle(el).fontSize)]);for(const [el,size] of nodes) el.style.fontSize=`${size*2}px`; });
  await actor.page.screenshot({path:`${output}/${name}-320-zoom200.png`,fullPage:true});
  if(name==='pagar-rifa') { await actor.page.getByText('Transfiere a',{exact:true}).scrollIntoViewIfNeeded(); await actor.page.waitForTimeout(650); await actor.page.screenshot({path:`${output}/${name}-account-zoom200-viewport.png`}); }
  if(name==='empate-administrador') { await actor.page.getByRole('button',{name:'Adjudicar el objeto',exact:true}).scrollIntoViewIfNeeded(); await actor.page.waitForTimeout(650); await actor.page.screenshot({path:`${output}/${name}-confirm-zoom200-viewport.png`}); }
  assert.ok(await actor.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' overflow at 200% text zoom');
  await actor.page.reload({waitUntil:'networkidle'});
}
try {
  const anonymous = await browser.newContext();
  for (const [method, path] of [['GET','tickets'],['GET','award'],['POST','join'],['PUT','picks']]) {
    const response = await anonymous.request.fetch(`${origin}/api/casa/pollas/unknown/${path}`, { method, maxRedirects:0, headers:{'X-Casa-Contract':'2'}, ...(method==='GET'?{}:{data:{}}) });
    assert.equal(response.status(),401,`Anonymous ${path} must return JSON, not login redirect`);
    assert.match(response.headers()['content-type'],/application\/json/);
  }
  await anonymous.close();
  console.log('PASS expired/missing session JSON boundary for tickets/award/join/picks');
  const admin = await actor('Administrador local', true), player = await actor('Participante local'), other = await actor('Otro participante');
  await admin.page.goto(`${origin}/admin/pollas/crear`,{waitUntil:'networkidle'});
  await admin.page.getByRole('button',{name:'Un objeto',exact:true}).click();
  await admin.page.waitForFunction(()=>Array.from(document.querySelectorAll('p')).some(p=>p.textContent.includes('La inscripción es para')&&p.textContent.includes('10.000')));
  const houseInput=admin.page.locator('input[type=number][max="100"]');
  assert.equal(await houseInput.inputValue(),'100');assert.equal(await houseInput.isDisabled(),true);
  for(const width of [320,768,1440]) {
    await admin.page.setViewportSize({width,height:1000});
    await admin.page.getByText('La inscripción es para participar por el objeto anunciado.',{exact:false}).scrollIntoViewIfNeeded();
    await admin.page.waitForTimeout(650);
    await admin.page.screenshot({path:`${output}/crear-objeto-${width}.png`});
    assert.ok(await admin.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  }
  console.log('PASS create-object copy: fixed object, 100% collection, no cash split');
  const id = randomUUID(), slug = `local-rifa-${id}`;
  sql(`BEGIN; SELECT public.casa_v2_context(2); INSERT INTO public.casa_pollas(id,slug,name,kind,status,closes_at,created_by,entry_price_cop,payout_method,payout_account,prize_kind,prize_object,ticket_count,draw_method)
    VALUES(${q(id)},${q(slug)},'Rifa de integración local','rifa','abierta',clock_timestamp()+interval '2 hours',${q(admin.id)},10000,'otro','CUENTA LOCAL DE PRUEBA','objeto','Camiseta oficial de colección para el ganador',100,'Sorteo local de prueba'); COMMIT;`);
  const paths = { slug, id, adminId: admin.id, playerId: player.id };
  await screen(player, 'pagar-rifa', `/casa/${slug}/pagar`);
  await player.page.setViewportSize({ width: 390, height: 844 });
  await player.page.locator('select').selectOption('7');
  const png = await player.page.evaluate(() => { const c=document.createElement('canvas');c.width=500;c.height=200; const x=c.getContext('2d'); x.fillStyle='white';x.fillRect(0,0,500,200);x.fillStyle='black';x.font='25px sans-serif';x.fillText('COMPROBANTE LOCAL DE PRUEBA',15,100);return c.toDataURL('image/png').split(',')[1]; });
  await player.page.locator('input[type=file]').setInputFiles({ name: 'comprobante-local.png', mimeType: 'image/png', buffer: Buffer.from(png,'base64') });
  await player.page.getByRole('button', { name: 'Enviar el comprobante', exact: true }).click();
  await player.page.getByText('Pago registrado', { exact: true }).waitFor({ timeout: 60000 });
  const entry = await db.from('casa_entries').select('id,current_proof_attempt_id,proof_path,status').eq('polla_id', id).eq('user_id',player.id).single();
  if(entry.error) throw entry.error;
  assert.equal(entry.data.status,'pendiente');assert.ok(entry.data.proof_path);
  await api(other, `/api/casa/pollas/${slug}/join`, { action:'confirm',attemptId:entry.data.current_proof_attempt_id },'POST',404);
  await screen(player,'rifa-en-revision',`/casa/${slug}/pagar`);
  assert.equal(await player.page.getByText('Transfiere a',{exact:true}).count(),0);
  assert.equal(await player.page.locator('input[type=file]').count(),0);
  await player.page.getByRole('heading',{name:'Comprobante en revisión',exact:true}).waitFor();
  await api(admin,'/api/casa/admin/entries',{attemptId:entry.data.current_proof_attempt_id,decision:'rechazar',motivo:'Verificar el comprobante original'});
  await player.page.goto(`${origin}/casa/${slug}/pagar?boleta=7`,{waitUntil:'networkidle'});
  await player.page.getByText('Tu comprobante fue rechazado.',{exact:false}).waitFor();
  await player.page.locator('input[type=file]').setInputFiles({name:'comprobante-local.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await player.page.getByRole('button',{name:'Enviar el comprobante',exact:true}).click();
  await player.page.getByText('Pago registrado',{exact:true}).waitFor({timeout:60000});
  const reuploaded=await db.from('casa_entries').select('current_proof_attempt_id').eq('id',entry.data.id).single();
  assert.ifError(reuploaded.error);assert.notEqual(reuploaded.data.current_proof_attempt_id,entry.data.current_proof_attempt_id);
  await api(admin,'/api/casa/admin/entries',{attemptId:reuploaded.data.current_proof_attempt_id,decision:'aprobar'});
  console.log('PASS rejected same-file proof creates a new attempt, retaining the same ticket and audit history');
  await screen(player,'rifa-pagada',`/casa/${slug}`);
  const leaderboard = await api(player,`/api/casa/pollas/${slug}/leaderboard`,null,'GET');
  assert.equal(leaderboard.entryStatus,'pagada');
  await api(admin,`/api/casa/admin/pollas/${id}`,{action:'cerrar'},'PATCH');
  await api(admin,`/api/casa/admin/pollas/${id}`,{action:'numero',numero:7},'PATCH');
  const award = await api(admin,`/api/casa/admin/pollas/${id}`,{action:'repartir'},'PATCH');
  assert.equal(award.reparto.outcome,'object_awarded');
  const result = await api(player,`/api/casa/pollas/${slug}/award`,null,'GET');
  assert.equal(result.payouts[0].amount_cop,0);
  await api(other,`/api/casa/pollas/${slug}/award`,null,'GET',403);
  await screen(player,'objeto-ganador',`/casa/${slug}`);
  await api(admin,`/api/casa/pollas/${slug}/award`,{action:'delivery',payoutId:result.payouts[0].id,reference:'Entrega local verificada'});
  await screen(admin,'objeto-entregado',`/casa/${slug}`);
  // Same bytes resume on a different request ID after close, without sessionStorage.
  const recoveryId=randomUUID(), recoverySlug=`local-recovery-${recoveryId}`;
  sql(`BEGIN; SELECT casa_v2_context(2); INSERT INTO casa_pollas(id,slug,name,kind,status,closes_at,created_by,entry_price_cop,ticket_count,payout_method,payout_account,draw_method)
    VALUES(${q(recoveryId)},${q(recoverySlug)},'Recuperación tras cierre','rifa','abierta',clock_timestamp()+interval '2 hours',${q(admin.id)},10000,100,'otro','CUENTA LOCAL','Sorteo local'); COMMIT;`);
  const proof=Buffer.from(png,'base64'), metadata={action:'begin',requestId:randomUUID(),ticketNumber:11,sha256:createHash('sha256').update(proof).digest('hex'),contentType:'image/png',bytes:proof.length};
  const begun=await api(other,`/api/casa/pollas/${recoverySlug}/join`,metadata);
  const cap=await api(other,`/api/casa/pollas/${recoverySlug}/join`,{...metadata,requestId:randomUUID(),ticketNumber:12},'POST',409);
  assert.equal(cap.code,'PREVIOUS_TICKET_PENDING');
  const put=await createClient(localUrl,keys.anon,{auth:{persistSession:false}}).storage.from(begun.upload.bucket).uploadToSignedUrl(begun.upload.path,begun.upload.token,proof,{contentType:'image/png',upsert:false});
  assert.ifError(put.error);
  await api(admin,`/api/casa/admin/pollas/${recoveryId}`,{action:'cerrar'},'PATCH');
  const resumed=await api(other,`/api/casa/pollas/${recoverySlug}/join`,{...metadata,requestId:randomUUID()});
  assert.equal(resumed.attempt_id,begun.attempt_id);
  await other.page.goto(`${origin}/casa/${recoverySlug}/pagar?boleta=11`,{waitUntil:'networkidle'});
  await other.page.getByText('La inscripción cerró.',{exact:false}).waitFor();
  await other.page.locator('input[type=file]').setInputFiles({name:'original.png',mimeType:'image/png',buffer:proof});
  await other.page.getByRole('button',{name:'Enviar el comprobante',exact:true}).click();
  await other.page.getByText('Pago registrado',{exact:true}).waitFor({timeout:60000});
  await api(admin,'/api/casa/admin/entries',{attemptId:begun.attempt_id,decision:'aprobar'});
  console.log('PASS reservation cap, cross-device same-file recovery and real upload confirmation after close');
  const tied = randomUUID(), tiedSlug = `local-empate-${tied}`, question=randomUUID(), yes=randomUUID(), no=randomUUID();
  sql(`BEGIN; SELECT public.casa_v2_context(2);
    UPDATE public.casa_operation_control SET object_draws_enabled=true;
    INSERT INTO public.casa_pollas(id,slug,name,kind,status,closes_at,created_by,entry_price_cop,payout_method,payout_account,prize_kind,prize_object)
      VALUES(${q(tied)},${q(tiedSlug)},'Polla local con empate','manual','abierta',clock_timestamp()+interval '2 hours',${q(admin.id)},10000,'otro','CUENTA LOCAL','objeto','Camiseta oficial');
    INSERT INTO public.casa_questions(id,polla_id,prompt,points,input_kind) VALUES(${q(question)},${q(tied)},'Pregunta de prueba',3,'opciones');
    INSERT INTO public.casa_options(id,question_id,label) VALUES(${q(yes)},${q(question)},'Sí'),(${q(no)},${q(question)},'No');
    INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop) VALUES(${q(tied)},${q(player.id)},'pagada',10000),(${q(tied)},${q(other.id)},'pagada',10000);
    INSERT INTO public.casa_picks(entry_id,polla_id,user_id,question_id,option_id) SELECT id,polla_id,user_id,${q(question)},${q(yes)} FROM public.casa_entries WHERE polla_id=${q(tied)};
    SELECT public.casa_resolve_question_v2(${q(tied)},${q(question)},${q(yes)},NULL,2,${q(admin.id)},NULL);
    SELECT public.casa_change_status_v2(${q(tied)},'cerrar',2,${q(admin.id)},NULL);
    SELECT public.casa_settle_polla_v2(${q(tied)},2,${q(admin.id)},NULL); COMMIT;`);
  await screen(player,'empate-participante',`/casa/${tiedSlug}`);
  await screen(admin,'empate-administrador',`/casa/${tiedSlug}`);
  const tiedData = await api(admin,`/api/casa/pollas/${tiedSlug}/award`,null,'GET');
  assert.equal(tiedData.candidates.length,2);
  assert.equal(tiedData.payouts.length,0);
  const recording = await admin.page.evaluate(async () => {
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
    const ctx=canvas.getContext('2d');ctx.fillStyle='black';ctx.fillRect(0,0,640,360);ctx.fillStyle='white';ctx.font='25px sans-serif';ctx.fillText('EVIDENCIA LOCAL DE PRUEBA',50,100);
    const stream=canvas.captureStream(10);const recorder=new MediaRecorder(stream,{mimeType:'video/webm'});const chunks=[];
    const finished=new Promise((resolve)=> { recorder.ondataavailable=e=>chunks.push(e.data);recorder.onstop=()=>resolve(new Blob(chunks,{type:'video/webm'})); });
    recorder.start();await new Promise(r=>setTimeout(r,600));recorder.stop();const blob=await finished;stream.getTracks().forEach(t=>t.stop());
    return await new Promise(r=> { const reader=new FileReader();reader.onload=()=>r(reader.result.split(',')[1]);reader.readAsDataURL(blob); });
  });
  const video=Buffer.from(recording,'base64'), sha256=createHash('sha256').update(video).digest('hex'), requestId=randomUUID();
  const awardPath=`/api/casa/pollas/${tiedSlug}/award`;
  const begin=await api(admin,awardPath,{action:'begin',drawId:tiedData.draw.id,winnerId:player.id,requestId,sha256,contentType:'video/webm',bytes:video.length});
  const corrupt=await db.storage.from(begin.upload.bucket).uploadToSignedUrl(begin.upload.path,begin.upload.token,Buffer.from([26,69,223,163]),{contentType:'video/webm',upsert:false});
  if(corrupt.error)throw corrupt.error;
  const invalid=await api(admin,awardPath,{action:'confirm',attemptId:begin.attempt_id},'POST',409);assert.equal(invalid.code,'UPLOAD_MISMATCH');
  const retry=await api(admin,awardPath,{action:'retry',attemptId:begin.attempt_id});assert.notEqual(retry.attempt_id,begin.attempt_id);
  const replay=await api(admin,awardPath,{action:'retry',attemptId:begin.attempt_id});assert.equal(replay.attempt_id,retry.attempt_id);
  const valid=await db.storage.from(retry.upload.bucket).uploadToSignedUrl(retry.upload.path,retry.upload.token,video,{contentType:'video/webm',upsert:false});if(valid.error)throw valid.error;
  await admin.page.evaluate(({key,value})=>sessionStorage.setItem(key,value),{key:`casa-draw:${tiedData.draw.id}:${player.id}:${sha256}`,value:requestId});
  await admin.page.getByLabel('Ganador que aparece en la grabación').selectOption(player.id);
  await admin.page.getByLabel('Grabación del sorteo',{exact:true}).setInputFiles({name:'sorteo-local.webm',mimeType:'video/webm',buffer:video});
  await admin.page.getByRole('checkbox').check();
  await admin.page.getByRole('button',{name:'Adjudicar el objeto',exact:true}).click();
  await admin.page.getByRole('button',{name:'Confirmar que entregué el objeto',exact:true}).waitFor({timeout:60000});
  const final=await api(player,awardPath,null,'GET');assert.equal(final.payouts.length,1);assert.equal(final.payouts[0].amount_cop,0);assert.ok(final.evidenceUrl);
  const evidence=await player.context.request.get(final.evidenceUrl);assert.equal(evidence.status(),200);assert.equal((await evidence.body()).length,video.length);
  const idem=await api(admin,awardPath,{action:'confirm',attemptId:retry.attempt_id});assert.equal(idem.changed,false);
  await screen(player,'desempate-resuelto',`/casa/${tiedSlug}`);
  paths.tiedSlug=tiedSlug;
  // New tables/RPCs must remain inaccessible using the normal authenticated JWT.
  const raw=await createClient(localUrl,keys.anon,{auth:{persistSession:false}}).rpc('casa_settle_polla_v2',{p_polla_id:tied,p_contract:2,p_actor_id:admin.id});
  assert.ok(raw.error,'Anonymous RPC calls must fail even with a known administrator UUID');
  await writeFile(`${output}/fixtures.json`,JSON.stringify(paths,null,2));
  console.log('PASS real browser -> API -> private Storage -> proof approval -> SQL award -> object delivery');
} finally { await browser.close(); }
