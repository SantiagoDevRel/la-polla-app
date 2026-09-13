#!/usr/bin/env node
// ops/backup/record-run.mjs — registra una corrida en public.backup_runs (migración 117).
//
// Lo llaman los traps de run-backup.sh y verify-snapshots.sh (vía record_run
// de lib.sh) al terminar, bien o mal. El cron /api/cron/backup-freshness lee
// esas filas y avisa por correo si el backup se atrasa: si el DGX muere, la
// falta de filas nuevas es la alerta.
//
//   node ops/backup/record-run.mjs --kind=backup --exit-code=0 \
//     --started-at=2026-09-13T17:10:00Z --snapshot=2026-09-13-17-10.tar.zst.gpg \
//     --bytes=15000000 --tables=58 --rows=40452 --auth-users=297 \
//     --storage-objects=119 --runner-commit=e88580a1b2c3 [--error="texto"]
//
// Siempre --opción=valor: parseArgs rechaza un valor separado por espacio que
// empiece con "-".
//
// Credenciales SOLO por entorno (ya exportadas por load_env_file):
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Nunca por argv.
// RECORD_RUN_DRY=1 → no envía nada: imprime el JSON que mandaría en stderr.
//
// Contrato: SIEMPRE sale con 0 e imprime en stdout UNA palabra para
// status/*.json: ok · dry_run · skipped_no_credentials · failed_invalid_url ·
// failed_invalid_args · failed_http_<status>[_<código PostgREST>] · failed_network.
// Nunca imprime la llave ni el cuerpo de la respuesta.
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const KINDS = new Set(["backup", "verify", "drill"]);
const SNAPSHOT_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{2}\.tar\.zst\.gpg$/;
const COMMIT_RE = /^([0-9a-f]{7,40}|unknown)$/;
const INT32_MAX = 2147483647;
const ERROR_MAX_CHARS = 400;
const TIMEOUT_MS = 10_000;

function intOrNull(value, max = Number.MAX_SAFE_INTEGER) {
  if (typeof value !== "string" || !/^[0-9]{1,16}$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n <= max ? n : null;
}

/** Arma la fila. Devuelve null si faltan kind o exit-code válidos. */
export function buildPayload(values, now = new Date()) {
  const kind = values.kind;
  const exitCode = intOrNull(values["exit-code"], 255);
  if (!KINDS.has(kind) || exitCode === null) return null;

  const finishedAt = now.toISOString();
  const startedMs = Date.parse(values["started-at"] ?? "");
  const startedAt =
    Number.isFinite(startedMs) && startedMs <= now.getTime() ? new Date(startedMs).toISOString() : finishedAt;
  const status = exitCode === 0 ? "ok" : "failed";

  let error = null;
  if (status === "failed") {
    // Sin caracteres de control y cortado por code points (nunca a mitad de un
    // carácter UTF-8). El texto lo arma el script: fases y cifras, sin filas.
    const raw = Array.from(String(values.error ?? ""), (ch) => {
      const c = ch.codePointAt(0);
      return c < 32 || c === 127 ? " " : ch;
    }).join("").replace(/ {2,}/g, " ").trim();
    error = Array.from(raw || `código de salida ${exitCode}`).slice(0, ERROR_MAX_CHARS).join("");
  }

  const snapshot = values.snapshot ?? "";
  const commit = values["runner-commit"] ?? "";
  return {
    kind,
    status,
    started_at: startedAt,
    finished_at: finishedAt,
    snapshot_name: SNAPSHOT_RE.test(snapshot) ? snapshot : null,
    bytes: intOrNull(values.bytes),
    tables: intOrNull(values.tables, INT32_MAX),
    rows: intOrNull(values.rows),
    auth_users: intOrNull(values["auth-users"], INT32_MAX),
    storage_objects: intOrNull(values["storage-objects"], INT32_MAX),
    runner_commit: COMMIT_RE.test(commit) ? commit : "unknown",
    error,
  };
}

/** https obligatorio; http solo hacia la máquina local (Supabase local de pruebas). */
export function restEndpoint(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    return null;
  }
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  if (url.username || url.password) return null;
  return new URL("/rest/v1/backup_runs", url.origin).toString();
}

async function postOnce(endpoint, key, body) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.ok) return { ok: true, status: res.status };
  let code = "";
  try {
    const parsed = JSON.parse(await res.text());
    if (typeof parsed?.code === "string" && /^[A-Z0-9]{3,10}$/.test(parsed.code)) code = parsed.code;
  } catch {
    // cuerpo no JSON: solo el status
  }
  return { ok: false, status: res.status, code };
}

export async function recordRun(values, env = process.env) {
  const payload = buildPayload(values);
  if (!payload) return "failed_invalid_args";
  const body = JSON.stringify(payload);

  if (env.RECORD_RUN_DRY === "1") {
    process.stderr.write(`${body}\n`);
    return "dry_run";
  }
  const baseUrl = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!baseUrl || !key) return "skipped_no_credentials";
  const endpoint = restEndpoint(baseUrl);
  if (!endpoint) return "failed_invalid_url";

  // Un reintento, solo ante red caída o 5xx. Un duplicado no hace daño: la
  // alerta mira la última fila buena.
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const r = await postOnce(endpoint, key, body);
      if (r.ok) return "ok";
      if (r.status < 500 || attempt === 2) return `failed_http_${r.status}${r.code ? `_${r.code}` : ""}`;
    } catch {
      if (attempt === 2) return "failed_network";
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return "failed_network";
}

async function main() {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        kind: { type: "string" },
        "exit-code": { type: "string" },
        "started-at": { type: "string" },
        snapshot: { type: "string" },
        bytes: { type: "string" },
        tables: { type: "string" },
        rows: { type: "string" },
        "auth-users": { type: "string" },
        "storage-objects": { type: "string" },
        "runner-commit": { type: "string" },
        error: { type: "string" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    process.stdout.write("failed_invalid_args\n");
    return;
  }
  let result;
  try {
    result = await recordRun(values);
  } catch {
    result = "failed_network";
  }
  process.stdout.write(`${result}\n`);
}

function invokedDirectly() {
  // realpath: node resuelve symlinks del módulo principal, argv[1] no.
  try {
    return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  main().finally(() => {
    process.exitCode = 0;
  });
}
