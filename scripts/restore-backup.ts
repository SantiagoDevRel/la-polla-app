// scripts/restore-backup.ts — Devolver un backup a un proyecto Supabase.
//
// Es la contraparte de `export-backup.ts`: el camino de vuelta el día que
// La Polla se reabra (o el día que haya que resucitar el proyecto).
//
//   npx tsx scripts/restore-backup.ts                       # DRY RUN del backup más nuevo
//   npx tsx scripts/restore-backup.ts backups/2026-07-26-21-11
//   CONFIRM=RESTAURAR npx tsx scripts/restore-backup.ts …   # escribe de verdad
//
// 🚨 ANTES DE CORRERLO EN SERIO 🚨
// 1. Apuntá NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY al proyecto
//    DESTINO. Este script escribe donde apunte el .env — leelo dos veces.
// 2. El destino tiene que tener el ESQUEMA ya aplicado (las migraciones de
//    `schema/migrations/` del backup, en orden).
// 3. Las cuentas van PRIMERO y por SQL: pegá `auth/restore-auth.sql` en el
//    SQL editor. Todo lo demás cuelga de esos uuids.
// 4. Por default NO escribe (DRY RUN) y se niega a tocar tablas que ya
//    tengan filas. Eso es a propósito.
//
// 🚨 REGLA DEL REPO — `predictions` 🚨
// Los pronósticos son datos sagrados: nadie los modifica sin orden explícita
// del owner. Correr este script CON `CONFIRM=RESTAURAR` ES esa orden — no lo
// dispares "para probar" contra una DB con datos vivos. En dry-run no
// escribe absolutamente nada.
//
// Flags:
//   CONFIRM=RESTAURAR   escribe de verdad (sin esto es dry-run)
//   TABLES=a,b,c        restaurar solo esas tablas
//   ALLOW_NONEMPTY=1    seguir aunque el destino ya tenga filas
//   SKIP_STORAGE=1      no re-subir los archivos de storage
import "dotenv/config";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { promises as fs } from "fs";
import path from "path";

type Manifest = {
  generatedAt: string;
  projectRef: string;
  tables: Record<string, { rows: number; bytes: number; sha256: string }>;
  primaryKeys?: Record<string, string[]>;
  restoreOrder: string[];
  auth: { mode: string; users: number };
  migrations: string[];
};

const REPO_ROOT = path.resolve(__dirname, "..");
const DRY_RUN = process.env.CONFIRM !== "RESTAURAR";
const ONLY = process.env.TABLES?.split(",").map((s) => s.trim()).filter(Boolean);
const ALLOW_NONEMPTY = process.env.ALLOW_NONEMPTY === "1";
const SKIP_STORAGE = process.env.SKIP_STORAGE === "1";
const CHUNK = 500;

async function newestBackup(): Promise<string> {
  const root = process.env.BACKUP_DIR
    ? path.resolve(process.env.BACKUP_DIR)
    : path.join(REPO_ROOT, "backups");
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  if (dirs.length === 0) throw new Error(`No hay backups en ${root}.`);
  return path.join(root, dirs[dirs.length - 1]);
}

async function retry<T>(label: string, fn: () => Promise<T>, tries = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw new Error(`${label}: ${(lastErr as Error)?.message}`);
}

async function restoreStorage(sb: SupabaseClient, dir: string): Promise<number> {
  const root = path.join(dir, "storage");
  const buckets = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  let uploaded = 0;
  for (const b of buckets.filter((e) => e.isDirectory())) {
    const files: string[] = [];
    const walk = async (p: string, prefix: string): Promise<void> => {
      for (const e of await fs.readdir(p, { withFileTypes: true })) {
        const child = path.join(p, e.name);
        const key = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.isDirectory()) await walk(child, key);
        else files.push(key);
      }
    };
    await walk(path.join(root, b.name), "");
    console.log(`  storage/${b.name}: ${files.length} archivos`);
    if (DRY_RUN) continue;
    for (const key of files) {
      const body = await fs.readFile(path.join(root, b.name, key));
      await retry(`upload ${b.name}/${key}`, async () => {
        const { error } = await sb.storage.from(b.name).upload(key, body, { upsert: true });
        if (error) throw new Error(error.message);
      });
      uploaded++;
    }
  }
  return uploaded;
}

