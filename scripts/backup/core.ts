// scripts/backup/core.ts — Funciones puras compartidas por los scripts de
// backup (export, verify, restore y restore-sql).
//
// Todo lo que vive acá se puede probar sin red, sin Supabase y sin disco
// real: el export/verify/restore les pasan lectores y listadores inyectados.
// Los tests están en tests/backup-core.test.ts.
import { createHash } from "crypto";

// ─── Token de la Management API ───

export type TokenSource = "SUPABASE_BACKUP_PAT" | "SUPABASE_ACCESS_TOKEN" | "SUPABASE_30_DAYS";

/** Orden de preferencia: un token propio del backup (revocable aparte),
 *  después el token del proyecto y por último el PAT histórico. Una variable
 *  vacía cuenta como ausente. Devuelve el NOMBRE de la variable para poder
 *  loguearlo; el valor nunca se imprime. */
export function resolveManagementToken(
  env: Record<string, string | undefined>,
): { token: string; source: TokenSource } | null {
  const order: TokenSource[] = ["SUPABASE_BACKUP_PAT", "SUPABASE_ACCESS_TOKEN", "SUPABASE_30_DAYS"];
  for (const name of order) {
    const value = env[name]?.trim();
    if (value) return { token: value, source: name };
  }
  return null;
}

/** `https://<ref>.supabase.co` → `<ref>`. */
export function projectRefFromUrl(url: string): string {
  return new URL(url).hostname.split(".")[0];
}

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

// ─── Carpetas de backup ───

/** Nombre de la carpeta de un backup: `2026-09-13-09-09` (UTC, minuto). */
export function backupStamp(date: Date): string {
  return date.toISOString().replace(/[:T]/g, "-").slice(0, 16);
}

const STAMP_RE = /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/;
export const PARTIAL_SUFFIX = ".partial";

export function partialDirName(stamp: string): string {
  return `${stamp}${PARTIAL_SUFFIX}`;
}

export function isPartialBackupDir(name: string): boolean {
  return name.endsWith(PARTIAL_SUFFIX);
}

/** El backup más nuevo entre nombres de carpeta. Ignora las `.partial` (un
 *  export que no terminó) y cualquier carpeta que no tenga forma de stamp. */
export function pickNewestBackup(dirNames: string[]): string | null {
  const complete = dirNames.filter((n) => STAMP_RE.test(n)).sort();
  return complete.length ? complete[complete.length - 1] : null;
}

/** Horas transcurridas desde `generatedAt`. NaN si la fecha es ilegible. */
export function backupAgeHours(generatedAt: string, now: Date): number {
  const t = Date.parse(generatedAt);
  if (Number.isNaN(t)) return Number.NaN;
  return (now.getTime() - t) / 3_600_000;
}

/** `MAX_AGE_HOURS` vacío o ausente = sin límite. Un valor inválido es error
 *  (mejor fallar que creer que se vigila la frescura cuando no). */
export function parseMaxAgeHours(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`MAX_AGE_HOURS inválido: "${raw}" (se espera un número de horas mayor a 0)`);
  }
  return n;
}

// ─── Storage: listado paginado ───

export type StorageEntry = { name: string; id?: string | null };
export type StorageListFn = (
  prefix: string,
  page: { limit: number; offset: number },
) => Promise<StorageEntry[]>;

/** Lista TODOS los objetos de un bucket, recursivo por carpetas y paginado
 *  con offset. La API de Storage devuelve como mucho `limit` entradas por
 *  llamada: sin paginar, una carpeta con más de 1000 archivos se truncaba en
 *  silencio. Una entrada sin `id` es una carpeta (así las modela la API). */
export async function listAllStorageObjects(
  list: StorageListFn,
  prefix = "",
  pageSize = 1000,
): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const entries = await list(prefix, { limit: pageSize, offset });
    for (const e of entries) {
      const full = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.id === null || e.id === undefined) {
        out.push(...(await listAllStorageObjects(list, full, pageSize)));
      } else {
        out.push(full);
      }
    }
    if (entries.length < pageSize) break;
  }
  return out;
}

