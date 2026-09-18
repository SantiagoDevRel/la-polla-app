// Read-only fixture export + verified, same-origin club crests. Never writes to DB.
// Run: node --experimental-strip-types scripts/bake-team-crests.mjs
// World Cup squad club crests only (no DB, no API-Football calls):
//      node --experimental-strip-types scripts/bake-team-crests.mjs --worldcup-squads
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { TOURNAMENTS } from "../lib/tournaments.ts";
import { RESULT_LEAGUES } from "../lib/api-football/leagues.ts";
import { flagUrlForTeam } from "../lib/flags/country-iso.ts";
import { isPlaceholderTeam } from "../lib/matches/is-placeholder.ts";
import { teamNameKey } from "../lib/teams/team-name-key.ts";
import reviewedLeagues from "../lib/teams/league-logo-overrides.json" with { type: "json" };
import reviewedTeams from "../lib/teams/crest-overrides.json" with { type: "json" };
import sharedCrests from "../lib/teams/shared-crests.json" with { type: "json" };

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
// Sharp ships with the installed Next package; no additional dependency.
const sharp = createRequire(require.resolve("next/package.json"))("sharp");
const catalogPath = path.join(repo, "lib/teams/crest-catalog.json");
const squadsPath = path.join(repo, "lib/teams/baked-worldcup-squads.json");
const squadCrestsPath = path.join(repo, "lib/teams/worldcup-club-crests.json");
const assetDir = path.join(repo, "public/team-crests");
const hosts = new Set([
  "crests.football-data.org",
  "a.espncdn.com",
  "upload.wikimedia.org",
  "media.api-sports.io",
]);
const arg = name => { const index=process.argv.indexOf(name); return index<0?null:process.argv[index+1]; };

/**
 * Downloads (or reuses an already baked asset), validates and converts each
 * source to a 96 px WebP. `strict` aborts on the first bad source (fixtures and
 * current clubs must all be covered); otherwise bad sources are reported and
 * left out, so the UI shows no crest instead of a wrong or broken one.
 */
async function bakeSources(urls, previousBySource, {strict}) {
  const downloaded = new Map();
  const rejected = [];
  let next = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < urls.length) {
      const source = urls[next++];
      try {
        const parsed = new URL(source);
        if (parsed.protocol !== "https:" || !hosts.has(parsed.hostname)) {
          throw new Error(`Unreviewed crest host: ${parsed.hostname}`);
        }
        // Do not follow a provider redirect to an unreviewed host.
        let original;
        const existing=previousBySource[source];
        if(existing)original=await readFile(path.join(repo,'public',existing));
        else {
          const response = await fetch(source, { redirect: "error", signal: AbortSignal.timeout(15000) });
          if (!response.ok) throw new Error(`Crest HTTP ${response.status}: ${source}`);
          original = Buffer.from(await response.arrayBuffer());
        }
        if(original.length>2*1024*1024)throw new Error(`Oversized crest: ${source}`);
        const metadata = await sharp(original).metadata();
        if (!metadata.width || !metadata.height) throw new Error(`Invalid image: ${source}`);
        const stats=await sharp(original).flatten({background:'#f5f7fa'}).stats();
        if(stats.channels.every(c=>c.stdev<3))throw new Error(`Blank image: ${source}`);
        const image = existing ? original : await sharp(original)
          .resize(96, 96, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 88 })
          .toBuffer();
        const hash = createHash("sha256").update(image).digest("hex").slice(0, 16);
        downloaded.set(source, { filename: `${hash}-96.webp`, local: existing, image });
      } catch (error) {
        if (strict) throw error;
        rejected.push({ source, reason: error.message });
      }
    }
  }));
  return { downloaded, rejected };
}

