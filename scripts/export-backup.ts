// scripts/export-backup.ts — Backup COMPLETO y offline de La Polla.
//
// Nació del cierre de temporada post-Mundial 2026 (2026-07-26): si algún
// día se reabre la app, o si Supabase pausa/pierde el proyecto,
// esto es lo único que garantiza que los puntos, los pronósticos y la
// gente sigan existiendo. Es SOLO-LECTURA: no escribe ni una fila en la DB.
//
//   npx tsx scripts/export-backup.ts
//
// Env (de .env, igual que el resto de scripts/):
//   NEXT_PUBLIC_SUPABASE_URL     · requerido
//   SUPABASE_SERVICE_ROLE_KEY    · requerido (lee todo, bypass RLS)
//   Token de la Management API   · opcional pero muy recomendado. Se usa el
//                                  primero que exista, en este orden:
//                                    SUPABASE_BACKUP_PAT   (token propio del backup)
//                                    SUPABASE_ACCESS_TOKEN (token del proyecto)
//                                    SUPABASE_30_DAYS      (PAT histórico)
//                                  Basta el permiso database_read: todas las
//                                  consultas SQL van por el endpoint
//                                  /database/query/read-only (rol
//                                  supabase_read_only_user). Con token el
//                                  backup trae: auth completo + SQL de restore
//                                  de cuentas, cruce de Storage contra
//                                  storage.objects, esquema vivo de prod
//                                  (schema/live) y orden de restore del grafo
//                                  real de FKs.
// Flags:
//   BACKUP_DIR=<path>  destino (default: ./backups)
//   SKIP_STORAGE=1     no baja los archivos de Storage
//   SKIP_PII=1         no exporta auth (teléfonos/emails). Ojo: sin auth
//                      no se puede reabrir con las MISMAS cuentas.
//   ALLOW_REDUCED_BACKUP=1  con token, si el dump completo de auth falla,
//                      cae a la admin API en vez de abortar. Ese backup no
//                      recrea cuentas y verify-backup lo rechaza salvo el
//                      mismo flag.
//
// ─── Notas de diseño ───
// · `select("*")`: la regla del repo prohíbe el `*` en código de APP (para
//   no filtrar una columna sensible futura). Un backup necesita TODAS las
//   columnas por definición — es la excepción explícita, no un descuido.
// · PostgREST topa en 1000 filas por request incluso con service_role
//   (verificado 2026-07-26 contra prod). Todo se pagina y después se
//   VERIFICA contra el count exacto: si no cuadra, el script falla. Un
//   backup silenciosamente truncado es peor que no tener backup.
// · Storage también pagina (offset de a 1000, recursivo) y se cruza contra
//   storage.objects por bucket: conteo y nombres. Si no cuadra, aborta.
// · Se escribe en `<stamp>.partial/` y se renombra a `<stamp>/` SOLO al final.
//   Una carpeta sin `.partial` es un backup que terminó; verify-backup ignora
//   las `.partial`.
// · El manifiesto guarda sha256 + bytes de cada archivo de auth, Storage y
//   esquema, además de filas + sha256 por tabla.
// · Las tablas se auto-descubren del OpenAPI de PostgREST, así que una
//   tabla nueva entra al backup sola, sin tocar este archivo.
// · Todo salida va a `backups/` (gitignored). El repo es PÚBLICO: este
//   dump lleva teléfonos, NUNCA se commitea. Los logs no imprimen tokens,
//   teléfonos ni rutas de objetos.
import "dotenv/config";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { promises as fs } from "fs";
import path from "path";
import {
  backupStamp,
  buildRestoreSql,
  compareStorageCounts,
  compareStorageNames,
  fileEntry,
  FileManifest,
  listAllStorageObjects,
  partialDirName,
  PolicyRow,
  projectRefFromUrl,
  renderPolicySql,
  resolveManagementToken,
} from "./backup/core";

// ─── Config ───

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MGMT = resolveManagementToken(process.env);
const SKIP_STORAGE = process.env.SKIP_STORAGE === "1";
const SKIP_PII = process.env.SKIP_PII === "1";
const ALLOW_REDUCED = process.env.ALLOW_REDUCED_BACKUP === "1";
const PAGE = 1000; // cap duro de PostgREST y de storage.list

const REPO_ROOT = path.resolve(__dirname, "..");
const BACKUP_ROOT = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : path.join(REPO_ROOT, "backups");

/** Orden de restore por defecto, derivado del grafo de FKs de prod al
 *  2026-07-26. Solo se usa si NO hay token para recalcularlo en vivo.
 *  Las tablas que no figuren acá se agregan al final (no tenían FKs). */
