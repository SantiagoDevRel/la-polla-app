// scripts/verify-backup.ts — ¿el backup sigue sirviendo?
//
// Un backup que nadie verificó es una promesa, no un respaldo. Este script
// abre una carpeta generada por `export-backup.ts` y confirma que sigue
// entera: cada tabla trae sus filas y su sha256, y cada archivo de auth,
// Storage y esquema coincide byte a byte (sha256 + tamaño) con el
// manifiesto. Un archivo que falte, cambie o sobre es un problema. Corre
// 100% OFFLINE — sirve dentro de dos años en el DGX, sin internet y sin que
// el proyecto Supabase exista.
//
//   npx tsx scripts/verify-backup.ts                      # el backup más nuevo
//   npx tsx scripts/verify-backup.ts backups/2026-07-26-21-11
//   npx tsx scripts/verify-backup.ts --json               # una línea JSON, para máquinas
//   MAX_AGE_HOURS=7 npx tsx scripts/verify-backup.ts      # además falla si el backup es viejo
//   ONLINE=1 npx tsx scripts/verify-backup.ts             # + compara contra la DB viva
//
// Las carpetas `<stamp>.partial` (un export que no terminó) se ignoran al
// buscar el más nuevo y se rechazan si se pasan a mano.
//
// Sale con código 1 si algo no cuadra, así que se puede encadenar
// (ej: verificar antes de cifrar y copiar al DGX).
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { promises as fs } from "fs";
import path from "path";
import {
  backupAgeHours,
  FileManifest,
  isPartialBackupDir,
  parseMaxAgeHours,
  pickNewestBackup,
  sha256Hex,
  verifyFileManifest,
} from "./backup/core";

type Manifest = {
  formatVersion?: number;
  generatedAt: string;
  projectRef: string;
  totals: { tables: number; rows: number; storageFiles: number; storageBytes: number };
  auth: { mode: string; users: number; identities: number };
  tables: Record<string, { rows: number; bytes: number; sha256: string }>;
  files?: FileManifest;
  schemaLive?: { mode: string; errors: string[]; warnings: string[] };
  migrations: string[];
};

// quiet: dotenv 17 imprime un aviso en stdout que rompería la salida --json.
loadEnv({ quiet: true, path: process.env.DOTENV_CONFIG_PATH });

const REPO_ROOT = path.resolve(__dirname, "..");
const ARGS = process.argv.slice(2);
const JSON_OUT = ARGS.includes("--json");
const DIR_ARG = ARGS.find((a) => !a.startsWith("--"));

function say(msg: string) {
  if (!JSON_OUT) console.log(msg);
}

async function newestBackup(): Promise<string> {
  const root = process.env.BACKUP_DIR
    ? path.resolve(process.env.BACKUP_DIR)
    : path.join(REPO_ROOT, "backups");
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const newest = pickNewestBackup(entries.filter((e) => e.isDirectory()).map((e) => e.name));
  if (!newest) throw new Error(`No hay backups terminados en ${root}. Corre scripts/export-backup.ts primero.`);
  return path.join(root, newest);
}

/** Todas las rutas relativas (con `/`) de archivos bajo `root`. */
async function listFiles(root: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(path.join(root, ...prefix.split("/").filter(Boolean)), { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await listFiles(root, rel)));
    else out.push(rel);
  }
  return out;
}

async function readRel(dir: string, rel: string): Promise<Buffer | null> {
  return fs.readFile(path.join(dir, ...rel.split("/"))).catch(() => null);
}

type Report = {
  ok: boolean;
  dir: string | null;
  formatVersion: number | null;
  projectRef: string | null;
  generatedAt: string | null;
  ageHours: number | null;
  maxAgeHours: number | null;
  tables: number;
  rows: number;
  authMode: string | null;
  authUsers: number;
  authIdentities: number;
  storageFiles: number;
  storageBytes: number;
  filesVerified: number;
  problems: string[];
  warnings: string[];
};

