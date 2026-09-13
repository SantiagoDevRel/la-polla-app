// app/api/cron/backup-freshness/route.ts — alerta de backup atrasado.
//
// El backup cifrado corre en el DGX y registra cada corrida en
// public.backup_runs (migración 117). Si el DGX se apaga, pierde la red o el
// runner se rompe, deja de escribir: esta ruta lo nota por la AUSENCIA de
// filas buenas recientes, así que avisa aunque el DGX y el PC estén apagados.
//
// Auth: Authorization: Bearer ${CRON_SECRET} vía requireCronSecret, ANTES de
// crear el admin client (el middleware exime /api/cron/ del gate de sesión).
// Trigger: .github/workflows/backup-freshness.yml, cada hora.
//
// Reglas:
//   · backup  (kind=backup, status=ok): más de BACKUP_MAX_AGE_HOURS (7) → atrasado
//   · verify  (kind=verify, status=ok): más de BACKUP_VERIFY_MAX_AGE_HOURS (30) → atrasado
//   · sin filas buenas → atrasado
// Si alguna está atrasada, un correo a ADMIN_ALERT_EMAIL (o FEEDBACK_NOTIFY_EMAIL)
// con asunto "Backup de La Polla atrasado". Resend rechaza → 502, así el
// workflow falla en vez de confirmar un aviso que no salió.
//
// El body de la respuesta va al log PÚBLICO de Actions: solo booleanos y horas.

import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { requireCronSecret } from "@/lib/auth/cron-secret";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  BACKUP_RUN_COLUMNS,
  DEFAULT_BACKUP_MAX_AGE_HOURS,
  DEFAULT_VERIFY_MAX_AGE_HOURS,
  buildBackupAlertEmail,
  evaluateFreshness,
  parseMaxAgeHours,
  type BackupRunKind,
  type BackupRunRow,
} from "@/lib/backup/freshness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

type AdminClient = ReturnType<typeof createAdminClient>;

async function latestRun(admin: AdminClient, kind: BackupRunKind, onlyOk: boolean) {
  let query = admin.from("backup_runs").select(BACKUP_RUN_COLUMNS).eq("kind", kind);
  if (onlyOk) query = query.eq("status", "ok");
  const { data, error } = await query
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { row: (data as BackupRunRow | null) ?? null, error };
}

export async function POST(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  // Una alerta sin a quién avisar es una alerta rota: se falla aunque todo esté al día.
  const to = process.env.ADMIN_ALERT_EMAIL?.trim() || process.env.FEEDBACK_NOTIFY_EMAIL?.trim();
  if (!to) {
    return NextResponse.json({ error: "alert email not configured" }, { status: 500, headers: NO_STORE });
  }
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: "RESEND_API_KEY not configured" }, { status: 500, headers: NO_STORE });
  }

  const backupMax = parseMaxAgeHours(process.env.BACKUP_MAX_AGE_HOURS, DEFAULT_BACKUP_MAX_AGE_HOURS);
  const verifyMax = parseMaxAgeHours(process.env.BACKUP_VERIFY_MAX_AGE_HOURS, DEFAULT_VERIFY_MAX_AGE_HOURS);

  const admin = createAdminClient();
  const [backupOk, backupLast, verifyOk, verifyLast] = await Promise.all([
    latestRun(admin, "backup", true),
    latestRun(admin, "backup", false),
    latestRun(admin, "verify", true),
    latestRun(admin, "verify", false),
  ]);
  const queryError = [backupOk, backupLast, verifyOk, verifyLast].find((r) => r.error)?.error;
  if (queryError) {
    // Sin detalle en el body (log público). Típico: la migración 117 no está aplicada.
    console.error("[cron/backup-freshness] no pude leer backup_runs:", queryError.code ?? "sin código");
    return NextResponse.json({ error: "backup_runs query failed" }, { status: 500, headers: NO_STORE });
  }

  const now = new Date();
  const backup = evaluateFreshness(backupOk.row, backupLast.row, backupMax, now);
  const verify = evaluateFreshness(verifyOk.row, verifyLast.row, verifyMax, now);
  const summary = {
    ok: true as const,
    stale: backup.stale,
    age_hours: backup.ageHours,
    verify_stale: verify.stale,
    verify_age_hours: verify.ageHours,
  };

  if (!backup.stale && !verify.stale) {
    return NextResponse.json({ ...summary, sent: false }, { headers: NO_STORE });
  }

  const { subject, text } = buildBackupAlertEmail(backup, verify);
  const from = process.env.RESEND_FROM_EMAIL || "La Polla <onboarding@resend.dev>";
  // resend 6.x no lanza: devuelve { data: null, error }.
  const { error } = await new Resend(apiKey).emails.send({ from, to, subject, text });
  if (error) {
    console.error(
      "[cron/backup-freshness] Resend rechazó el envío:",
      error.name,
      error.statusCode ?? "sin status",
    );
    return NextResponse.json({ error: "email send failed" }, { status: 502, headers: NO_STORE });
  }

  return NextResponse.json({ ...summary, sent: true }, { headers: NO_STORE });
}