const FALLBACK_RESTORE_ORDER = [
  "users",
  "matches",
  "pollas",
  "polla_participants",
  "predictions",
  "notifications",
  "polla_payouts",
  "polla_invites",
  "payment_proofs",
  "claude_api_usage",
  "match_result_notifications",
  "scoring_survey_votes",
  "double_survey_votes",
  "bracket_proposals",
  "bracket_predictions",
  "polla_drafts",
  "feedback",
  "whatsapp_messages",
  "wa_template_sends",
];

// ─── Utilidades ───

function log(msg: string) {
  console.log(msg);
}

/** Error que no vale la pena reintentar (401/403/400: no se arregla solo). */
class PermanentError extends Error {}

/** Reintento con backoff. La red hacia Supabase falla de a ratos
 *  (UND_ERR_CONNECT_TIMEOUT visto durante el desarrollo de este script);
 *  un backup no puede morirse por un timeout suelto. */
async function retry<T>(label: string, fn: () => Promise<T>, tries = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (err instanceof PermanentError) break;
      const wait = 1500 * (i + 1);
      if (i < tries - 1) {
        log(`   … ${label} falló (${(err as Error).message}). Reintento en ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw new Error(`${label}: ${(lastErr as Error)?.message}`);
}

/** Query SQL de solo lectura por la Management API (rol
 *  supabase_read_only_user). No tiene el cap de 1000 filas de PostgREST.
 *  Toda referencia debe ir calificada con esquema. */
async function mgmtQuery<T = Record<string, unknown>>(label: string, sql: string): Promise<T[]> {
  if (!MGMT) throw new Error("sin token de la Management API");
  const ref = projectRefFromUrl(SUPABASE_URL!);
  return retry(`sql ${label}`, async () => {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query/read-only`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MGMT.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    });
    const text = await res.text();
    if (!res.ok) {
      const msg = `${res.status} ${text.slice(0, 300)}`;
      if (res.status >= 400 && res.status < 500 && res.status !== 429) throw new PermanentError(msg);
      throw new Error(msg);
    }
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) throw new Error(`respuesta inesperada (no es un arreglo de filas)`);
    return parsed as T[];
  });
}

/** Escribe un archivo dentro del backup y lo registra en el manifiesto. */
async function writeTracked(
  root: string,
  files: FileManifest,
  relPath: string,
  data: Buffer | string,
): Promise<{ bytes: number; sha256: string }> {
  const dest = path.join(root, ...relPath.split("/"));
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, data);
  const entry = fileEntry(data);
  files[relPath] = entry;
  return entry;
}

function jsonBody(data: unknown): string {
  // indent 1: legible con un editor/grep dentro de 5 años sin inflar el
  // archivo como indent 2 en tablas de 15k filas.
  return JSON.stringify(data, null, 1);
}

// ─── Descubrimiento de tablas (OpenAPI de PostgREST) ───

type TableMeta = { name: string; columns: string[] };

async function discoverTables(): Promise<TableMeta[]> {
  const spec = await retry("OpenAPI", async () => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      headers: {
        apikey: SERVICE_KEY!,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Accept: "application/openapi+json",
      },
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as {
      definitions?: Record<string, { properties?: Record<string, unknown> }>;
    };
  });
  const defs = spec.definitions ?? {};
  return Object.keys(defs)
    .sort()
    .map((name) => ({
      name,
      columns: Object.keys(defs[name]?.properties ?? {}),
    }));
}

// ─── Dump de una tabla ───

async function exactCount(sb: SupabaseClient, table: string): Promise<number> {
  return retry(`count(${table})`, async () => {
    const { count, error } = await sb.from(table).select("*", { count: "exact", head: true });
    if (error) throw new Error(error.message);
    return count ?? 0;
  });
}