/** Compara lo listado por la API contra `count(*)` de storage.objects por
 *  bucket. Devuelve un problema por bucket que no cuadre (incluye buckets
 *  que aparecen solo de un lado). */
export function compareStorageCounts(
  listed: Record<string, number>,
  inDb: Record<string, number>,
): string[] {
  const problems: string[] = [];
  const buckets = Array.from(new Set([...Object.keys(listed), ...Object.keys(inDb)])).sort();
  for (const b of buckets) {
    const l = listed[b] ?? 0;
    const d = inDb[b] ?? 0;
    if (l !== d) problems.push(`storage/${b}: la API listó ${l} objetos y storage.objects tiene ${d}`);
  }
  return problems;
}

/** Además del conteo, compara los NOMBRES: con paginación por offset sobre
 *  un bucket que cambia, la API puede repetir uno y saltarse otro y el total
 *  igual cuadrar. No devuelve nombres (pueden llevar ids), solo cuántos. */
export function compareStorageNames(
  listed: Record<string, string[]>,
  inDb: Record<string, string[]>,
): string[] {
  const problems: string[] = [];
  const buckets = Array.from(new Set([...Object.keys(listed), ...Object.keys(inDb)])).sort();
  for (const b of buckets) {
    const l = new Set(listed[b] ?? []);
    const d = new Set(inDb[b] ?? []);
    const dupes = (listed[b] ?? []).length - l.size;
    const onlyListed = Array.from(l).filter((n) => !d.has(n)).length;
    const onlyDb = Array.from(d).filter((n) => !l.has(n)).length;
    if (dupes > 0) problems.push(`storage/${b}: la API repitió ${dupes} objeto(s) al paginar`);
    if (onlyListed > 0 || onlyDb > 0) {
      problems.push(
        `storage/${b}: ${onlyDb} objeto(s) de storage.objects no aparecieron en el listado y ${onlyListed} listado(s) no existen en storage.objects`,
      );
    }
  }
  return problems;
}

// ─── Esquema vivo: políticas legibles ───

export type PolicyRow = {
  schemaname: string;
  tablename: string;
  policyname: string;
  permissive: string;
  roles: string[] | string | null;
  cmd: string;
  qual: string | null;
  with_check: string | null;
};

function policyRoles(roles: PolicyRow["roles"]): string[] {
  if (Array.isArray(roles)) return roles;
  if (typeof roles === "string") {
    return roles.replace(/^\{|\}$/g, "").split(",").map((r) => r.trim().replace(/^"|"$/g, "")).filter(Boolean);
  }
  return [];
}

/** CREATE POLICY equivalente a una fila de pg_policies (referencia legible,
 *  no se ejecuta automáticamente). */
export function renderPolicySql(p: PolicyRow): string {
  const roles = policyRoles(p.roles)
    .map((r) => (/^[a-z_][a-z0-9_]*$/.test(r) ? r : quoteIdent(r)))
    .join(", ");
  let sql =
    `CREATE POLICY ${quoteIdent(p.policyname)} ON ${quoteIdent(p.schemaname)}.${quoteIdent(p.tablename)}` +
    ` AS ${p.permissive} FOR ${p.cmd}${roles ? ` TO ${roles}` : ""}`;
  if (p.qual) sql += ` USING (${p.qual})`;
  if (p.with_check) sql += ` WITH CHECK (${p.with_check})`;
  return `${sql};`;
}

// ─── Manifiesto de archivos (sha256 + bytes) ───

export type FileEntry = { bytes: number; sha256: string };
export type FileManifest = Record<string, FileEntry>;

export function fileEntry(data: Buffer | string): FileEntry {
  const bytes = typeof data === "string" ? Buffer.byteLength(data) : data.byteLength;
  return { bytes, sha256: sha256Hex(data) };
}

/** Ruta para mensajes: los objetos de Storage llevan ids en su nombre
 *  (`casa/<entrada>/<intento>.jpg`), así que se muestran recortados. */
export function displayPath(rel: string): string {
  const m = /^storage\/([^/]+)\/(.+)$/.exec(rel);
  if (!m) return rel;
  const rest = m[2];
  return `storage/${m[1]}/…${rest.slice(-10)}`;
}