async function verify(report: Report): Promise<void> {
  const problems = report.problems;
  const warnings = report.warnings;

  const maxAge = parseMaxAgeHours(process.env.MAX_AGE_HOURS);
  report.maxAgeHours = maxAge;

  const dir = DIR_ARG ? path.resolve(DIR_ARG) : await newestBackup();
  report.dir = dir;
  if (isPartialBackupDir(path.basename(dir))) {
    problems.push(`${path.basename(dir)} es un export que no terminó (.partial): no es un backup válido`);
    return;
  }
  say(`\n=== Verificando backup ===\n${dir}\n`);

  let manifest: Manifest;
  try {
    manifest = JSON.parse(await fs.readFile(path.join(dir, "_manifest.json"), "utf8")) as Manifest;
  } catch (err) {
    problems.push(`_manifest.json ilegible o ausente (${(err as Error).message})`);
    return;
  }
  const version = manifest.formatVersion ?? 1;
  report.formatVersion = version;
  report.projectRef = manifest.projectRef;
  report.generatedAt = manifest.generatedAt;
  report.authMode = manifest.auth?.mode ?? null;
  say(`Tomado el ${manifest.generatedAt} · proyecto ${manifest.projectRef} · formato ${version}\n`);

  // 0) Frescura.
  const age = backupAgeHours(manifest.generatedAt, new Date());
  report.ageHours = Number.isNaN(age) ? null : Math.round(age * 100) / 100;
  if (Number.isNaN(age)) problems.push(`generatedAt ilegible: "${manifest.generatedAt}"`);
  else if (maxAge !== null && age > maxAge) {
    problems.push(`el backup tiene ${age.toFixed(1)} h y MAX_AGE_HOURS=${maxAge}`);
  }

  // 1) Integridad de cada tabla: sha256 + filas.
  for (const [table, meta] of Object.entries(manifest.tables)) {
    const buf = await readRel(dir, `tables/${table}.json`);
    if (!buf) {
      problems.push(`${table}: FALTA el archivo tables/${table}.json`);
      continue;
    }
    if (sha256Hex(buf) !== meta.sha256) {
      problems.push(`${table}: sha256 no coincide (archivo corrupto o editado a mano)`);
      continue;
    }
    let rows: unknown;
    try {
      rows = JSON.parse(buf.toString("utf8"));
    } catch (err) {
      problems.push(`${table}: JSON ilegible — ${(err as Error).message}`);
      continue;
    }
    if (!Array.isArray(rows) || rows.length !== meta.rows) {
      problems.push(`${table}: ${Array.isArray(rows) ? rows.length : "?"} filas, el manifiesto dice ${meta.rows}`);
      continue;
    }
    report.tables++;
    report.rows += rows.length;
  }
  const onDisk = await listFiles(dir);
  for (const rel of onDisk) {
    const m = /^tables\/(.+)\.json$/.exec(rel);
    if (m && !manifest.tables[m[1]]) problems.push(`${rel}: está en disco pero no en el manifiesto`);
  }

  if (version >= 2 && manifest.files) {
    // 2) Auth, Storage, esquema, RESUMEN y README: sha256 + bytes + sobrantes.
    const tracked = onDisk.filter((rel) => rel !== "_manifest.json" && !rel.startsWith("tables/"));
    const res = await verifyFileManifest(manifest.files, (rel) => readRel(dir, rel), tracked);
    problems.push(...res.problems);
    report.filesVerified = res.checked;

    // Coherencia de totales declarados con el inventario de archivos.
    const storageEntries = Object.entries(manifest.files).filter(([rel]) => rel.startsWith("storage/"));
    const storageBytes = storageEntries.reduce((a, [, e]) => a + e.bytes, 0);
    report.storageFiles = storageEntries.length;
    report.storageBytes = storageBytes;
    if (storageEntries.length !== manifest.totals.storageFiles || storageBytes !== manifest.totals.storageBytes) {
      problems.push(
        `storage: el inventario suma ${storageEntries.length} archivos / ${storageBytes} bytes y los totales dicen ` +
          `${manifest.totals.storageFiles} / ${manifest.totals.storageBytes}`,
      );
    }

    if (manifest.auth.mode === "full") {
      for (const [rel, expected, label] of [
        ["auth/users.full.json", manifest.auth.users, "usuarios"],
        ["auth/identities.full.json", manifest.auth.identities, "identities"],
      ] as const) {
        if (!manifest.files[rel]) {
          problems.push(`auth: ${rel} no está en el manifiesto`);
          continue;
        }
        const buf = await readRel(dir, rel);
        const parsed = buf ? (JSON.parse(buf.toString("utf8")) as unknown) : null;
        if (!Array.isArray(parsed) || parsed.length !== expected) {
          problems.push(`auth: ${Array.isArray(parsed) ? parsed.length : "?"} ${label} en disco, el manifiesto dice ${expected}`);
        }
      }
      if (!manifest.files["auth/restore-auth.sql"]) problems.push("auth: falta restore-auth.sql en el manifiesto");
    }
    for (const e of manifest.schemaLive?.errors ?? []) warnings.push(`schema/live: ${e}`);
    for (const w of manifest.schemaLive?.warnings ?? []) warnings.push(`schema/live: ${w}`);
  } else {
    // Formato 1 (backups anteriores al 2026-09-13): sin hashes de Storage ni auth.
    warnings.push("formato 1: Storage y auth solo se pueden contar, no comparar por sha256");
    if (manifest.auth.mode === "full") {
      for (const f of ["users.full.json", "identities.full.json", "restore-auth.sql"]) {
        if (!onDisk.includes(`auth/${f}`)) problems.push(`auth: falta ${f}`);
      }
      const buf = await readRel(dir, "auth/users.full.json");
      const users = buf ? (JSON.parse(buf.toString("utf8")) as unknown) : [];
      if (Array.isArray(users) && users.length !== manifest.auth.users) {
        problems.push(`auth: ${users.length} usuarios en disco, el manifiesto dice ${manifest.auth.users}`);
      }
    }
    const storageFiles = onDisk.filter((rel) => rel.startsWith("storage/")).length;
    report.storageFiles = storageFiles;
    report.storageBytes = manifest.totals.storageBytes;
    if (storageFiles !== manifest.totals.storageFiles) {
      problems.push(`storage: ${storageFiles} archivos en disco, el manifiesto dice ${manifest.totals.storageFiles}`);
    }
    const migs = onDisk.filter((rel) => /^schema\/migrations\/[^/]+\.sql$/.test(rel));
    if (migs.length !== manifest.migrations.length) {
      problems.push(`schema: ${migs.length} migraciones en disco, el manifiesto dice ${manifest.migrations.length}`);
    }
  }
  if (manifest.auth.mode === "skipped") {
    warnings.push("este backup NO tiene auth (SKIP_PII=1): no alcanza para reabrir con las mismas cuentas");
  }
  report.authUsers = manifest.auth.users;
  report.authIdentities = manifest.auth.identities ?? 0;

  say(`Tablas     : ${report.tables} · ${report.rows.toLocaleString("es-CO")} filas verificadas`);
  say(`Auth       : ${manifest.auth.users} cuentas (${manifest.auth.mode})`);
  say(`Storage    : ${report.storageFiles} archivos · ${(report.storageBytes / 1024 / 1024).toFixed(1)} MB`);
  say(`Archivos   : ${report.filesVerified} con sha256 verificado`);
  say(`Antigüedad : ${report.ageHours ?? "?"} h${maxAge !== null ? ` (máximo ${maxAge} h)` : ""}`);

  // 3) Opcional: comparar contra la DB viva. Detecta un backup viejo
  //    respecto de la realidad (o que ya no exista el proyecto).
  if (process.env.ONLINE === "1") {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      problems.push("ONLINE=1 pero faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    } else {
      say(`\nComparando contra la DB viva…`);
      const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      for (const [table, meta] of Object.entries(manifest.tables)) {
        const { count, error } = await sb.from(table).select("*", { count: "exact", head: true });
        if (error) {
          problems.push(`${table}: no pude contar en la DB (${error.message})`);
        } else if ((count ?? 0) !== meta.rows) {
          warnings.push(`${table}: la DB tiene ${count} filas y el backup ${meta.rows} (la DB cambió desde el backup)`);
        }
      }
    }
  }
}

