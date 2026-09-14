// lib/casa/match-issue-notifications.ts — correo al administrador por cada
// caso nuevo de /admin/issues (migración 121).
//
// Cola en la base: `casa_claim_match_issue_notifications` reserva hasta 10 casos
// abiertos sin avisar (FOR UPDATE SKIP LOCKED, un token por reserva) y
// `casa_finish_match_issue_notification` la cierra como enviada, fallida
// (backoff exponencial, máximo 8 intentos) o liberada (se acabó el tiempo del
// cron antes de enviar). Lo llama /api/matches/sync-live cada minuto.
//
// Sin configuración (RESEND_API_KEY o destinatario) no se reserva nada: así no
// se gastan intentos mientras falten las variables. Nunca se registran
// direcciones, teléfonos ni mensajes del proveedor.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getTournamentName } from "@/lib/tournaments";
import { formatColombiaDateTime } from "@/lib/time/colombia";
import { describeMatchIssue, formatIssueKickoff, matchIssueKindLabel, type MatchIssueKind } from "@/lib/casa/match-issue-kinds";
import type { CasaIssueEmail, CasaIssueEmailResult } from "@/lib/email/casa-issues";

export const ISSUES_URL = "https://lapollacolombiana.com/admin/issues";
const CLAIM_LIMIT = 10;
/** Resend permite pocas solicitudes por segundo: los envíos van en serie y espaciados. */
const SEND_SPACING_MS = 600;

export interface MatchIssueNotificationClaim {
  issue_id: string;
  claim_token: string;
  kind: string;
  observed_elapsed: number | null;
  first_seen_at: string;
  match_id: string;
  home_team: string | null;
  away_team: string | null;
  tournament: string | null;
  scheduled_at: string | null;
  scheduled_at_confirmed: boolean | null;
  polla_names: string[] | null;
}

/** Texto plano de una línea: sin saltos ni caracteres de control. */
function oneLine(value: string | null | undefined, fallback: string): string {
  const spaced = Array.from(value ?? "", (char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 32 || code === 127 ? " " : char;
  }).join("");
  const clean = spaced.split(" ").filter(Boolean).join(" ");
  return clean || fallback;
}

const DETECTED_OPTIONS: Intl.DateTimeFormatOptions = {
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
};

export function buildMatchIssueEmail(claim: MatchIssueNotificationClaim): { subject: string; text: string } {
  const home = oneLine(claim.home_team, "Equipo local");
  const away = oneLine(claim.away_team, "Equipo visitante");
  const label = matchIssueKindLabel(claim.kind);
  const summary = describeMatchIssue(claim.kind as MatchIssueKind, claim.observed_elapsed);
  const pollas = (claim.polla_names ?? []).map((name) => oneLine(name, "")).filter(Boolean);

  const lines = [
    "Hay un partido con novedades en una polla activa de La Polla.",
    "",
    `Partido: ${home} vs ${away}`,
  ];
  if (claim.tournament) lines.push(`Torneo: ${oneLine(getTournamentName(claim.tournament), claim.tournament)}`);
  lines.push(`Tipo: ${label}`);
  if (summary !== label) lines.push(`Qué pasó: ${summary}`);
  if (claim.kind === "sin_datos") {
    lines.push("Qué pasó: pasó la hora de inicio y el proveedor no ha enviado datos de este partido.");
  }
  lines.push(`Inicio: ${claim.scheduled_at ? formatIssueKickoff(claim.scheduled_at, claim.scheduled_at_confirmed) : "sin fecha registrada"}`);
  lines.push(`Detectado: ${formatColombiaDateTime(claim.first_seen_at, DETECTED_OPTIONS)} (hora de Colombia)`);
  lines.push("");
  if (pollas.length === 0) {
    lines.push("Pollas afectadas: ninguna polla activa en este momento.");
  } else {
    lines.push(pollas.length === 1 ? "Polla afectada:" : `Pollas afectadas (${pollas.length}):`);
    for (const name of pollas) lines.push(`- ${name}`);
  }
  lines.push("");
  lines.push(claim.kind === "sin_datos"
    ? "Puedes poner el resultado de los 90 minutos, anular el partido o esperar los datos. Si llegan, el caso se cierra solo."
    : "Decide si el partido se anula (0 puntos para todos) o se mantiene. Mientras el caso esté abierto, esas pollas no se pueden repartir.");
  lines.push(`Revísalo en: ${ISSUES_URL}`);

  return {
    subject: `Issue en La Polla: ${home} vs ${away} (${label})`,
    text: lines.join("\n"),
  };
}

export interface NotifyMatchIssuesDeps {
  db: Pick<SupabaseClient, "rpc">;
  send: (email: CasaIssueEmail) => Promise<CasaIssueEmailResult>;
  recipients: string[];
  configured: boolean;
  /** Epoch ms a partir del cual ya no se envía: las reservas pendientes se liberan. */
  deadline: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface NotifyMatchIssuesResult {
  skipped?: "not_configured" | "claim_failed";
  claimed: number;
  sent: number;
  failed: number;
  released: number;
}

function logCode(error: { code?: string } | null | undefined): string {
  return (error?.code ?? "unknown").replace(/[^A-Za-z0-9_]/g, "").slice(0, 16) || "unknown";
}

export async function notifyMatchIssues(deps: NotifyMatchIssuesDeps): Promise<NotifyMatchIssuesResult> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const result: NotifyMatchIssuesResult = { claimed: 0, sent: 0, failed: 0, released: 0 };
  if (!deps.configured || deps.recipients.length === 0) return { ...result, skipped: "not_configured" };
  if (now() >= deps.deadline) return result;

  const claim = await deps.db.rpc("casa_claim_match_issue_notifications", { p_limit: CLAIM_LIMIT });
  if (claim.error) {
    console.error(`[casa/issue-email] claim failed code=${logCode(claim.error)}`);
    return { ...result, skipped: "claim_failed" };
  }
  const claims = (Array.isArray(claim.data) ? claim.data : []) as MatchIssueNotificationClaim[];
  result.claimed = claims.length;

  const finish = async (item: MatchIssueNotificationClaim, outcome: "sent" | "failed" | "released", errorCode?: string) => {
    const { error } = await deps.db.rpc("casa_finish_match_issue_notification", {
      p_issue: item.issue_id,
      p_claim_token: item.claim_token,
      p_outcome: outcome,
      p_error: errorCode ?? null,
    });
    if (error) console.error(`[casa/issue-email] finish ${outcome} failed code=${logCode(error)}`);
  };

  for (let index = 0; index < claims.length; index += 1) {
    const item = claims[index];
    if (now() >= deps.deadline) {
      await finish(item, "released");
      result.released += 1;
      continue;
    }
    if (index > 0) await sleep(SEND_SPACING_MS);
    const email = buildMatchIssueEmail(item);
    const sent = await deps.send({ to: deps.recipients, ...email });
    if (sent.ok) {
      await finish(item, "sent");
      result.sent += 1;
    } else {
      console.error(`[casa/issue-email] send failed code=${sent.errorCode}`);
      await finish(item, "failed", sent.errorCode);
      result.failed += 1;
    }
  }
  return result;
}
