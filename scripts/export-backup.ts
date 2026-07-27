// scripts/export-backup.ts — Backup COMPLETO y offline de La Polla.
//
// Nació del cierre de temporada post-Mundial 2026 (2026-07-26): si algún
// día se reabre la app, o si Supabase pausa/pierde el proyecto free-tier,
// esto es lo único que garantiza que los puntos, los pronósticos y la
// gente sigan existiendo. Es SOLO-LECTURA: no escribe ni una fila en la DB.
//
//   npx tsx scripts/export-backup.ts
//
// Env (de .env, igual que el resto de scripts/):
//   NEXT_PUBLIC_SUPABASE_URL     · requerido
//   SUPABASE_SERVICE_ROLE_KEY    · requerido (lee todo, bypass RLS)
//   SUPABASE_30_DAYS             · opcional — PAT de la Management API.
//                                  Con él el backup sube de nivel: dump
//                                  COMPLETO de auth.users/auth.identities
//                                  (todas las columnas, no solo las que
//                                  expone la admin API) + SQL de restore
//                                  listo + orden de restore derivado del
//                                  grafo real de FKs. Sin él el backup
//                                  sigue siendo válido, con auth reducido.
// Flags:
//   BACKUP_DIR=<path>  destino (default: ./backups)
//   SKIP_STORAGE=1     no baja los comprobantes de pago (Storage)
//   SKIP_PII=1         no exporta auth (teléfonos/emails). Ojo: sin auth
//                      no se puede reabrir con las MISMAS cuentas.
//
// ─── Notas de diseño ───
// · `select("*")`: la regla del repo prohíbe el `*` en código de APP (para
//   no filtrar una columna sensible futura). Un backup necesita TODAS las
//   columnas por definición — es la excepción explícita, no un descuido.
// · PostgREST topa en 1000 filas por request incluso con service_role
//   (verificado 2026-07-26 contra prod). Todo se pagina y después se
//   VERIFICA contra el count exacto: si no cuadra, el script falla. Un
//   backup silenciosamente truncado es peor que no tener backup.
// · Las tablas se auto-descubren del OpenAPI de PostgREST, así que una
//   tabla nueva entra al backup sola, sin tocar este archivo.
// · Todo salida va a `backups/` (gitignored). El repo es PÚBLICO: este
//   dump lleva teléfonos, NUNCA se commitea.
import "dotenv/config";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";

// ─── Config ───

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MGMT_PAT = process.env.SUPABASE_30_DAYS;
const SKIP_STORAGE = process.env.SKIP_STORAGE === "1";
const SKIP_PII = process.env.SKIP_PII === "1";
const PAGE = 1000; // cap duro de PostgREST

const REPO_ROOT = path.resolve(__dirname, "..");
const BACKUP_ROOT = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : path.join(REPO_ROOT, "backups");

/** Orden de restore por defecto, derivado del grafo de FKs de prod al
 *  2026-07-26. Solo se usa si NO hay PAT para recalcularlo en vivo.
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
      const wait = 1500 * (i + 1);
      if (i < tries - 1) {
        log(`   … ${label} falló (${(err as Error).message}). Reintento en ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw new Error(`${label}: agotados los reintentos — ${(lastErr as Error)?.message}`);
}

/** Query SQL cruda por la Management API. Solo disponible con PAT.
 *  No tiene el cap de 1000 filas de PostgREST. */
async function mgmtQuery<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  if (!MGMT_PAT) throw new Error("sin SUPABASE_30_DAYS");
  const ref = new URL(SUPABASE_URL!).hostname.split(".")[0];
  return retry(`mgmt query`, async () => {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MGMT_PAT}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 300)}`);
    return JSON.parse(text) as T[];
  });
}

function sha256(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

async function writeJson(file: string, data: unknown): Promise<{ bytes: number; sha256: string }> {
  // indent 1: legible con un editor/grep dentro de 5 años sin inflar el
  // archivo como indent 2 en tablas de 15k filas.
  const body = JSON.stringify(data, null, 1);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body, "utf8");
  return { bytes: Buffer.byteLength(body), sha256: sha256(body) };
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
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
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
};

/** Escapa un valor JS a literal SQL de Postgres. */
function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") return `${sqlLiteral(JSON.stringify(v))}::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

