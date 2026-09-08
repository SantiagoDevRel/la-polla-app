// Read-only fixture export + verified, same-origin club crests. Never writes to DB.
// Run: node --experimental-strip-types scripts/bake-team-crests.mjs
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { CREATABLE_TOURNAMENT_SLUGS } from "../lib/tournaments.ts";
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
]);

async function main() {
  dotenv.config({ path: path.join(repo, ".env.local"), quiet: true });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing local Supabase environment variables.");
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db
      .from("matches")
      .select("tournament,home_team,away_team,home_team_flag,away_team_flag,scheduled_at")
      .in("tournament", [...CREATABLE_TOURNAMENT_SLUGS])
      .order("scheduled_at", { ascending: false })
      .order("id", { ascending: true })
      .range(offset, offset + 999);
    if (error) throw new Error(`Fixture read failed: ${error.code}`);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  if (!rows.length) throw new Error("No fixtures; existing catalog was preserved.");

  const urls = [...new Set(rows.flatMap((row) => [row.home_team_flag, row.away_team_flag]).filter(Boolean))].sort();
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
      const response = await fetch(source, { redirect: "error", signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`Crest HTTP ${response.status}: ${source}`);
      const original = Buffer.from(await response.arrayBuffer());
      const metadata = await sharp(original).metadata();
      if (!metadata.width || !metadata.height) throw new Error(`Invalid image: ${source}`);
      const image = await sharp(original)
        .resize(96, 96, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 88 })
        .toBuffer();
      const hash = createHash("sha256").update(image).digest("hex").slice(0, 16);
      downloaded.set(source, { filename: `${hash}-96.webp`, image });
    }
  }));

  // Only publish after every source has decoded. Keep older entries/assets.
  let previous = { bySource: {}, byName: {} };
  try {
    previous = JSON.parse(await readFile(catalogPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const bySource = { ...previous.bySource };
  const byName = { ...previous.byName };
  await mkdir(assetDir, { recursive: true });
  for (const source of urls) {
    const { filename, image } = downloaded.get(source);
    await writeFile(path.join(assetDir, filename), image);
    bySource[source] = `/team-crests/${filename}`;
  }
  const seenNames = new Set();
  for (const row of rows) {
    for (const side of ["home", "away"]) {
      const name = teamNameKey(row[`${side}_team`]);
      const source = row[`${side}_team_flag`];
      // Exact observed names only. No fuzzy matching between different clubs.
      if (source && !seenNames.has(name)) {
        byName[name] = bySource[source];
        seenNames.add(name);
      }
    }
  }
  const sorted = (record) => Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(catalogPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    tournaments: [...CREATABLE_TOURNAMENT_SLUGS],
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
