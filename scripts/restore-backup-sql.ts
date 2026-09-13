// scripts/restore-backup-sql.ts — Genera el SQL para restaurar un backup con psql.
//
// Por qué existe: el restore fila por fila por PostgREST (restore-backup.ts)
// choca con los triggers de la app. `trigger_lock_predictions` rechaza
// pronósticos de partidos ya jugados, `casa_v2_write_guard` (modo v2) rechaza
// filas de Casa, y `on_auth_user_created` crea `public.users` con valores por
// defecto antes de que llegue la fila real. Este script NO se conecta a
// ninguna base: lee la carpeta del backup, verifica sus sha256 y escribe un
// .sql que corre todo en UNA transacción con
// `SET LOCAL session_replication_role = replica` (triggers y FKs apagados
// solo dentro de esa transacción).
//
//   npx tsx scripts/restore-backup-sql.ts                          # backup más nuevo
//   npx tsx scripts/restore-backup-sql.ts backups/2026-09-13-12-01
//   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f backups/2026-09-13-12-01.restore.sql
//
// El destino es un Supabase LOCAL con el esquema ya aplicado (supabase db
// reset). El SQL generado:
//   · aborta si alguna tabla destino ya tiene filas (salvo ALLOW_NONEMPTY=1),
//   · convierte cada lote con jsonb_populate_recordset según los tipos reales,
//   · omite columnas generadas e inserta identity con OVERRIDING SYSTEM VALUE,
//   · aborta si el backup trae columnas que el destino no tiene
//     (salvo ALLOW_MISSING_COLUMNS=1),
//   · ajusta secuencias y compara counts: si algo no cuadra, ROLLBACK.
//
// Storage no va por SQL: `STORAGE_ONLY=1 CONFIRM=RESTAURAR npx tsx scripts/restore-backup.ts`.
//
// 🚨 Regla del repo — `predictions`: correr el .sql generado contra una base
// con datos vivos ES tocar pronósticos. Solo contra Supabase local o con orden
// explícita del dueño. El archivo lleva datos personales: nunca al repo.
//
// Flags:
//   OUT=<archivo>            destino (default: <carpeta del backup>.restore.sql)
//   OVERWRITE=1              reemplazar OUT si ya existe
//   TABLES=a,b               solo esas tablas de public
//   SKIP_AUTH=1              no incluir auth.users / auth.identities
//   ALLOW_NONEMPTY=1         no abortar si el destino ya tiene filas
//   ALLOW_MISSING_COLUMNS=1  ignorar columnas del backup que el destino no tiene
import { promises as fs } from "fs";
import path from "path";
import { buildRestoreSql, isPartialBackupDir, pickNewestBackup, RestoreSection, sha256Hex } from "./backup/core";

type Manifest = {
  formatVersion?: number;
  generatedAt: string;
  projectRef: string;
  tables: Record<string, { rows: number; sha256: string }>;
  files?: Record<string, { bytes: number; sha256: string }>;
  restoreOrder: string[];
  auth: { mode: string; users: number; identities: number };
};

const REPO_ROOT = path.resolve(__dirname, "..");
const ONLY = process.env.TABLES?.split(",").map((s) => s.trim()).filter(Boolean);

async function newestBackup(): Promise<string> {
  const root = process.env.BACKUP_DIR
    ? path.resolve(process.env.BACKUP_DIR)
    : path.join(REPO_ROOT, "backups");
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const newest = pickNewestBackup(entries.filter((e) => e.isDirectory()).map((e) => e.name));
  if (!newest) throw new Error(`No hay backups terminados en ${root}.`);
  return path.join(root, newest);
}

/** Lee un JSON del backup y confirma su sha256 antes de usarlo: no se genera
 *  un restore a partir de un archivo corrupto. */
async function readVerified(dir: string, rel: string, expectedSha: string | undefined): Promise<Record<string, unknown>[]> {
  const buf = await fs.readFile(path.join(dir, ...rel.split("/")));
  if (!expectedSha) throw new Error(`${rel}: el manifiesto no trae su sha256`);
  if (sha256Hex(buf) !== expectedSha) throw new Error(`${rel}: sha256 no coincide con el manifiesto`);
  const rows = JSON.parse(buf.toString("utf8")) as unknown;
  if (!Array.isArray(rows)) throw new Error(`${rel}: no es un arreglo de filas`);
  return rows as Record<string, unknown>[];
}