function buildInsertSql(schemaTable: string, rows: Record<string, unknown>[], conflictCols: string): string {
  if (rows.length === 0) return `-- ${schemaTable}: sin filas\n`;
  const cols = Object.keys(rows[0]);
  const chunks: string[] = [];
  for (let i = 0; i < rows.length; i += 50) {
    const values = rows
      .slice(i, i + 50)
      .map((r) => `  (${cols.map((c) => sqlLiteral(r[c])).join(", ")})`)
      .join(",\n");
    chunks.push(
      `INSERT INTO ${schemaTable} (${cols.map((c) => `"${c}"`).join(", ")}) VALUES\n${values}\nON CONFLICT (${conflictCols}) DO NOTHING;`,
    );
  }
  return chunks.join("\n\n") + "\n";
}

async function dumpAuth(sb: SupabaseClient, dir: string): Promise<AuthDump> {
  if (SKIP_PII) {
    log("→ auth: SALTEADO (SKIP_PII=1). Sin esto NO se puede reabrir con las mismas cuentas.");
    return { mode: "skipped", users: 0, identities: 0 };
  }

  // Camino de máxima fidelidad: todas las columnas de auth.users +
  // auth.identities por SQL. Es lo único que permite recrear las cuentas
  // con su MISMO uuid (la admin API no deja elegir el id al crear).
  if (MGMT_PAT) {
    try {
      const users = await mgmtQuery<Record<string, unknown>>(
        "select * from auth.users order by created_at asc;",
      );
      const identities = await mgmtQuery<Record<string, unknown>>(
        "select * from auth.identities order by created_at asc;",
      );
      await writeJson(path.join(dir, "auth", "users.full.json"), users);
      await writeJson(path.join(dir, "auth", "identities.full.json"), identities);

      const sql =
        `-- Restore de cuentas de La Polla — generado por scripts/export-backup.ts\n` +
        `-- Pegar en el SQL editor de Supabase (o correr con psql) ANTES de\n` +
        `-- restaurar las tablas de public: todo cuelga de estos uuids.\n` +
        `-- Idempotente: ON CONFLICT DO NOTHING.\n\n` +
        buildInsertSql("auth.users", users, "id") +
        "\n" +
        buildInsertSql("auth.identities", identities, "id") +
        "\n";
      await fs.writeFile(path.join(dir, "auth", "restore-auth.sql"), sql, "utf8");

      log(`→ auth: dump COMPLETO — ${users.length} usuarios, ${identities.length} identities (+ SQL de restore)`);
      return { mode: "full", users: users.length, identities: identities.length };
    } catch (err) {
      log(`   ! dump completo de auth falló (${(err as Error).message}); caigo a la admin API`);
    }
  }

  // Fallback: admin API. Trae lo esencial (id, phone, email, fechas) pero
  // no permite recrear la cuenta con el mismo uuid sin SQL manual.
  const all: unknown[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await retry(`listUsers(${page})`, async () => {
      const r = await sb.auth.admin.listUsers({ page, perPage: PAGE });
      if (r.error) throw new Error(r.error.message);
      return r;
    });
    if (error) throw error;
    all.push(...data.users);
    if (data.users.length < PAGE) break;
  }
  await writeJson(path.join(dir, "auth", "users.json"), all);
  log(`→ auth: ${all.length} usuarios (admin API — sin SQL de restore, falta el PAT)`);
  return { mode: "admin-api", users: all.length, identities: 0 };
}

// ─── Storage (comprobantes de pago) ───

type StorageStats = { buckets: number; files: number; bytes: number };

async function listAllObjects(sb: SupabaseClient, bucket: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  const entries = await retry(`storage ls ${bucket}/${prefix}`, async () => {
    const { data, error } = await sb.storage.from(bucket).list(prefix, { limit: PAGE });
    if (error) throw new Error(error.message);
    return data ?? [];
  });
  for (const e of entries) {
    const full = prefix ? `${prefix}/${e.name}` : e.name;
    // Sin `id` = carpeta (así las modela la API de Storage).
    if (e.id === null || e.id === undefined) out.push(...(await listAllObjects(sb, bucket, full)));
    else out.push(full);
  }
  return out;
}