async function main() {
  const report: Report = {
    ok: false,
    dir: null,
    formatVersion: null,
    projectRef: null,
    generatedAt: null,
    ageHours: null,
    maxAgeHours: null,
    tables: 0,
    rows: 0,
    authMode: null,
    authUsers: 0,
    authIdentities: 0,
    storageFiles: 0,
    storageBytes: 0,
    filesVerified: 0,
    problems: [],
    warnings: [],
  };
  try {
    await verify(report);
  } catch (err) {
    report.problems.push(`verificación falló: ${(err as Error).message}`);
  }
  report.ok = report.problems.length === 0;

  if (JSON_OUT) {
    console.log(JSON.stringify(report));
  } else {
    for (const w of report.warnings) console.log(`! ${w}`);
    if (!report.ok) {
      console.error(`\n=== ${report.problems.length} PROBLEMA(S) ===`);
      for (const p of report.problems.slice(0, 200)) console.error(` ✗ ${p}`);
      if (report.problems.length > 200) console.error(` … y ${report.problems.length - 200} más`);
      console.error(`\nEste backup NO está sano. No lo uses como única copia.\n`);
    } else {
      console.log(`\n=== Backup íntegro ===\n`);
    }
  }
  process.exit(report.ok ? 0 : 1);
}

main();