async function main() {
  const dir = process.argv[2] ? path.resolve(process.argv[2]) : await newestBackup();
  if (isPartialBackupDir(path.basename(dir))) {
    throw new Error(`${path.basename(dir)} es un export que no terminó (.partial).`);
  }
  const manifest = JSON.parse(await fs.readFile(path.join(dir, "_manifest.json"), "utf8")) as Manifest;
  const out = process.env.OUT ? path.resolve(process.env.OUT) : `${dir}.restore.sql`;
  if (process.env.OVERWRITE !== "1" && (await fs.stat(out).then(() => true).catch(() => false))) {
    throw new Error(`${out} ya existe. Usa OVERWRITE=1 para reemplazarlo.`);
  }

  console.log(`\n=== SQL de restore de La Polla ===`);
  console.log(`Backup : ${dir}`);
  console.log(`Tomado : ${manifest.generatedAt} (proyecto ${manifest.projectRef})`);

  const sections: RestoreSection[] = [];

  const includeAuth = process.env.SKIP_AUTH !== "1";
  if (includeAuth) {
    if (manifest.auth.mode !== "full") {
      throw new Error(
        `El backup no trae auth completo (modo ${manifest.auth.mode}). Corre con SKIP_AUTH=1 si igual quieres solo public.`,
      );
    }
    for (const [table, rel] of [
      ["auth.users", "auth/users.full.json"],
      ["auth.identities", "auth/identities.full.json"],
    ] as const) {
      const expected = manifest.files?.[rel]?.sha256;
      if (!expected) {
        throw new Error(`${rel}: backup de formato 1 sin sha256 de auth. Usa SKIP_AUTH=1 y auth/restore-auth.sql aparte.`);
      }
      const rows = await readVerified(dir, rel, expected);
      sections.push({ schemaTable: table, rows });
      console.log(`→ ${table.padEnd(42)} ${String(rows.length).padStart(6)} filas`);
    }
  }

  const order = [
    ...manifest.restoreOrder,
    ...Object.keys(manifest.tables).filter((t) => !manifest.restoreOrder.includes(t)).sort(),
  ].filter((t) => (ONLY ? ONLY.includes(t) : true));
  if (ONLY) {
    const unknown = ONLY.filter((t) => !manifest.tables[t]);
    if (unknown.length) throw new Error(`TABLES trae tablas que no están en el backup: ${unknown.join(", ")}`);
  }

  let totalRows = 0;
  for (const table of order) {
    const meta = manifest.tables[table];
    const rows = await readVerified(dir, `tables/${table}.json`, meta?.sha256);
    if (rows.length !== meta.rows) throw new Error(`${table}: ${rows.length} filas, el manifiesto dice ${meta.rows}`);
    sections.push({ schemaTable: `public.${table}`, rows });
    totalRows += rows.length;
    console.log(`→ public.${table.padEnd(35)} ${String(rows.length).padStart(6)} filas`);
  }

  const sql = buildRestoreSql({
    title: `Restore de La Polla — backup ${path.basename(dir)} (proyecto ${manifest.projectRef})`,
    generator: "scripts/restore-backup-sql.ts",
    sections,
    allowNonEmpty: process.env.ALLOW_NONEMPTY === "1",
    allowMissingColumns: process.env.ALLOW_MISSING_COLUMNS === "1",
  });
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, sql, "utf8");

  console.log(`\n${sections.length} tablas · ${totalRows.toLocaleString("es-CO")} filas de public${includeAuth ? " + auth" : ""}`);
  console.log(`SQL: ${out} (${(Buffer.byteLength(sql) / 1024 / 1024).toFixed(1)} MB) — lleva datos personales, no lo compartas.`);
  console.log(`\nContra un Supabase LOCAL con el esquema aplicado:`);
  console.log(`  psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f "${out}"\n`);
}

main().catch((err) => {
  console.error(`\nNO SE GENERÓ EL SQL: ${err.message}\n`);
  process.exit(1);
});