async function main() {
  const dir = process.argv[2] ? path.resolve(process.argv[2]) : await newestBackup();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");

  const manifest = JSON.parse(await fs.readFile(path.join(dir, "_manifest.json"), "utf8")) as Manifest;
  const targetRef = new URL(url).hostname.split(".")[0];

  console.log(`\n=== Restore de La Polla ===`);
  console.log(`Backup  : ${dir}`);
  console.log(`Tomado  : ${manifest.generatedAt} (proyecto ${manifest.projectRef})`);
  console.log(`DESTINO : ${targetRef}  ← acá se escribe`);
  console.log(`Modo    : ${DRY_RUN ? "DRY RUN (no escribe nada)" : "🔴 ESCRITURA REAL"}\n`);

  if (manifest.projectRef === targetRef && !DRY_RUN) {
    console.log(`! Ojo: estás restaurando SOBRE el mismo proyecto del que salió el backup.\n`);
  }
  if (manifest.auth.mode !== "skipped") {
    console.log(
      `Recordatorio: las ${manifest.auth.users} cuentas van primero, a mano:\n` +
        `  psql/SQL editor  ←  ${path.join(dir, "auth", "restore-auth.sql")}\n`,
    );
  }

  const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  const order = manifest.restoreOrder.filter((t) => (ONLY ? ONLY.includes(t) : true));
  const pks = manifest.primaryKeys ?? {};

  // Guarda: un destino con datos casi siempre significa que apuntaste al
  // proyecto equivocado. Preferimos frenar antes que mezclar dos mundos.
  // En dry-run NO frena (no escribe nada), solo avisa — así se puede
  // previsualizar un restore contra cualquier proyecto sin pelearse.
  if (!ALLOW_NONEMPTY) {
    const conflicts: string[] = [];
    for (const table of order) {
      const { count, error } = await sb.from(table).select("*", { count: "exact", head: true });
      if (error) continue; // tabla inexistente → falta aplicar migraciones; se reporta abajo
      if ((count ?? 0) > 0) conflicts.push(`${table} (${count})`);
    }
    if (conflicts.length > 0) {
      const msg = `El destino YA tiene datos en: ${conflicts.join(", ")}`;
      if (DRY_RUN) {
        console.log(`! ${msg}`);
        console.log(`  En escritura real esto abortaría. Para mezclar igual: ALLOW_NONEMPTY=1\n`);
      } else {
        console.error(msg);
        console.error(`Si de verdad querés mezclar, corré con ALLOW_NONEMPTY=1.\n`);
        process.exit(1);
      }
    }
  }

  let inserted = 0;
  const failures: string[] = [];

  for (const table of order) {
    const file = path.join(dir, "tables", `${table}.json`);
    const rows = JSON.parse(await fs.readFile(file, "utf8").catch(() => "[]")) as Record<string, unknown>[];
    if (rows.length === 0) {
      console.log(`→ ${table.padEnd(42)} vacía, nada que hacer`);
      continue;
    }
    if (DRY_RUN) {
      console.log(`→ ${table.padEnd(42)} ${String(rows.length).padStart(6)} filas (dry run)`);
      continue;
    }
    const conflictTarget = pks[table]?.join(",");
    try {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        await retry(`${table}[${i}]`, async () => {
          const q = conflictTarget
            ? sb.from(table).upsert(chunk, { onConflict: conflictTarget, ignoreDuplicates: true })
            : sb.from(table).insert(chunk);
          const { error } = await q;
          if (error) throw new Error(error.message);
        });
      }
      inserted += rows.length;
      console.log(`→ ${table.padEnd(42)} ${String(rows.length).padStart(6)} filas restauradas`);
    } catch (err) {
      failures.push(`${table}: ${(err as Error).message}`);
      console.error(`✗ ${table.padEnd(42)} ${(err as Error).message}`);
    }
  }

  if (!SKIP_STORAGE) {
    console.log(`\nStorage:`);
    const up = await restoreStorage(sb, dir);
    if (!DRY_RUN) console.log(`  ${up} archivos subidos`);
  }

  // Verificación: los counts del destino tienen que igualar al manifiesto.
  if (!DRY_RUN) {
    console.log(`\nVerificando el destino…`);
    for (const table of order) {
      const expected = manifest.tables[table]?.rows ?? 0;
      const { count, error } = await sb.from(table).select("*", { count: "exact", head: true });
      if (error) failures.push(`${table}: no pude verificar (${error.message})`);
      else if ((count ?? 0) !== expected) failures.push(`${table}: quedaron ${count} filas, esperaba ${expected}`);
    }
  }

  if (failures.length > 0) {
    console.error(`\n=== ${failures.length} PROBLEMA(S) ===`);
    for (const f of failures) console.error(` ✗ ${f}`);
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log(`\nDry run OK. Para escribir de verdad:  CONFIRM=RESTAURAR npx tsx scripts/restore-backup.ts ${path.relative(REPO_ROOT, dir)}\n`);
  } else {
    console.log(`\n=== Restore completo: ${inserted.toLocaleString("es-CO")} filas ===`);
    console.log(`Contrastá un par de tablas finales contra RESUMEN.md del backup antes de cantar victoria.\n`);
  }
}

main().catch((err) => {
  console.error(`\nRESTORE FALLÓ: ${err.message}\n`);
  process.exit(1);
});