async function dumpStorage(sb: SupabaseClient, dir: string): Promise<StorageStats> {
  if (SKIP_STORAGE) {
    log("→ storage: SALTEADO (SKIP_STORAGE=1)");
    return { buckets: 0, files: 0, bytes: 0 };
  }
  const { data: buckets, error } = await sb.storage.listBuckets();
  if (error) {
    log(`   ! no pude listar buckets (${error.message}); sigo sin storage`);
    return { buckets: 0, files: 0, bytes: 0 };
  }
  let files = 0;
  let bytes = 0;
  for (const b of buckets ?? []) {
    const objects = await listAllObjects(sb, b.name);
    log(`→ storage/${b.name}: ${objects.length} archivos`);
    for (const key of objects) {
      const blob = await retry(`download ${b.name}/${key}`, async () => {
        const { data, error: dlErr } = await sb.storage.from(b.name).download(key);
        if (dlErr) throw new Error(dlErr.message);
        return data;
      });
      const buf = Buffer.from(await blob.arrayBuffer());
      const dest = path.join(dir, "storage", b.name, key);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, buf);
      files++;
      bytes += buf.byteLength;
    }
  }
  return { buckets: (buckets ?? []).length, files, bytes };
}

// ─── Primary keys (target de conflicto para el restore idempotente) ───

