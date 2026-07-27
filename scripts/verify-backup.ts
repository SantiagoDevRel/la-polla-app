// scripts/verify-backup.ts — ¿el backup sigue sirviendo?
//
// Un backup que nadie verificó es una promesa, no un respaldo. Este script
// abre una carpeta generada por `export-backup.ts` y confirma que sigue
// entera: cada archivo existe, su sha256 coincide con el manifiesto y trae
// exactamente las filas que decía traer. Corre 100% OFFLINE — sirve dentro
// de dos años en el DGX, sin internet y sin que el proyecto Supabase exista.
//
//   npx tsx scripts/verify-backup.ts                      # el backup más nuevo
//   npx tsx scripts/verify-backup.ts backups/2026-07-26-21-11
//   ONLINE=1 npx tsx scripts/verify-backup.ts             # + compara contra la DB viva
//
// Sale con código 1 si algo no cuadra, así que se puede encadenar
// (ej: verificar antes de copiar al DGX).
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";

type Manifest = {
  generatedAt: string;
  projectRef: string;
  totals: { tables: number; rows: number; storageFiles: number; storageBytes: number };
  auth: { mode: string; users: number; identities: number };
  tables: Record<string, { rows: number; bytes: number; sha256: string }>;
  migrations: string[];
};

const REPO_ROOT = path.resolve(__dirname, "..");

async function newestBackup(): Promise<string> {
  const root = process.env.BACKUP_DIR
    ? path.resolve(process.env.BACKUP_DIR)
    : path.join(REPO_ROOT, "backups");
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  if (dirs.length === 0) throw new Error(`No hay backups en ${root}. Corré scripts/export-backup.ts primero.`);
  return path.join(root, dirs[dirs.length - 1]);
}

async function main() {
  const dir = process.argv[2] ? path.resolve(process.argv[2]) : await newestBackup();
  console.log(`\n=== Verificando backup ===\n${dir}\n`);

  const manifest = JSON.parse(
    await fs.readFile(path.join(dir, "_manifest.json"), "utf8"),
  ) as Manifest;
  console.log(`Tomado el ${manifest.generatedAt} · proyecto ${manifest.projectRef}\n`);

  const problems: string[] = [];
  let checkedRows = 0;

  // 1) Integridad de cada tabla: sha256 + filas.
  for (const [table, meta] of Object.entries(manifest.tables)) {
    const file = path.join(dir, "tables", `${table}.json`);
    let raw: string;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch {
      problems.push(`${table}: FALTA el archivo tables/${table}.json`);
      continue;
    }
    const hash = createHash("sha256").update(raw).digest("hex");
    if (hash !== meta.sha256) {
      problems.push(`${table}: sha256 no coincide (archivo corrupto o editado a mano)`);
      continue;
    }
    let rows: unknown[];
    try {
      rows = JSON.parse(raw);
    } catch (err) {
      problems.push(`${table}: JSON ilegible — ${(err as Error).message}`);
      continue;
    }
    if (!Array.isArray(rows) || rows.length !== meta.rows) {
      problems.push(`${table}: ${Array.isArray(rows) ? rows.length : "?"} filas, el manifiesto dice ${meta.rows}`);
      continue;
    }
    checkedRows += rows.length;
  }

  // 2) Auth.
  if (manifest.auth.mode === "full") {
    for (const f of ["users.full.json", "identities.full.json", "restore-auth.sql"]) {
      const p = path.join(dir, "auth", f);
      if (!(await fs.stat(p).then(() => true).catch(() => false))) problems.push(`auth: falta ${f}`);
    }
    const users = JSON.parse(await fs.readFile(path.join(dir, "auth", "users.full.json"), "utf8").catch(() => "[]"));
    if (Array.isArray(users) && users.length !== manifest.auth.users) {
      problems.push(`auth: ${users.length} usuarios en disco, el manifiesto dice ${manifest.auth.users}`);
    }
  } else if (manifest.auth.mode === "skipped") {
    console.log("! Este backup NO tiene auth (se corrió con SKIP_PII=1): no alcanza para reabrir con las mismas cuentas.\n");
  }

  // 3) Storage + migraciones.
  let storageFiles = 0;
  async function walk(p: string) {
    for (const e of await fs.readdir(p, { withFileTypes: true }).catch(() => [])) {
      if (e.isDirectory()) await walk(path.join(p, e.name));
      else storageFiles++;
    }
  }
  await walk(path.join(dir, "storage"));
  if (storageFiles !== manifest.totals.storageFiles) {
    problems.push(`storage: ${storageFiles} archivos en disco, el manifiesto dice ${manifest.totals.storageFiles}`);
  }
  const migs = (await fs.readdir(path.join(dir, "schema", "migrations")).catch(() => [])).filter((f) => f.endsWith(".sql"));
  if (migs.length !== manifest.migrations.length) {
    problems.push(`schema: ${migs.length} migraciones en disco, el manifiesto dice ${manifest.migrations.length}`);
  }

  console.log(`Tablas    : ${Object.keys(manifest.tables).length} · ${checkedRows.toLocaleString("es-CO")} filas verificadas`);
  console.log(`Auth      : ${manifest.auth.users} cuentas (${manifest.auth.mode})`);
  console.log(`Storage   : ${storageFiles} archivos`);
  console.log(`Migraciones: ${migs.length}`);

  // 4) Opcional: comparar contra la DB viva. Detecta un backup viejo
  //    respecto de la realidad (o que ya no exista el proyecto).
  if (process.env.ONLINE === "1") {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      problems.push("ONLINE=1 pero faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    } else {
      console.log(`\nComparando contra la DB viva…`);
      const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      for (const [table, meta] of Object.entries(manifest.tables)) {
        const { count, error } = await sb.from(table).select("*", { count: "exact", head: true });
        if (error) {
          problems.push(`${table}: no pude contar en la DB (${error.message})`);
        } else if ((count ?? 0) !== meta.rows) {
          console.log(`  ~ ${table}: DB tiene ${count}, el backup ${meta.rows} (la DB cambió desde el backup)`);
        }
      }
    }
  }

  if (problems.length > 0) {
    console.error(`\n=== ${problems.length} PROBLEMA(S) ===`);
    for (const p of problems) console.error(` ✗ ${p}`);
    console.error(`\nEste backup NO está sano. No lo uses como única copia.\n`);
    process.exit(1);
  }
  console.log(`\n=== Backup íntegro ===\n`);
}

main().catch((err) => {
  console.error(`\nVERIFICACIÓN FALLÓ: ${err.message}\n`);
  process.exit(1);
});