async function apiInventory() {
  const file=arg('--inventory');
  if(file)return JSON.parse(await readFile(file,'utf8'));
  if(!process.env.API_FOOTBALL_KEY)throw new Error('API_FOOTBALL_KEY is required to cover every current club.');
  // Un tropiezo del proveedor a mitad del recorrido dejaba el catálogo sin
  // escribir y obligaba a repetir TODAS las llamadas. Tres intentos espaciados
  // por endpoint: sigue siendo una corrida acotada y no enmascara un fallo real.
  async function api(endpoint) {
    let last;
    for(let attempt=1;attempt<=3;attempt++) {
      try {
        const response=await fetch(`https://v3.football.api-sports.io${endpoint}`,{headers:{'x-apisports-key':process.env.API_FOOTBALL_KEY},signal:AbortSignal.timeout(20000)});
        const body=await response.json();
        if(!response.ok||Object.keys(body.errors??{}).length)throw new Error(`HTTP ${response.status} ${JSON.stringify(body.errors??{})}`);
        return body.response;
      } catch(error) {
        last=error;
        if(attempt<3)await new Promise(resolve=>setTimeout(resolve,2000*attempt));
      }
    }
    throw new Error(`API-Football inventory failed: ${endpoint} — ${last?.message}`);
  }
  // Una corrida explícita de mantenimiento gasta 1 + 2 por liga (/leagues y
  // /teams). Se exige ese consumo más un margen, para no dejar al runtime sin
  // cuota. Las solicitudes del runtime siguen bajo las reservas atómicas.
  const needed=1+2*Object.keys(RESULT_LEAGUES).length;
  const status=await api('/status');
  if(status.subscription.plan==='Free'||status.requests.limit_day-status.requests.current<needed+20)throw new Error(`A paid plan and ${needed+20} available requests are required.`);
  const inventory=[];
  for(const [slug,id]of Object.entries(RESULT_LEAGUES)) {
    const league=(await api(`/leagues?id=${id}`))[0];
    const season=league?.seasons.find(s=>s.current);
    if(!season)throw new Error(`No verified current season for ${slug}`);
    console.log(`Verified provider season: ${slug} = ${season.year}`);
    const teams=await api(`/teams?league=${id}&season=${season.year}`);
    if(!teams.length)throw new Error(`Empty inventory for ${slug}`);
    inventory.push({slug,id,season:season.year,logo:league.league.logo,teams});
  }
  return inventory;
}

/**
 * World Cup squads: every player's club crest was an ESPN hotlink. Bake them
 * into the same local asset folder and write a server-only map (the roster
 * route uses it; the client catalog does not grow). Identity rule: one ESPN
 * club id per club name. An image shared by two different ids is a generic
 * placeholder and is left out, never shown as a club crest.
 */