/** Verifica cada archivo del manifiesto contra lo que hay en disco.
 *  `read` devuelve null si el archivo no existe. `onDisk` (opcional) es la
 *  lista de rutas relativas realmente presentes: lo que esté en disco y no
 *  en el manifiesto también es un problema (archivo agregado o export a
 *  medias). Las rutas usan `/` como separador. */
export async function verifyFileManifest(
  files: FileManifest,
  read: (relPath: string) => Promise<Buffer | null>,
  onDisk?: string[],
): Promise<{ problems: string[]; checked: number; bytes: number }> {
  const problems: string[] = [];
  let checked = 0;
  let bytes = 0;
  for (const rel of Object.keys(files).sort()) {
    const expected = files[rel];
    const buf = await read(rel);
    if (!buf) {
      problems.push(`${displayPath(rel)}: FALTA en disco`);
      continue;
    }
    if (buf.byteLength !== expected.bytes) {
      problems.push(`${displayPath(rel)}: ${buf.byteLength} bytes, el manifiesto dice ${expected.bytes}`);
      continue;
    }
    if (sha256Hex(buf) !== expected.sha256) {
      problems.push(`${displayPath(rel)}: sha256 no coincide (archivo corrupto o editado)`);
      continue;
    }
    checked++;
    bytes += buf.byteLength;
  }
  if (onDisk) {
    const known = new Set(Object.keys(files));
    for (const rel of [...onDisk].sort()) {
      if (!known.has(rel)) problems.push(`${displayPath(rel)}: está en disco pero no en el manifiesto`);
    }
  }
  return { problems, checked, bytes };
}

// ─── ¿El backup está completo o salió reducido? ───

export type CompletenessInput = {
  formatVersion?: number;
  auth?: { mode?: string; note?: string };
  storage?: { crossCheck?: string };
};

/** Un backup puede terminar "bien" y aun así no servir para reabrir la app:
 *  si auth cayó a la admin API no hay forma de recrear las cuentas con su
 *  mismo uuid, y si Storage no se cruzó contra storage.objects no hay prueba
 *  de que el listado estuvo completo. Por defecto eso es un PROBLEMA (el
 *  runner no debe rotar ese backup como bueno); con `allowReduced` baja a
 *  aviso. Saltarse auth o Storage a propósito (SKIP_PII / SKIP_STORAGE) es
 *  siempre un aviso. */
export function assessBackupCompleteness(
  manifest: CompletenessInput,
  opts: { allowReduced?: boolean } = {},
): { problems: string[]; warnings: string[] } {
  const problems: string[] = [];
  const warnings: string[] = [];
  const reduced = (msg: string) =>
    (opts.allowReduced ? warnings : problems).push(
      opts.allowReduced ? `${msg} (aceptado con ALLOW_REDUCED_BACKUP=1)` : `${msg}. Para aceptarlo igual: ALLOW_REDUCED_BACKUP=1`,
    );
  const version = manifest.formatVersion ?? 1;
  const authMode = manifest.auth?.mode;

  if (authMode === "skipped") {
    warnings.push("este backup NO tiene auth (SKIP_PII=1): no alcanza para reabrir con las mismas cuentas");
  } else if (authMode !== "full") {
    const note = manifest.auth?.note ? `: ${manifest.auth.note}` : "";
    reduced(
      `auth salió en modo ${authMode ?? "desconocido"}${note}. Sin auth/users.full.json ni restore-auth.sql ` +
        `no se pueden recrear las cuentas con su mismo uuid`,
    );
  }

  if (version >= 2) {
    const cross = manifest.storage?.crossCheck;
    if (cross === "salteado") {
      warnings.push("este backup NO tiene Storage (SKIP_STORAGE=1): faltan comprobantes y evidencias");
    } else if (cross !== "storage.objects") {
      reduced(`el listado de Storage no se cruzó contra storage.objects (cruce: ${cross ?? "sin dato"})`);
    }
  }
  return { problems, warnings };
}

