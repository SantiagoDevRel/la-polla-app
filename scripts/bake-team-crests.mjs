// Read-only fixture export + verified, same-origin club crests. Never writes to DB.
// Run: node --experimental-strip-types scripts/bake-team-crests.mjs
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

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
// Sharp ships with the installed Next package; no additional dependency.
const sharp = createRequire(require.resolve("next/package.json"))("sharp");
const catalogPath = path.join(repo, "lib/teams/crest-catalog.json");
const assetDir = path.join(repo, "public/team-crests");
const hosts = new Set([
  "crests.football-data.org",
  "a.espncdn.com",
  "upload.wikimedia.org",
  "media.api-sports.io",
]);
const arg = name => { const index=process.argv.indexOf(name); return index<0?null:process.argv[index+1]; };

async function apiInventory() {
  const file=arg('--inventory');
  if(file)return JSON.parse(await readFile(file,'utf8'));
  if(!process.env.API_FOOTBALL_KEY)throw new Error('API_FOOTBALL_KEY is required to cover every current club.');
  async function api(endpoint) {
    const response=await fetch(`https://v3.football.api-sports.io${endpoint}`,{headers:{'x-apisports-key':process.env.API_FOOTBALL_KEY},signal:AbortSignal.timeout(20000)});
    const body=await response.json();
    if(!response.ok||Object.keys(body.errors??{}).length)throw new Error(`API-Football inventory failed: ${endpoint}`);
    return body.response;
  }
  // An explicit maintenance run uses at most 18 calls from the manual reserve.
  // Runtime requests remain governed by the atomic database reservations.
  const status=await api('/status');
  if(status.subscription.plan==='Free'||status.requests.limit_day-status.requests.current<50)throw new Error('A paid plan and 50 available requests are required.');
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

async function main() {
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
  const downloaded = new Map();
  let next = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < urls.length) {
      const source = urls[next++];
      const parsed = new URL(source);
      if (parsed.protocol !== "https:" || !hosts.has(parsed.hostname)) {
        throw new Error(`Unreviewed crest host: ${parsed.hostname}`);
      }
      // Do not follow a provider redirect to an unreviewed host.
      let original;
      const existing=previous.bySource[source];
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
      downloaded.set(source, { filename: `${hash}-96.webp`, image });
    }
  }));

  // Only publish after every source has decoded. Keep older entries/assets.
  // A repeated image across distinct provider IDs is usually a generic placeholder.
  const apiHashes=new Map();
  for(const team of apiTeams){const hash=downloaded.get(team.logo).filename;if(apiHashes.has(hash))throw new Error(`Shared/generic crest: ${team.name} and ${apiHashes.get(hash)}`);apiHashes.set(hash,team.name);}
  const bySource = { ...previous.bySource };
  const byName = { ...previous.byName };
  await mkdir(assetDir, { recursive: true });
  for (const source of urls) {
    const { filename, image } = downloaded.get(source);
    await writeFile(path.join(assetDir, filename), image);
    bySource[source] = `/team-crests/${filename}`;
  }
  const seenNames = new Set();
  for(const team of apiTeams)byName[teamNameKey(team.name)]=bySource[team.logo];
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
  const sorted = (record) => Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
  const missing=required.filter(t=>!bySource[t.source]&&!byName[teamNameKey(t.name)]);
  if(missing.length)throw new Error(`Missing club crests: ${JSON.stringify(missing)}`);
  const leagues=Object.fromEntries(inventory.map(l=>[l.slug,bySource[l.logo]]));
  await writeFile(path.join(repo,'lib/teams/league-logos.json'),JSON.stringify(leagues,null,2)+'\n');
  await writeFile(path.join(repo,'lib/teams/crest-coverage.json'),JSON.stringify({
    generatedAt:new Date().toISOString(),fixtures:rows.length,
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