async function discoverPrimaryKeys(tables: string[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  if (MGMT_PAT) {
    try {
      const rows = await mgmtQuery<{ tabla: string; pk: string | null }>(`
        select c.relname as tabla,
               string_agg(a.attname, ',' order by k.ord) as pk
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
        join pg_constraint con on con.conrelid = c.oid and con.contype = 'p'
        join lateral unnest(con.conkey) with ordinality as k(attnum, ord) on true
        join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
        where c.relkind = 'r'
        group by c.relname;
      `);
      for (const r of rows) if (r.pk) out[r.tabla] = r.pk.split(",");
      return out;
    } catch (err) {
      log(`   ! no pude leer las PKs (${(err as Error).message}); asumo "id" donde exista`);
    }
  }
  // Sin PAT: asumimos "id" para las tablas que lo tengan. Las de PK
  // compuesta quedan sin entrada y el restore usa INSERT plano.
  for (const t of tables) out[t] = ["id"];
  return out;
}

// ─── Orden de restore desde el grafo real de FKs ───

async function computeRestoreOrder(tables: string[]): Promise<{ order: string[]; source: string }> {
  if (MGMT_PAT) {
    try {
      const edges = await mgmtQuery<{ tabla: string; depende_de: string }>(`
        select src.relname as tabla, tgt.relname as depende_de
        from pg_constraint con
        join pg_class src on src.oid = con.conrelid
        join pg_namespace sn on sn.oid = src.relnamespace and sn.nspname = 'public'
        join pg_class tgt on tgt.oid = con.confrelid
        join pg_namespace tn on tn.oid = tgt.relnamespace and tn.nspname = 'public'
        where con.contype = 'f' and src.relname <> tgt.relname;
      `);
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

// ─── Main ───

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el entorno (.env).",
    );
  }
  const startedAt = new Date();
  const stamp = startedAt.toISOString().replace(/[:T]/g, "-").slice(0, 16); // 2026-07-26-15-30
  const dir = path.join(BACKUP_ROOT, stamp);
  await fs.mkdir(dir, { recursive: true });

  const projectRef = new URL(SUPABASE_URL).hostname.split(".")[0];
  log(`\n=== Backup de La Polla ===`);
  log(`Proyecto : ${projectRef}`);
  log(`Destino  : ${dir}`);
  log(`Auth     : ${SKIP_PII ? "NO (SKIP_PII=1)" : MGMT_PAT ? "completo (PAT presente)" : "admin API"}`);
  log(`Storage  : ${SKIP_STORAGE ? "NO (SKIP_STORAGE=1)" : "sí"}\n`);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1) Tablas
  const tables = await discoverTables();
  log(`Descubiertas ${tables.length} tablas en public.\n`);

  const files: Record<string, { rows: number; bytes: number; sha256: string; orderedBy: string }> = {};
  const loaded: Record<string, Record<string, unknown>[]> = {};
  for (const meta of tables) {
    const { rows, count, orderedBy } = await dumpTable(sb, meta);
    const { bytes, sha256: hash } = await writeJson(path.join(dir, "tables", `${meta.name}.json`), rows);
    files[meta.name] = { rows: count, bytes, sha256: hash, orderedBy };
    loaded[meta.name] = rows;
    log(`→ ${meta.name.padEnd(42)} ${String(count).padStart(6)} filas  (${(bytes / 1024).toFixed(0)} KB)`);
  }

  // 2) auth
  log("");
  const auth = await dumpAuth(sb, dir);

  // 3) Storage
  const storage = await dumpStorage(sb, dir);
  if (!SKIP_STORAGE) {
    log(`→ storage total: ${storage.files} archivos, ${(storage.bytes / 1024 / 1024).toFixed(1)} MB`);
  }

  // 4) Schema (las migraciones son la definición del esquema)
  const migSrc = path.join(REPO_ROOT, "supabase", "migrations");
  const migDst = path.join(dir, "schema", "migrations");
  await fs.mkdir(migDst, { recursive: true });
  const migrations = (await fs.readdir(migSrc)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of migrations) await fs.copyFile(path.join(migSrc, f), path.join(migDst, f));
  log(`\n→ schema: ${migrations.length} migraciones copiadas`);

  // 5) Orden de restore + primary keys
  const { order, source } = await computeRestoreOrder(tables.map((t) => t.name));
  log(`→ orden de restore: ${source}`);
  const primaryKeys = await discoverPrimaryKeys(tables.map((t) => t.name));

  // 6) Resumen humano
  const resumen = buildResumen(loaded, startedAt.toISOString());
  await fs.writeFile(path.join(dir, "RESUMEN.md"), resumen, "utf8");

  // 7) Manifiesto
  const totalRows = Object.values(files).reduce((a, f) => a + f.rows, 0);
  const manifest = {
    generatedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    projectRef,
    supabaseUrl: SUPABASE_URL,
    script: "scripts/export-backup.ts",
    formatVersion: 1,
    totals: { tables: tables.length, rows: totalRows, storageFiles: storage.files, storageBytes: storage.bytes },
    auth,
    tables: files,
    primaryKeys,
    restoreOrder: order,
    restoreOrderSource: source,
    migrations,
    flags: { SKIP_STORAGE, SKIP_PII, hadManagementPat: Boolean(MGMT_PAT) },
  };
  await writeJson(path.join(dir, "_manifest.json"), manifest);

  // 8) README del backup
  const readme = `# Backup de La Polla — ${stamp}

Snapshot completo del proyecto Supabase \`${projectRef}\`, tomado con
\`npx tsx scripts/export-backup.ts\` el ${startedAt.toISOString()}.

## ⚠️ Esto tiene datos personales

\`auth/\` y \`tables/users.json\` llevan **teléfonos** (y emails) de ${auth.users || "…"} personas
reales, y \`storage/\` lleva comprobantes de pago. Tratalo como tal:

- **NUNCA** lo commitees. El repo de la app es público (MIT).
- No lo subas a Drive/Dropbox compartido ni lo pases por chat.
- Si lo movés, que sea a un disco tuyo o a una máquina tuya.

## Qué hay acá

| Ruta | Qué es |
| --- | --- |
| \`RESUMEN.md\` | Los números en texto plano: totales y la tabla final de cada polla. Se lee sin DB. |
| \`_manifest.json\` | Inventario: filas y sha256 por tabla, orden de restore, migraciones. |
| \`tables/*.json\` | Una tabla de \`public\` por archivo, filas completas. |
| \`auth/\` | Cuentas. \`restore-auth.sql\` recrea usuarios con su MISMO uuid. |
| \`storage/\` | Archivos de los buckets (comprobantes de pago/premio). |
| \`schema/migrations/\` | Las ${migrations.length} migraciones = definición del esquema. |

## Reabrir desde acá

Ver \`docs/backup-restore.md\` en el repo. Resumen: proyecto Supabase nuevo →
correr las migraciones en orden → \`auth/restore-auth.sql\` → \`npx tsx
scripts/restore-backup.ts\` apuntando a esta carpeta.

Total: ${totalRows.toLocaleString("es-CO")} filas en ${tables.length} tablas.
`;
  await fs.writeFile(path.join(dir, "README.md"), readme, "utf8");

  log(`\n=== Listo ===`);
  log(`${totalRows.toLocaleString("es-CO")} filas · ${tables.length} tablas · ${auth.users} cuentas · ${storage.files} archivos de storage`);
  log(`${dir}\n`);
}

main().catch((err) => {
  console.error(`\nBACKUP FALLÓ: ${err.message}\n`);
  process.exit(1);
});