// ─── Guard del restore ───

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isLocalHost(url: string): boolean {
  return LOCAL_HOSTS.has(new URL(url).hostname.toLowerCase());
}

/** Identidad del destino que hay que escribir en ALLOW_REMOTE_TARGET: el ref
 *  para `*.supabase.co`, el hostname completo para cualquier otro host. */
export function remoteTargetIdentity(url: string): string {
  const host = new URL(url).hostname.toLowerCase();
  return host.endsWith(".supabase.co") ? host.split(".")[0] : host;
}

/** El restore por PostgREST solo escribe en un Supabase local, salvo que
 *  ALLOW_REMOTE_TARGET nombre EXACTAMENTE el destino remoto. Así un .env
 *  apuntando a prod no alcanza para pisar datos reales. */
export function checkRestoreTarget(
  url: string,
  allowRemoteTarget: string | undefined,
): { ok: true; local: boolean; identity: string } | { ok: false; identity: string; reason: string } {
  const identity = remoteTargetIdentity(url);
  if (isLocalHost(url)) return { ok: true, local: true, identity };
  const allowed = allowRemoteTarget?.trim();
  if (!allowed) {
    return {
      ok: false,
      identity,
      reason:
        `El destino ${identity} no es local. Para escribir en un host remoto hay que ` +
        `declararlo con ALLOW_REMOTE_TARGET=${identity}.`,
    };
  }
  if (allowed !== identity) {
    return {
      ok: false,
      identity,
      reason: `ALLOW_REMOTE_TARGET="${allowed}" no coincide con el destino real (${identity}).`,
    };
  }
  return { ok: true, local: false, identity };
}

// ─── SQL de restore ───

/** Identificador SQL entre comillas dobles. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** `public.tabla` → `"public"."tabla"`. */
export function quoteQualified(schemaTable: string): string {
  const dot = schemaTable.indexOf(".");
  if (dot < 0) throw new Error(`Se esperaba esquema.tabla, llegó "${schemaTable}"`);
  return `${quoteIdent(schemaTable.slice(0, dot))}.${quoteIdent(schemaTable.slice(dot + 1))}`;
}

/** Literal con dollar-quoting cuya etiqueta no aparece en el texto. */
export function dollarQuote(text: string, base = "lp"): string {
  for (let i = 0; ; i++) {
    const tag = `$${base}${i}$`;
    if (!text.includes(tag)) return `${tag}${text}${tag}`;
  }
}

/** Parte filas en lotes que respeten un máximo de filas y de caracteres
 *  JSON (una fila enorme igual va sola en su lote). */
export function chunkRows<T>(rows: T[], maxRows: number, maxChars: number): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let chars = 0;
  for (const row of rows) {
    const size = JSON.stringify(row).length + 1;
    if (current.length > 0 && (current.length >= maxRows || chars + size > maxChars)) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(row);
    chars += size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export type RestoreSection = {
  /** `public.predictions`, `auth.users`, … */
  schemaTable: string;
  rows: Record<string, unknown>[];
};

/** Tablas que las migraciones del repo ya siembran al crear el esquema
 *  (`supabase db reset`): 028 y 064 insertan en `app_config`, y 097 inserta
 *  `casa_operation_control` con mode='legacy'. En un destino recién creado
 *  NO están vacías, así que el restore las reemplaza por el contenido del
 *  backup en vez de exigir que estén vacías. */
export const SCHEMA_SEEDED_TABLES = ["public.app_config", "public.casa_operation_control"] as const;

/** `REPLACE_TABLES` del entorno → lista `public.tabla`. Ausente = las
 *  sembradas por el esquema; vacía = ninguna. Acepta `tabla` o `esquema.tabla`. */
export function parseReplaceTables(raw: string | undefined): string[] {
  if (raw === undefined) return [...SCHEMA_SEEDED_TABLES];
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (t.includes(".") ? t : `public.${t}`));
}