async function dumpTable(
  sb: SupabaseClient,
  meta: TableMeta,
): Promise<{ rows: Record<string, unknown>[]; count: number; orderedBy: string }> {
  const total = await exactCount(sb, meta.name);

  // Columna de orden: PostgREST pagina con `range`, y sin un ORDER BY
  // estable las páginas pueden repetir o saltear filas. `id` es único en
  // toda tabla grande de este schema (verificado 2026-07-26). Si no hay
  // `id`, ordenamos por TODAS las columnas: da un orden total salvo filas
  // idénticas, y entre filas idénticas el orden es irrelevante.
  const orderCols = meta.columns.includes("id") ? ["id"] : meta.columns;
  const orderedBy = orderCols.join(",");

  const rows: Record<string, unknown>[] = [];
  for (let from = 0; from < Math.max(total, 1); from += PAGE) {
    const page = await retry(`${meta.name} [${from}]`, async () => {
      let q = sb.from(meta.name).select("*");
      for (const c of orderCols) q = q.order(c, { ascending: true, nullsFirst: true });
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      return (data ?? []) as Record<string, unknown>[];
    });
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  // Verificación dura: un backup truncado en silencio es una trampa.
  if (rows.length !== total) {
    throw new Error(
      `${meta.name}: bajé ${rows.length} filas pero la tabla tiene ${total}. ` +
        `Backup ABORTADO — no quiero dejar un dump incompleto que parezca bueno.`,
    );
  }
  if (meta.columns.includes("id")) {
    const unique = new Set(rows.map((r) => String(r.id))).size;
    if (unique !== rows.length) {
      throw new Error(
        `${meta.name}: ${rows.length} filas pero solo ${unique} ids únicos ` +
          `(paginación duplicó filas). Backup ABORTADO.`,
      );
    }
  }

  return { rows, count: total, orderedBy };
}

// ─── auth ───

type AuthDump = {
  mode: "full" | "admin-api" | "skipped";
  users: number;
  identities: number;
  /** Por qué no salió completo, si aplica (sin datos personales). */
  note?: string;
};

async function dumpAuth(sb: SupabaseClient, dir: string, files: FileManifest): Promise<AuthDump> {
  if (SKIP_PII) {
    log("→ auth: SALTEADO (SKIP_PII=1). Sin esto NO se puede reabrir con las mismas cuentas.");
    return { mode: "skipped", users: 0, identities: 0 };
  }

  // Camino de máxima fidelidad: todas las columnas de auth.users +
  // auth.identities por SQL. Es lo único que permite recrear las cuentas
  // con su MISMO uuid (la admin API no deja elegir el id al crear).
  let note: string | undefined;
  if (MGMT) {
    try {
      const users = await mgmtQuery<Record<string, unknown>>(
        "auth.users",
        "select * from auth.users order by created_at asc, id asc;",
      );
      const identities = await mgmtQuery<Record<string, unknown>>(
        "auth.identities",
        "select * from auth.identities order by created_at asc, id asc;",
      );
      await writeTracked(dir, files, "auth/users.full.json", jsonBody(users));
      await writeTracked(dir, files, "auth/identities.full.json", jsonBody(identities));

      // SQL de restore de cuentas: una transacción con triggers apagados
      // (on_auth_user_created insertaría public.users con valores por
      // defecto y el restore de public.users después no los pisaría), las
      // columnas generadas (confirmed_at, identities.email) se recalculan.
      const sql = buildRestoreSql({
        title: "Restore de cuentas de La Polla (auth.users + auth.identities)",
        generator: "scripts/export-backup.ts",
        sections: [
          { schemaTable: "auth.users", rows: users },
          { schemaTable: "auth.identities", rows: identities },
        ],
      });
      await writeTracked(dir, files, "auth/restore-auth.sql", sql);

      log(`→ auth: dump COMPLETO — ${users.length} usuarios, ${identities.length} identities (+ SQL de restore)`);
      return { mode: "full", users: users.length, identities: identities.length };
    } catch (err) {
      // Con token presente, caer a la admin API deja un backup que no puede
      // recrear las cuentas: igual que el cruce de Storage, se aborta salvo
      // que se acepte explícitamente un backup reducido.
      if (!ALLOW_REDUCED) {
        throw new Error(
          `el dump completo de auth falló (${(err as Error).message.slice(0, 300)}). Backup ABORTADO: ` +
            `sin él no se pueden recrear las cuentas. Revisa que ${MGMT.source} siga vigente y tenga database_read; ` +
            `para aceptar un backup reducido, ALLOW_REDUCED_BACKUP=1.`,
        );
      }
      note = `dump completo falló: ${(err as Error).message.slice(0, 200)}`;
      log(`   ! dump completo de auth falló (${(err as Error).message}); caigo a la admin API (ALLOW_REDUCED_BACKUP=1)`);
    }
  } else {
    note = "sin token de la Management API";
  }

  // Fallback: admin API. Trae lo esencial (id, phone, email, fechas) pero
  // no permite recrear la cuenta con el mismo uuid sin SQL manual.
  const all: unknown[] = [];
  for (let page = 1; ; page++) {
    const data = await retry(`listUsers(${page})`, async () => {
      const r = await sb.auth.admin.listUsers({ page, perPage: PAGE });
      if (r.error) throw new Error(r.error.message);
      return r.data;
    });
    all.push(...data.users);
    if (data.users.length < PAGE) break;
  }
  await writeTracked(dir, files, "auth/users.json", jsonBody(all));
  log(`→ auth: ${all.length} usuarios (admin API — sin SQL de restore)`);
  return { mode: "admin-api", users: all.length, identities: 0, note };
}

// ─── Storage ───

type BucketStats = { name: string; objects: number; bytes: number };
type StorageStats = {
  buckets: BucketStats[];
  files: number;
  bytes: number;
  crossCheck: "storage.objects" | "sin token" | "salteado";
};

async function listBucket(sb: SupabaseClient, bucket: string): Promise<string[]> {
  return listAllStorageObjects(async (prefix, { limit, offset }) =>
    retry(`storage ls ${bucket} (offset ${offset})`, async () => {
      const { data, error } = await sb.storage
        .from(bucket)
        .list(prefix, { limit, offset, sortBy: { column: "name", order: "asc" } });
      if (error) throw new Error(error.message);
      return data ?? [];
    }),
  "",
  PAGE);
}

/** Lista todos los buckets y, con token, los cruza contra storage.objects.
 *  Dos intentos: si alguien sube un comprobante entre el listado y el
 *  conteo, la segunda vuelta lo absorbe. Si sigue sin cuadrar, aborta. */
async function listAndCrossCheck(
  sb: SupabaseClient,
  bucketNames: string[],
): Promise<{ keys: Record<string, string[]>; crossCheck: StorageStats["crossCheck"] }> {
  for (let attempt = 1; ; attempt++) {
    const keys: Record<string, string[]> = {};
    for (const b of bucketNames) keys[b] = await listBucket(sb, b);
    if (!MGMT) {
      log("   ! sin token: no puedo cruzar el listado de Storage con storage.objects");
      return { keys, crossCheck: "sin token" };
    }
    const rows = await mgmtQuery<{ bucket_id: string; name: string }>(
      "storage.objects",
      "select o.bucket_id, o.name from storage.objects o order by o.bucket_id, o.name;",
    ).catch((err: Error) => {
      // Con token presente, no poder cruzar es un error de configuración:
      // mejor fallar fuerte que dejar un backup sin la verificación prometida.
      throw new Error(
        `no pude leer storage.objects para cruzar el listado (${err.message}). ` +
          `Revisa que ${MGMT.source} tenga database_read; para un backup sin cruce, córrelo sin token.`,
      );
    });
    const dbNames: Record<string, string[]> = {};
    for (const r of rows) (dbNames[r.bucket_id] ??= []).push(r.name);
    const listedCounts: Record<string, number> = {};
    const dbCounts: Record<string, number> = {};
    for (const [b, k] of Object.entries(keys)) listedCounts[b] = k.length;
    for (const [b, k] of Object.entries(dbNames)) dbCounts[b] = k.length;
    const problems = [...compareStorageCounts(listedCounts, dbCounts), ...compareStorageNames(keys, dbNames)];
    if (problems.length === 0) return { keys, crossCheck: "storage.objects" };
    if (attempt >= 2) {
      throw new Error(
        `Storage no cuadra con storage.objects. Backup ABORTADO:\n  - ${problems.join("\n  - ")}`,
      );
    }
    log(`   ! Storage no cuadró con storage.objects (${problems.length} diferencia(s)); reintento el listado`);
    await new Promise((r) => setTimeout(r, 3000));
  }
}

async function dumpStorage(sb: SupabaseClient, dir: string, files: FileManifest): Promise<StorageStats> {
  if (SKIP_STORAGE) {
    log("→ storage: SALTEADO (SKIP_STORAGE=1)");
    return { buckets: [], files: 0, bytes: 0, crossCheck: "salteado" };
  }
  const buckets = await retry("listBuckets", async () => {
    const { data, error } = await sb.storage.listBuckets();
    if (error) throw new Error(error.message);
    return data ?? [];
  });
  const names = buckets.map((b) => b.name).sort();
  const { keys, crossCheck } = await listAndCrossCheck(sb, names);

  const stats: BucketStats[] = [];
  let total = 0;
  let totalBytes = 0;
  for (const b of names) {
    let bytes = 0;
    for (const key of keys[b]) {
      const blob = await retry(`download ${b}/(objeto ${stats.length + 1})`, async () => {
        const { data, error } = await sb.storage.from(b).download(key);
        if (error) throw new Error(error.message);
        return data;
      });
      const buf = Buffer.from(await blob.arrayBuffer());
      await writeTracked(dir, files, `storage/${b}/${key}`, buf);
      bytes += buf.byteLength;
    }
    stats.push({ name: b, objects: keys[b].length, bytes });
    total += keys[b].length;
    totalBytes += bytes;
    log(`→ storage/${b}: ${keys[b].length} archivos (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
  }
  return { buckets: stats, files: total, bytes: totalBytes, crossCheck };
}

// ─── Esquema vivo (definiciones reales de prod) ───

type SchemaLive = {
  mode: "read-only" | "skipped";
  counts: Record<string, number>;
  errors: string[];
  warnings: string[];
};

const LIVE_QUERIES: { name: string; sql: string }[] = [
  {
    name: "functions",
    sql: `
      select n.nspname as schema, p.proname as name,
             pg_catalog.pg_get_function_identity_arguments(p.oid) as args,
             pg_catalog.pg_get_functiondef(p.oid) as definition
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind in ('f', 'p')
        and not exists (
          select 1 from pg_catalog.pg_depend d
          where d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass and d.objid = p.oid and d.deptype = 'e'
        )
      order by 1, 2, 3;`,
  },
  {
    name: "triggers",
    sql: `
      select n.nspname as schema, c.relname as table, t.tgname as name,
             t.tgenabled as enabled, pg_catalog.pg_get_triggerdef(t.oid) as definition
      from pg_catalog.pg_trigger t
      join pg_catalog.pg_class c on c.oid = t.tgrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where not t.tgisinternal and n.nspname in ('public', 'auth', 'storage')
      order by 1, 2, 3;`,
  },
  {
    name: "policies",
    sql: `
      select p.schemaname, p.tablename, p.policyname, p.permissive, p.roles, p.cmd, p.qual, p.with_check
      from pg_catalog.pg_policies p
      where p.schemaname in ('public', 'storage')
      order by 1, 2, 3;`,
  },
  {
    name: "rls",
    sql: `
      select n.nspname as schema, c.relname as table, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
      order by 1, 2;`,
  },
  {
    name: "columns",
    sql: `
      select c.table_schema, c.table_name, c.column_name, c.ordinal_position, c.data_type, c.udt_name,
             c.is_nullable, c.column_default, c.is_identity, c.is_generated, c.generation_expression
      from information_schema.columns c
      where c.table_schema in ('public', 'auth', 'storage')
      order by 1, 2, 4;`,
  },
  {
    name: "cron_jobs",
    sql: `select j.jobid, j.jobname, j.schedule, j.command, j.database, j.username, j.active from cron.job j order by j.jobid;`,
  },
  {
    name: "storage_buckets",
    sql: `select * from storage.buckets b order by b.id;`,
  },
  {
    name: "schema_migrations",
    sql: `select * from supabase_migrations.schema_migrations m order by m.version;`,
  },
  {
    name: "extensions",
    sql: `
      select e.extname as name, e.extversion as version, n.nspname as schema
      from pg_catalog.pg_extension e join pg_catalog.pg_namespace n on n.oid = e.extnamespace
      order by 1;`,
  },
];

async function dumpSchemaLive(dir: string, files: FileManifest): Promise<SchemaLive> {
  if (!MGMT) {
    log("→ schema/live: SALTEADO (sin token de la Management API)");
    return { mode: "skipped", counts: {}, errors: [], warnings: ["sin token de la Management API"] };
  }
  const counts: Record<string, number> = {};
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const q of LIVE_QUERIES) {
    try {
      const rows = await mgmtQuery<Record<string, unknown>>(`schema/${q.name}`, q.sql);
      counts[q.name] = rows.length;
      await writeTracked(dir, files, `schema/live/${q.name}.json`, jsonBody(rows));
      if (q.name === "functions") {
        const sql = rows
          .map((r) => `-- ${r.schema}.${r.name}(${r.args})\n${String(r.definition).trimEnd()};\n`)
          .join("\n");
        await writeTracked(dir, files, "schema/live/functions.sql", sql);
      }
      if (q.name === "triggers") {
        const sql = rows
          .map((r) => `${String(r.definition)};${r.enabled === "D" ? " -- DESACTIVADO" : ""}`)
          .join("\n");
        await writeTracked(dir, files, "schema/live/triggers.sql", `${sql}\n`);
      }
      if (q.name === "policies") {
        const sql = (rows as unknown as PolicyRow[]).map(renderPolicySql).join("\n");
        await writeTracked(dir, files, "schema/live/policies.sql", `${sql}\n`);
      }
      if (q.name === "cron_jobs" && rows.length === 0) {
        warnings.push("cron.job devolvió 0 filas: puede ser la RLS de pg_cron para supabase_read_only_user");
      }
    } catch (err) {
      errors.push(`${q.name}: ${(err as Error).message.slice(0, 300)}`);
    }
  }
  const summary = Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(" · ");
  log(`→ schema/live: ${summary}`);
  for (const e of errors) log(`   ! schema/live ${e}`);
  for (const w of warnings) log(`   ! schema/live ${w}`);
  return { mode: "read-only", counts, errors, warnings };
}

// ─── Primary keys (target de conflicto para el restore idempotente) ───

async function discoverPrimaryKeys(tables: string[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  if (MGMT) {
    try {
      const rows = await mgmtQuery<{ tabla: string; pk: string | null }>(
        "primary keys",
        `
        select c.relname as tabla,
               string_agg(a.attname, ',' order by k.ord) as pk
        from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
        join pg_catalog.pg_constraint con on con.conrelid = c.oid and con.contype = 'p'
        join lateral unnest(con.conkey) with ordinality as k(attnum, ord) on true
        join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
        where c.relkind = 'r'
        group by c.relname;
      `,
      );
      for (const r of rows) if (r.pk) out[r.tabla] = r.pk.split(",");
      return out;
    } catch (err) {
      log(`   ! no pude leer las PKs (${(err as Error).message}); asumo "id" donde exista`);
    }
  }
  // Sin token: asumimos "id" para las tablas que lo tengan. Las de PK
  // compuesta quedan sin entrada y el restore usa INSERT plano.
  for (const t of tables) out[t] = ["id"];
  return out;
}

// ─── Orden de restore desde el grafo real de FKs ───

async function computeRestoreOrder(tables: string[]): Promise<{ order: string[]; source: string }> {
  if (MGMT) {
    try {
      const edges = await mgmtQuery<{ tabla: string; depende_de: string }>(
        "foreign keys",
        `
        select src.relname as tabla, tgt.relname as depende_de
        from pg_catalog.pg_constraint con
        join pg_catalog.pg_class src on src.oid = con.conrelid
        join pg_catalog.pg_namespace sn on sn.oid = src.relnamespace and sn.nspname = 'public'
        join pg_catalog.pg_class tgt on tgt.oid = con.confrelid
        join pg_catalog.pg_namespace tn on tn.oid = tgt.relnamespace and tn.nspname = 'public'
        where con.contype = 'f' and src.relname <> tgt.relname;
      `,
      );
      const deps = new Map<string, Set<string>>();
      for (const t of tables) deps.set(t, new Set());
      for (const e of edges) {
        if (deps.has(e.tabla) && tables.includes(e.depende_de)) deps.get(e.tabla)!.add(e.depende_de);
      }
      // Topological sort (Kahn). Ciclos → se anexan al final.
      const order: string[] = [];
      const pending = new Set(tables);
      while (pending.size) {
        const ready = Array.from(pending)
          .filter((t) => Array.from(deps.get(t)!).every((d) => order.includes(d)))
          .sort();
        if (ready.length === 0) {
          order.push(...Array.from(pending).sort());
          break;
        }
        for (const t of ready) {
          order.push(t);
          pending.delete(t);
        }
      }
      return { order, source: "grafo de FKs en vivo" };
    } catch (err) {
      log(`   ! no pude derivar el orden de FKs (${(err as Error).message}); uso el de respaldo`);
    }
  }
  const order = [...FALLBACK_RESTORE_ORDER.filter((t) => tables.includes(t))];
  order.push(...tables.filter((t) => !order.includes(t)).sort());
  return { order, source: "orden de respaldo (snapshot 2026-07-26)" };
}

// ─── RESUMEN.md — los números, legibles sin DB ───

function buildResumen(
  data: Record<string, Record<string, unknown>[]>,
  stamp: string,
): string {
  const users = new Map<string, Record<string, unknown>>();
  for (const u of data.users ?? []) users.set(String(u.id), u);

  const participantsByPolla = new Map<string, Record<string, unknown>[]>();
  for (const p of data.polla_participants ?? []) {
    const k = String(p.polla_id);
    if (!participantsByPolla.has(k)) participantsByPolla.set(k, []);
    participantsByPolla.get(k)!.push(p);
  }

  const predsByPolla = new Map<string, number>();
  for (const p of data.predictions ?? []) {
    const k = String(p.polla_id);
    predsByPolla.set(k, (predsByPolla.get(k) ?? 0) + 1);
  }

  const pollas = [...(data.pollas ?? [])].sort(
    (a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")),
  );

  const lines: string[] = [];
  lines.push(`# La Polla — resumen del backup`);
  lines.push("");
  lines.push(`Generado el ${stamp}.`);
  lines.push("");
  lines.push(
    `Este archivo existe para que los números sobrevivan aunque no haya ` +
      `base de datos, ni app, ni internet: se lee de corrido. El detalle ` +
      `fila por fila está en \`tables/*.json\`.`,
  );
  lines.push("");
  lines.push(`## Totales`);
  lines.push("");
  lines.push(`| Qué | Cuánto |`);
  lines.push(`| --- | ---: |`);
  lines.push(`| Personas registradas | ${(data.users ?? []).length} |`);
  lines.push(`| Pollas | ${pollas.length} |`);
  lines.push(`| Inscripciones (participantes) | ${(data.polla_participants ?? []).length} |`);
  lines.push(`| Pronósticos | ${(data.predictions ?? []).length} |`);
  lines.push(`| Partidos | ${(data.matches ?? []).length} |`);
  lines.push("");

  lines.push(`## Pollas, una por una`);
  lines.push("");
  for (const polla of pollas) {
    const id = String(polla.id);
    const parts = (participantsByPolla.get(id) ?? []).slice().sort((a, b) => {
      const pa = Number(a.total_points ?? 0);
      const pb = Number(b.total_points ?? 0);
      if (pb !== pa) return pb - pa;
      return String(a.joined_at ?? "").localeCompare(String(b.joined_at ?? ""));
    });
    const created = String(polla.created_at ?? "").slice(0, 10);
    lines.push(`### ${polla.name ?? "(sin nombre)"}`);
    lines.push("");
    lines.push(
      `\`${polla.slug ?? "-"}\` · ${polla.tournament ?? "-"} · estado: ${polla.status ?? "-"} · ` +
        `creada ${created} · ${parts.length} participantes · ${predsByPolla.get(id) ?? 0} pronósticos`,
    );
    const buyIn = Number(polla.buy_in_amount ?? 0);
    if (buyIn > 0) lines.push(`Entrada: ${buyIn} ${polla.currency ?? ""} · pago: ${polla.payment_mode ?? "-"}`);
    lines.push("");
    if (parts.length === 0) {
      lines.push(`_Sin participantes._`);
    } else {
      lines.push(`| # | Jugador | Puntos | Pagó |`);
      lines.push(`| ---: | --- | ---: | :---: |`);
      parts.forEach((p, i) => {
        const u = users.get(String(p.user_id));
        const name = (u?.display_name as string) || `(usuario ${String(p.user_id).slice(0, 8)})`;
        lines.push(`| ${i + 1} | ${name} | ${Number(p.total_points ?? 0)} | ${p.paid ? "sí" : "no"} |`);
      });
    }
    lines.push("");
  }
  return lines.join("\n");
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  // En Windows un antivirus o el indexador pueden tener un archivo abierto
  // unos segundos justo después de escribirlo.
  for (let i = 0; ; i++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      if (i >= 5) throw err;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

async function exists(p: string): Promise<boolean> {
  return fs.stat(p).then(() => true).catch(() => false);
}

// ─── Main ───

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el entorno (.env).",
    );
  }
  const startedAt = new Date();
  const stamp = backupStamp(startedAt); // 2026-07-26-15-30
  const finalDir = path.join(BACKUP_ROOT, stamp);
  const dir = path.join(BACKUP_ROOT, partialDirName(stamp));
  if ((await exists(finalDir)) || (await exists(dir))) {
    throw new Error(`Ya existe ${finalDir} (o su .partial). Esperá un minuto y corré de nuevo.`);
  }
  await fs.mkdir(dir, { recursive: true });

  const projectRef = projectRefFromUrl(SUPABASE_URL);
  log(`\n=== Backup de La Polla ===`);
  log(`Proyecto : ${projectRef}`);
  log(`Destino  : ${finalDir}  (se escribe en .partial hasta terminar)`);
  log(`Token    : ${MGMT ? `${MGMT.source} (SQL de solo lectura)` : "ninguno — auth reducido, sin schema/live ni cruce de Storage"}`);
  log(`Auth     : ${SKIP_PII ? "NO (SKIP_PII=1)" : MGMT ? "completo" : "admin API"}`);
  log(`Storage  : ${SKIP_STORAGE ? "NO (SKIP_STORAGE=1)" : "sí"}\n`);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const files: FileManifest = {};

  // 1) Tablas
  const tables = await discoverTables();
  log(`Descubiertas ${tables.length} tablas en public.\n`);

  const tableFiles: Record<string, { rows: number; bytes: number; sha256: string; orderedBy: string }> = {};
  const loaded: Record<string, Record<string, unknown>[]> = {};
  for (const meta of tables) {
    const { rows, count, orderedBy } = await dumpTable(sb, meta);
    const body = jsonBody(rows);
    const dest = path.join(dir, "tables", `${meta.name}.json`);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, body, "utf8");
    const { bytes, sha256 } = fileEntry(body);
    tableFiles[meta.name] = { rows: count, bytes, sha256, orderedBy };
    loaded[meta.name] = rows;
    log(`→ ${meta.name.padEnd(42)} ${String(count).padStart(6)} filas  (${(bytes / 1024).toFixed(0)} KB)`);
  }

  // 2) auth
  log("");
  const auth = await dumpAuth(sb, dir, files);

  // 3) Storage
  const storage = await dumpStorage(sb, dir, files);
  if (!SKIP_STORAGE) {
    log(
      `→ storage total: ${storage.files} archivos, ${(storage.bytes / 1024 / 1024).toFixed(1)} MB ` +
        `(cruce: ${storage.crossCheck})`,
    );
  }

  // 4) Schema: migraciones del repo + definiciones vivas de prod.
  const migSrc = path.join(REPO_ROOT, "supabase", "migrations");
  const migrations = (await fs.readdir(migSrc)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of migrations) {
    await writeTracked(dir, files, `schema/migrations/${f}`, await fs.readFile(path.join(migSrc, f)));
  }
  log(`\n→ schema: ${migrations.length} migraciones del repo copiadas`);
  const schemaLive = await dumpSchemaLive(dir, files);

  // 5) Orden de restore + primary keys
  const { order, source } = await computeRestoreOrder(tables.map((t) => t.name));
  log(`→ orden de restore: ${source}`);
  const primaryKeys = await discoverPrimaryKeys(tables.map((t) => t.name));

  // 6) Resumen humano
  const totalRows = Object.values(tableFiles).reduce((a, f) => a + f.rows, 0);
  await writeTracked(dir, files, "RESUMEN.md", buildResumen(loaded, startedAt.toISOString()));

  // 7) README del backup
  const readme = `# Backup de La Polla — ${stamp}

Snapshot completo del proyecto Supabase \`${projectRef}\`, tomado con
\`npx tsx scripts/export-backup.ts\` el ${startedAt.toISOString()}.

## ⚠️ Esto tiene datos personales

\`auth/\` y \`tables/users.json\` llevan **teléfonos** (y emails) de ${auth.users || "…"} personas
reales, \`storage/\` lleva comprobantes de pago y \`schema/live/cron_jobs.json\`
puede llevar secretos de los crons. Trátalo como tal:

- **NUNCA** lo commitees. El repo de la app es público (MIT).
- No lo subas a Drive/Dropbox compartido ni lo pases por chat.
- Si lo mueves, que sea cifrado y a un disco o una máquina tuya.

## Qué hay acá

| Ruta | Qué es |
| --- | --- |
| \`RESUMEN.md\` | Los números en texto plano: totales y la tabla final de cada polla. Se lee sin DB. |
| \`_manifest.json\` | Inventario: filas y sha256 por tabla, sha256 y bytes de cada archivo, orden de restore. |
| \`tables/*.json\` | Una tabla de \`public\` por archivo, filas completas. |
| \`auth/\` | Cuentas. \`restore-auth.sql\` recrea usuarios con su MISMO uuid. |
| \`storage/\` | Archivos de los buckets (comprobantes, premios, evidencias). |
| \`schema/migrations/\` | Las ${migrations.length} migraciones del repo. |
| \`schema/live/\` | Definiciones REALES de prod: funciones, triggers, policies, RLS, columnas, crons, buckets y migraciones registradas. |

## Reabrir desde acá

Ver \`docs/backup-restore.md\` en el repo. Primero \`npx tsx scripts/verify-backup.ts\`
sobre esta carpeta.

Total: ${totalRows.toLocaleString("es-CO")} filas en ${tables.length} tablas.
`;
  await writeTracked(dir, files, "README.md", readme);

  // 8) Manifiesto (lo último que se escribe dentro de la carpeta)
  const finishedAt = new Date();
  const manifest = {
    generatedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationSeconds: Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000),
    projectRef,
    supabaseUrl: SUPABASE_URL,
    script: "scripts/export-backup.ts",
    formatVersion: 2,
    totals: {
      tables: tables.length,
      rows: totalRows,
      storageFiles: storage.files,
      storageBytes: storage.bytes,
      authUsers: auth.users,
      authIdentities: auth.identities,
      trackedFiles: Object.keys(files).length,
    },
    auth,
    storage: { buckets: storage.buckets, crossCheck: storage.crossCheck },
    schemaLive,
    tables: tableFiles,
    files,
    primaryKeys,
    restoreOrder: order,
    restoreOrderSource: source,
    migrations,
    flags: {
      SKIP_STORAGE,
      SKIP_PII,
      managementTokenSource: MGMT?.source ?? null,
      hadManagementPat: Boolean(MGMT),
    },
  };
  await fs.writeFile(path.join(dir, "_manifest.json"), jsonBody(manifest), "utf8");

  // 9) Recién ahora el backup existe con su nombre definitivo.
  await renameWithRetry(dir, finalDir);

  log(`\n=== Listo en ${manifest.durationSeconds} s ===`);
  log(
    `${totalRows.toLocaleString("es-CO")} filas · ${tables.length} tablas · ${auth.users} cuentas · ` +
      `${storage.files} archivos de storage (${(storage.bytes / 1024 / 1024).toFixed(1)} MB)`,
  );
  if (schemaLive.errors.length) log(`! schema/live con ${schemaLive.errors.length} error(es): ver _manifest.json`);
  if (auth.mode === "admin-api" || storage.crossCheck === "sin token") {
    log(`! Backup REDUCIDO (auth ${auth.mode}, cruce de Storage: ${storage.crossCheck}): verify-backup lo rechaza salvo ALLOW_REDUCED_BACKUP=1.`);
  }
  log(`${finalDir}\n`);
}

main().catch((err) => {
  console.error(`\nBACKUP FALLÓ: ${err.message}\n`);
  console.error(`Si quedó una carpeta .partial, no es un backup válido.\n`);
  process.exit(1);
});