async function bakeWorldCupSquadCrests() {
  const squads = JSON.parse(await readFile(squadsPath, "utf8"));
  const clubsBySource = new Map();
  for (const players of Object.values(squads)) {
    for (const player of players) {
      if (!player.clubCrest) continue;
      const clubs = clubsBySource.get(player.clubCrest) ?? new Set();
      if (player.club) clubs.add(player.club);
      clubsBySource.set(player.clubCrest, clubs);
    }
  }
  const urls = [...clubsBySource.keys()].sort();
  let catalog = { bySource: {} };
  try { catalog = JSON.parse(await readFile(catalogPath, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  let previous = { bySource: {} };
  try { previous = JSON.parse(await readFile(squadCrestsPath, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const known = { ...catalog.bySource, ...previous.bySource };
  const { downloaded, rejected } = await bakeSources(urls, known, { strict: false });

  const byHash = new Map();
  for (const [source, asset] of downloaded) {
    const hash = createHash("sha256").update(asset.image).digest("hex");
    byHash.set(hash, [...(byHash.get(hash) ?? []), source]);
  }
  for (const sources of byHash.values()) {
    if (sources.length < 2) continue;
    for (const source of sources) {
      downloaded.delete(source);
      rejected.push({ source, reason: `Shared image across ${sources.length} club ids` });
    }
  }
  // Spelling variants of one club (Fenerbahçe / Fenerbahce) are the same identity.
  const conflicting = [...clubsBySource].filter(([, clubs]) => new Set([...clubs].map(teamNameKey)).size > 1);
  for (const [source, clubs] of conflicting) {
    downloaded.delete(source);
    rejected.push({ source, reason: `One id for several clubs: ${[...clubs].join(" / ")}` });
  }

  await mkdir(assetDir, { recursive: true });
  const bySource = {};
  const clubs = {};
  for (const source of urls) {
    const asset = downloaded.get(source);
    if (!asset) continue;
    if (!asset.local) await writeFile(path.join(assetDir, asset.filename), asset.image);
    bySource[source] = asset.local ?? `/team-crests/${asset.filename}`;
    clubs[source] = [...clubsBySource.get(source)].join(" / ");
  }
  await writeFile(squadCrestsPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: "lib/teams/baked-worldcup-squads.json",
    bySource,
    clubs,
  }, null, 2)}\n`);
  for (const item of rejected) console.warn(`Left out ${item.source}: ${item.reason}`);
  console.log(`World Cup squads: ${Object.keys(bySource).length}/${urls.length} club crests baked, ${rejected.length} left out. No database or API-Football calls.`);
}

async function main() {
  if (process.argv.includes("--worldcup-squads")) return bakeWorldCupSquadCrests();
  dotenv.config({ path: path.join(repo, ".env.local"), quiet: true });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing local Supabase environment variables.");
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const fixtureFile=arg('--fixtures');
  const rows = fixtureFile?JSON.parse(await readFile(fixtureFile,'utf8')):[];
  for (let offset = 0; !fixtureFile; offset += 1000) {
    const { data, error } = await db
      .from("matches")
      .select("tournament,home_team,away_team,home_team_flag,away_team_flag,scheduled_at")
      .in("tournament", TOURNAMENTS.map(t=>t.slug))
      .order("scheduled_at", { ascending: false })
      .order("id", { ascending: true })
      .range(offset, offset + 999);
    if (error) throw new Error(`Fixture read failed: ${error.code}`);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  if (!rows.length) throw new Error("No fixtures; existing catalog was preserved.");
  const inventory=await apiInventory();
  if(inventory.length!==Object.keys(RESULT_LEAGUES).length)throw new Error('Incomplete league inventory');
  const apiTeams=[...new Map(inventory.flatMap(l=>l.teams.map(t=>[t.team.id,t.team]))).values()];
  let previous = { bySource: {}, byName: {} };
  try { previous=JSON.parse(await readFile(catalogPath,'utf8')); } catch(error) {if(error.code!=='ENOENT')throw error;}
  const required=rows.flatMap(row=>['home','away'].filter(side=>!isPlaceholderTeam(row[`${side}_team`])).map(side=>({name:row[`${side}_team`],source:row[`${side}_team_flag`]})));

  const urls = [...new Set([...required.filter(t=>!flagUrlForTeam(t.name)).map(t=>t.source),...apiTeams.map(t=>t.logo),...inventory.map(l=>l.logo)].filter(Boolean))].sort();
  const { downloaded } = await bakeSources(urls, previous.bySource, { strict: true });

  // Only publish after every source has decoded. Keep older entries/assets.
  // A repeated image across distinct provider IDs is usually a generic placeholder.
  // El proveedor a veces sirve la MISMA imagen para dos clubes reales distintos
  // (el Vasco da Gama de Acre trae el escudo del Vasco de Río). Mostrar ese
  // escudo sería afirmar una identidad falsa, así que esos clubes se quedan sin
  // escudo — nunca con el del otro. Se juntan TODOS antes de decidir: un
  // conflicto que no esté revisado en shared-crests.json aborta la corrida.
  const apiHashes=new Map();
  const conflicts=new Map();
  for(const team of apiTeams){
    const hash=downloaded.get(team.logo).filename;
    const owner=apiHashes.get(hash);
    if(owner){
      const group=conflicts.get(hash)??new Set([owner]);
      group.add(team.name); conflicts.set(hash,group);
    } else apiHashes.set(hash,team.name);
  }
  const sharedTeams=new Set();
  const sharedSources=new Set();
  if(conflicts.size){
    const groups=[...conflicts.values()].map(g=>[...g].sort());
    const reviewed=new Map(Object.entries(sharedCrests).map(([k,v])=>[k.toLowerCase(),v]));
    const unreviewed=groups.filter(g=>!reviewed.has(g.join(' | ').toLowerCase()));
    if(unreviewed.length)throw new Error(`Escudos duplicados sin revisar. Comprobá la identidad de cada club (id, fundación, estadio) y agregá la entrada en lib/teams/shared-crests.json indicando cuál lo conserva: ${JSON.stringify(unreviewed)}`);
    for(const group of groups){
      // `keep` es el dueño verificado: los demás se quedan sin escudo, porque
      // el del otro club sería una identidad falsa.
      const {keep}=reviewed.get(group.join(' | ').toLowerCase());
      if(!group.includes(keep))throw new Error(`shared-crests.json: "${keep}" no es uno de ${JSON.stringify(group)}`);
      for(const name of group) if(name!==keep) {
        sharedTeams.add(teamNameKey(name));
        // También se saca su URL: `localCrestSource` resuelve por URL antes que
        // por nombre, así que dejarla registrada devolvería el escudo ajeno.
        for(const team of apiTeams) if(team.name===name) sharedSources.add(team.logo);
      }
      console.warn(`Escudo duplicado por el proveedor: lo conserva ${keep}; sin escudo ${group.filter(n=>n!==keep).join(' | ')}`);
    }
  }
  const bySource = { ...previous.bySource };
  const byName = { ...previous.byName };
  await mkdir(assetDir, { recursive: true });
  for (const source of urls) {
    const { filename, image } = downloaded.get(source);
    await writeFile(path.join(assetDir, filename), image);
    if (!sharedSources.has(source)) bySource[source] = `/team-crests/${filename}`;
  }
  const seenNames = new Set();
  for(const team of apiTeams){
    if(sharedTeams.has(teamNameKey(team.name)))continue;
    byName[teamNameKey(team.name)]=bySource[team.logo];
  }
  for (const row of rows) {
    for (const side of ["home", "away"]) {
      const name = teamNameKey(row[`${side}_team`]);
      const source = row[`${side}_team_flag`];
      // Exact observed names only. No fuzzy matching between different clubs.
      const flag=flagUrlForTeam(row[`${side}_team`]);
      if ((flag||bySource[source]) && !seenNames.has(name)) {
        byName[name] = flag??bySource[source];
        seenNames.add(name);
      }
    }
  }
  // El catálogo conserva lo horneado antes, así que un club que pasa a estar
  // sin escudo (porque el proveedor le sirve el de otro) tiene que perder
  // también la entrada vieja: si no, seguiría mostrando la identidad ajena.
  for(const source of sharedSources) delete bySource[source];
  for(const name of sharedTeams) delete byName[name];
  const sorted = (record) => Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
  const missing=required.filter(t=>!bySource[t.source]&&!byName[teamNameKey(t.name)]);
  if(missing.length)throw new Error(`Missing club crests: ${JSON.stringify(missing)}`);
  // Preserve reviewed transparent artwork across future provider refreshes.
  for (const team of apiTeams) {
    const local = reviewedTeams[teamNameKey(team.name)]?.local;
    if (local) { await readFile(path.join(repo, 'public', local)); bySource[team.logo] = local; byName[teamNameKey(team.name)] = local; }
  }
  const leagues=Object.fromEntries(inventory.map(l=>[l.slug,reviewedLeagues[l.slug]??bySource[l.logo]]));
  await writeFile(path.join(repo,'lib/teams/league-logos.json'),JSON.stringify(leagues,null,2)+'\n');
  await writeFile(path.join(repo,'lib/teams/crest-coverage.json'),JSON.stringify({
    generatedAt:new Date().toISOString(),fixtures:rows.length,
    sharedCrestTeams:[...new Set(apiTeams.filter(t=>sharedTeams.has(teamNameKey(t.name))).map(t=>t.name))].sort(),
   leagues:inventory.map(l=>({slug:l.slug,id:l.id,season:l.season,teams:l.teams.map(t=>({id:t.team.id,name:t.team.name,source:t.team.logo}))})),
    observedTeams:[...new Map(required.map(t=>[teamNameKey(t.name),{name:t.name,source:t.source}])).values()],
  },null,2)+'\n');
  await writeFile(catalogPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    tournaments: TOURNAMENTS.map(t=>t.slug),
    bySource: sorted(bySource),
    byName: sorted(byName),
  }, null, 2)}\n`);
  const totalBytes = [...downloaded.values()].reduce((sum, asset) => sum + asset.image.length, 0);
  console.log(`Verified ${urls.length} crest sources, ${seenNames.size} observed team names, ${rows.length} fixtures; ${totalBytes} bytes at 96 px. No database writes.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