export type RestoreSqlOptions = {
  sections: RestoreSection[];
  /** Texto libre para la cabecera (sin datos personales). */
  title: string;
  /** Script que generó el archivo, para la cabecera. */
  generator?: string;
  /** Tablas (`esquema.tabla`) cuyo contenido actual se borra dentro de la
   *  transacción y se reemplaza por el del backup. Solo aplica a las que
   *  vienen en `sections`. Default: SCHEMA_SEEDED_TABLES. */
  replaceTables?: readonly string[];
  /** Si es false (default), el SQL aborta si alguna tabla destino (fuera de
   *  `replaceTables`) ya tiene filas, y cualquier fila del backup que no
   *  quede escrita tal cual aborta todo. Si es true, esas filas se saltan y
   *  se informan con NOTICE por lote. */
  allowNonEmpty?: boolean;
  /** Si es false (default), una columna del backup que no existe en el destino aborta. */
  allowMissingColumns?: boolean;
  maxRowsPerChunk?: number;
  maxCharsPerChunk?: number;
};

/** Genera un .sql para psql que restaura filas dentro de UNA transacción con
 *  `session_replication_role = replica` (triggers y FKs apagados: el lock de
 *  pronósticos, el guard de Casa v2 y `on_auth_user_created` bloquean o
 *  alteran un restore fila por fila por PostgREST).
 *
 *  Cada lote pasa por `jsonb_populate_recordset(NULL::tabla, …)`, así Postgres
 *  convierte arrays, jsonb, enums y fechas con los tipos REALES del destino.
 *  Las columnas generadas se omiten (se recalculan) y las identity se
 *  insertan con OVERRIDING SYSTEM VALUE. Cada lote comprueba que TODAS sus
 *  filas quedaron escritas y que, buscadas por PK, el destino tiene el mismo
 *  contenido que el backup. Al final ajusta secuencias y compara los counts:
 *  si algo no cuadra, ROLLBACK de todo. */
