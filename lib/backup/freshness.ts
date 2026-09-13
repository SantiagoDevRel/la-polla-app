// lib/backup/freshness.ts — reglas de la alerta de backup atrasado.
//
// La usa app/api/cron/backup-freshness/route.ts. Lógica pura (sin DB ni red)
// para poder probarla sola. Las filas vienen de public.backup_runs
// (migración 117), que llenan ops/backup/run-backup.sh y verify-snapshots.sh.
//
// Nada de datos personales: la tabla solo tiene conteos, nombres de snapshot,
// commit del runner y el motivo de fallo que arma el propio script.
import { formatColombiaDateTime } from "@/lib/time/colombia";

/** Columnas explícitas de backup_runs (nunca select("*")). */
export const BACKUP_RUN_COLUMNS =
  "kind, status, started_at, finished_at, snapshot_name, bytes, tables, rows, auth_users, storage_objects, runner_commit, error";

export type BackupRunKind = "backup" | "verify" | "drill";

export interface BackupRunRow {
  kind: BackupRunKind;
  status: "ok" | "failed";
  started_at: string;
  finished_at: string;
  snapshot_name: string | null;
  bytes: number | null;
  tables: number | null;
  rows: number | null;
  auth_users: number | null;
  storage_objects: number | null;
  runner_commit: string | null;
  error: string | null;
}

/** El backup corre cada 6 h (00:10/06:10/12:10/18:10 Bogotá): 7 h da una hora de margen. */
export const DEFAULT_BACKUP_MAX_AGE_HOURS = 7;
/** La verificación corre una vez al día (03:40 Bogotá): 30 h da seis de margen. */
export const DEFAULT_VERIFY_MAX_AGE_HOURS = 30;
const MAX_CONFIGURABLE_HOURS = 24 * 30;

/** Umbral desde el entorno: número positivo razonable o el valor por defecto. */
export function parseMaxAgeHours(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= MAX_CONFIGURABLE_HOURS ? n : fallback;
}

/** Horas desde `iso` con un decimal. null si no hay fecha válida; un reloj adelantado cuenta como 0. */
export function ageHours(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return Math.round((Math.max(0, now.getTime() - ms) / 3_600_000) * 10) / 10;
}

export interface FreshnessCheck {
  /** Última corrida buena de ese tipo, o null si nunca hubo. */
  lastOk: BackupRunRow | null;
  /** Última corrida de ese tipo (buena o no), para dar contexto. */
  lastAttempt: BackupRunRow | null;
  maxAgeHours: number;
  ageHours: number | null;
  stale: boolean;
}

export function evaluateFreshness(
  lastOk: BackupRunRow | null,
  lastAttempt: BackupRunRow | null,
  maxAgeHours: number,
  now: Date,
): FreshnessCheck {
  const age = ageHours(lastOk?.finished_at, now);
  return {
    lastOk,
    lastAttempt,
    maxAgeHours,
    ageHours: age,
    stale: age === null || age > maxAgeHours,
  };
}

function when(iso: string): string {
  return `${formatColombiaDateTime(iso, { dateStyle: "medium", timeStyle: "short" })} (hora Colombia)`;
}

function hours(n: number): string {
  return `${n.toLocaleString("es-CO", { maximumFractionDigits: 1 })} h`;
}

function section(title: string, check: FreshnessCheck): string[] {
  const lines = [`${title}: ${check.stale ? "ATRASADO" : "al día"}`];
  if (check.lastOk && check.ageHours !== null) {
    const snapshot = check.lastOk.snapshot_name ? ` · ${check.lastOk.snapshot_name}` : "";
    lines.push(`  Última corrida buena: ${when(check.lastOk.finished_at)}, hace ${hours(check.ageHours)}${snapshot}.`);
  } else {
    lines.push("  No hay ninguna corrida buena registrada.");
  }
  lines.push(`  Máximo permitido: ${hours(check.maxAgeHours)}.`);
  const attempt = check.lastAttempt;
  if (attempt && attempt.status === "failed") {
    const reason = attempt.error ? `: ${attempt.error}` : "";
    lines.push(`  Último intento: falló el ${when(attempt.finished_at)}${reason}`);
  } else if (!attempt) {
    lines.push("  No hay intentos registrados: el runner no está escribiendo en backup_runs.");
  }
  return lines;
}

/** Correo en español neutro, sin emojis ni datos personales. */
export function buildBackupAlertEmail(backup: FreshnessCheck, verify: FreshnessCheck) {
  const lines = [
    "El backup automático de La Polla necesita revisión.",
    "",
    ...section("Backup cifrado (cada 6 h en el DGX)", backup),
    "",
    ...section("Verificación de snapshots (una vez al día)", verify),
    "",
    "Qué revisar en el DGX:",
    "  systemctl --user --failed",
    "  journalctl --user -u la-polla-backup -n 50",
    "  cat ~/apps/la-polla-backup/status/backup-last.json",
    "",
    "Si el DGX no responde, no hay backups nuevos: enciéndelo o saca una copia manual",
    "desde el PC con `npx tsx scripts/export-backup.ts`.",
    "",
    "Esta alerta se repite cada hora mientras siga atrasado. Guía: ops/backup/README.md",
  ];
  return { subject: "Backup de La Polla atrasado", text: lines.join("\n") };
}