export function buildRestoreSql(opts: RestoreSqlOptions): string {
  const maxRows = opts.maxRowsPerChunk ?? 500;
  const maxChars = opts.maxCharsPerChunk ?? 1_000_000;
  const allowNonEmpty = Boolean(opts.allowNonEmpty);
  const allowMissing = Boolean(opts.allowMissingColumns);
  const sectionNames = new Set(opts.sections.map((s) => s.schemaTable));
  const replace = new Set((opts.replaceTables ?? SCHEMA_SEEDED_TABLES).filter((t) => sectionNames.has(t)));
  const out: string[] = [];

  out.push(`-- ${opts.title}`);
  out.push(`-- Generado por ${opts.generator ?? "scripts/backup/core.ts"}. Correr con psql contra un`);
  out.push(`-- Supabase LOCAL con el esquema ya aplicado:`);
  out.push(`--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f <archivo>`);
  out.push(`-- Todo va en una transacción: si falla un lote o un conteo, no queda nada escrito.`);
  if (replace.size > 0) {
    out.push(`-- Se reemplazan (no se exigen vacías) porque el esquema las siembra: ${Array.from(replace).join(", ")}.`);
  }
  if (allowNonEmpty) {
    out.push(`-- Generado con ALLOW_NONEMPTY: las filas que ya existan se saltan y se informan con NOTICE.`);
  }
  out.push(`-- Contiene datos personales: no lo commitees ni lo compartas.`);
  out.push("");
  out.push("BEGIN;");
  out.push("SET LOCAL session_replication_role = replica;");
  out.push("");
  out.push(`CREATE FUNCTION pg_temp.lp_restore_chunk(p_table regclass, p_rows jsonb, p_allow_missing boolean, p_allow_skip boolean)
RETURNS bigint LANGUAGE plpgsql AS $fn$
DECLARE
  v_expected bigint := jsonb_array_length(p_rows);
  v_keys text[];
  v_missing text[];
  v_cols text;
  v_text_cols text;
  v_pk_cols text;
  v_pk_usable boolean;
  v_count bigint;
  v_diff bigint;
BEGIN
  IF v_expected = 0 THEN RETURN 0; END IF;
  SELECT array_agg(DISTINCT k) INTO v_keys
  FROM jsonb_array_elements(p_rows) AS r(obj), LATERAL jsonb_object_keys(r.obj) AS k;
  IF v_keys IS NULL THEN
    RAISE EXCEPTION 'restore: % recibió % fila(s) sin columnas', p_table, v_expected;
  END IF;

  SELECT array_agg(k ORDER BY k) INTO v_missing
  FROM unnest(v_keys) AS k
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = p_table AND a.attname = k AND a.attnum > 0 AND NOT a.attisdropped
  );
  IF v_missing IS NOT NULL AND NOT p_allow_missing THEN
    RAISE EXCEPTION 'restore: % no tiene las columnas % que trae el backup', p_table, v_missing;
  END IF;

  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum),
         string_agg(quote_ident(a.attname) || '::text', ', ' ORDER BY a.attnum)
    INTO v_cols, v_text_cols
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = p_table AND a.attnum > 0 AND NOT a.attisdropped
    AND a.attgenerated = '' AND a.attname = ANY (v_keys);
  IF v_cols IS NULL THEN
    RAISE EXCEPTION 'restore: % no tiene ninguna columna escribible en común con el backup', p_table;
  END IF;

  EXECUTE format(
    'INSERT INTO %s (%s) OVERRIDING SYSTEM VALUE SELECT %s FROM jsonb_populate_recordset(NULL::%s, $1) ON CONFLICT DO NOTHING',
    p_table, v_cols, v_cols, p_table
  ) USING p_rows;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count < v_expected THEN
    IF p_allow_skip THEN
      RAISE NOTICE 'restore: % saltó % de % fila(s) del lote (chocaron con filas que ya estaban)', p_table, v_expected - v_count, v_expected;
    ELSE
      RAISE EXCEPTION 'restore: % escribió % de % fila(s) del lote; las demás chocaron con filas que ya estaban', p_table, v_count, v_expected;
    END IF;
  END IF;

  -- Contenido: cada fila del lote tiene que estar en el destino tal cual
  -- (comparación como texto, columna por columna). Con PK se busca solo por
  -- las claves del lote; sin PK, contra la tabla entera.
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY k.ord),
         bool_and(a.attgenerated = '' AND a.attname = ANY (v_keys))
    INTO v_pk_cols, v_pk_usable
  FROM pg_catalog.pg_index i
  CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
  JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
  WHERE i.indrelid = p_table AND i.indisprimary;
  IF v_pk_cols IS NOT NULL AND v_pk_usable THEN
    EXECUTE format(
      'SELECT count(*) FROM (SELECT %1$s FROM jsonb_populate_recordset(NULL::%2$s, $1) EXCEPT ALL SELECT %1$s FROM %2$s WHERE (%3$s) IN (SELECT %3$s FROM jsonb_populate_recordset(NULL::%2$s, $1))) d',
      v_text_cols, p_table, v_pk_cols
    ) INTO v_diff USING p_rows;
  ELSE
    EXECUTE format(
      'SELECT count(*) FROM (SELECT %1$s FROM jsonb_populate_recordset(NULL::%2$s, $1) EXCEPT ALL SELECT %1$s FROM %2$s) d',
      v_text_cols, p_table
    ) INTO v_diff USING p_rows;
  END IF;
  IF v_diff > 0 THEN
    IF p_allow_skip THEN
      RAISE NOTICE 'restore: % tiene % fila(s) del lote con contenido distinto al backup', p_table, v_diff;
    ELSE
      RAISE EXCEPTION 'restore: % quedó con % fila(s) del lote distintas al backup', p_table, v_diff;
    END IF;
  END IF;
  RETURN v_count;
END
$fn$;`);
  out.push("");

  const nonEmpty = opts.sections.filter((s) => s.rows.length > 0);
  const guarded = opts.sections.filter((s) => !replace.has(s.schemaTable));

  if (!allowNonEmpty && guarded.length > 0) {
    out.push(`-- Guarda: el destino tiene que venir recién creado (supabase db reset): vacío en`);
    out.push(`-- todas las tablas a restaurar, salvo las que el esquema siembra y se reemplazan.`);
    out.push(`DO $guard$`);
    out.push(`DECLARE v_n bigint;`);
    out.push(`BEGIN`);
    for (const s of guarded) {
      const q = quoteQualified(s.schemaTable);
      const hint = s.schemaTable.startsWith("auth.")
        ? "si las cuentas ya se restauraron con auth/restore-auth.sql, genera este SQL con SKIP_AUTH=1"
        : "el destino tiene que venir de supabase db reset; si la siembran las migraciones, agrégala a REPLACE_TABLES";
      out.push(`  EXECUTE 'SELECT count(*) FROM ${q.replace(/'/g, "''")}' INTO v_n;`);
      out.push(
        `  IF v_n > 0 THEN RAISE EXCEPTION 'restore: ${s.schemaTable.replace(/'/g, "''")} ya tiene % filas (${hint})', v_n; END IF;`,
      );
    }
    out.push(`END`);
    out.push(`$guard$;`);
    out.push("");
  }

  const replaced = opts.sections.filter((s) => replace.has(s.schemaTable));
  if (replaced.length > 0) {
    out.push(`-- Tablas que el esquema siembra: quedan exactamente con el contenido del backup.`);
    for (const s of replaced) out.push(`DELETE FROM ${quoteQualified(s.schemaTable)};`);
    out.push("");
  }

  for (const s of nonEmpty) {
    const q = quoteQualified(s.schemaTable);
    const chunks = chunkRows(s.rows, maxRows, maxChars);
    out.push(`-- ${s.schemaTable}: ${s.rows.length} filas en ${chunks.length} lote(s)`);
    for (const chunk of chunks) {
      const payload = dollarQuote(JSON.stringify(chunk));
      out.push(
        `SELECT pg_temp.lp_restore_chunk('${q.replace(/'/g, "''")}'::regclass, ${payload}::jsonb, ${allowMissing}, ${allowNonEmpty}) AS insertadas;`,
      );
    }
    out.push("");
  }

  if (nonEmpty.length > 0) {
    const tableList = nonEmpty.map((s) => `'${quoteQualified(s.schemaTable).replace(/'/g, "''")}'`).join(", ");
    out.push(`-- Secuencias (serial / identity) al máximo restaurado.`);
    out.push(`DO $seq$`);
    out.push(`DECLARE r record; v_max bigint;`);
    out.push(`BEGIN`);
    out.push(`  FOR r IN`);
    out.push(`    SELECT c.oid::regclass AS tbl, a.attname AS col, pg_catalog.pg_get_serial_sequence(c.oid::regclass::text, a.attname) AS seq`);
    out.push(`    FROM pg_catalog.pg_class c`);
    out.push(`    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped`);
    out.push(`    WHERE c.oid IN (SELECT t::regclass::oid FROM unnest(ARRAY[${tableList}]::text[]) AS t)`);
    out.push(`  LOOP`);
    out.push(`    CONTINUE WHEN r.seq IS NULL;`);
    out.push(`    EXECUTE format('SELECT max(%I) FROM %s', r.col, r.tbl) INTO v_max;`);
    out.push(`    IF v_max IS NOT NULL THEN PERFORM pg_catalog.setval(r.seq, v_max, true); END IF;`);
    out.push(`  END LOOP;`);
    out.push(`END`);
    out.push(`$seq$;`);
    out.push("");
  }

  if (opts.sections.length > 0) {
    out.push(`-- Verificación: counts contra el backup. Si no cuadra, ROLLBACK de todo.`);
    out.push(`DO $check$`);
    out.push(`DECLARE v_n bigint;`);
    out.push(`BEGIN`);
    for (const s of opts.sections) {
      const q = quoteQualified(s.schemaTable).replace(/'/g, "''");
      const op = allowNonEmpty ? "<" : "<>";
      out.push(`  EXECUTE 'SELECT count(*) FROM ${q}' INTO v_n;`);
      out.push(
        `  IF v_n ${op} ${s.rows.length} THEN RAISE EXCEPTION 'restore: ${s.schemaTable.replace(/'/g, "''")} quedó con % filas, el backup trae ${s.rows.length}', v_n; END IF;`,
      );
    }
    out.push(`END`);
    out.push(`$check$;`);
    out.push("");
  }

  out.push("COMMIT;");
  out.push("");
  return out.join("\n");
}
