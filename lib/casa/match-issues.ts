import "server-only";

// lib/casa/match-issues.ts — lectura server-side de los casos de partidos
// suspendidos, aplazados, cancelados o abandonados en pollas Casa, y de los
// que pasaron su hora de inicio sin datos del proveedor (sin_datos, 121).
//
// Nada se anula solo: la base registra el caso en `casa_match_issues` y el
// administrador decide en /admin/issues (RPC `casa_decide_match_issue`). Este
// módulo lee con columnas enumeradas y lecturas por lote (.in()). La única
// escritura es el barrido `casa_sweep_match_issues` antes de listar, que
// recupera casos que un trigger no pudo registrar.
// Las fechas visibles salen ya formateadas en hora de Colombia para que el
// HTML del servidor y el del cliente no difieran.

import { createAdminClient } from "@/lib/supabase/admin";
import { getTournamentName } from "@/lib/tournaments";
import { formatColombiaDateTime } from "@/lib/time/colombia";
import { redactText } from "@/lib/log";
import type { CasaPollaStatus } from "@/lib/casa/types";
import {
  describeMatchIssue,
  formatIssueKickoff,
  type MatchIssueDecisionValue,
  type MatchIssueKind,
} from "@/lib/casa/match-issue-kinds";

export { describeMatchIssue, type MatchIssueDecisionValue, type MatchIssueKind };

const ISSUE_COLUMNS =
  "id, match_id, kind, observed_status, observed_detail, observed_elapsed, first_seen_at, last_seen_at, decision, decided_by, decided_at, note" as const;
const ISSUE_MATCH_COLUMNS =
  "id, home_team, away_team, tournament, scheduled_at, scheduled_at_confirmed, status, live_status_detail, elapsed, home_score, away_score, final_verified_at" as const;

/** Tope defensivo: los casos abiertos son pocos y PostgREST corta en 1000 filas. */
const OPEN_LIMIT = 200;
const DECIDED_LIMIT = 20;

interface IssueRow {
  id: string;
  match_id: string;
  kind: MatchIssueKind;
  observed_status: string | null;
  observed_detail: string | null;
  observed_elapsed: number | null;
  first_seen_at: string;
  last_seen_at: string;
  decision: MatchIssueDecisionValue | null;
  decided_by: string | null;
  decided_at: string | null;
  note: string | null;
}

interface MatchRow {
  id: string;
  home_team: string;
  away_team: string;
  tournament: string | null;
  scheduled_at: string | null;
  scheduled_at_confirmed?: boolean | null;
  status: string | null;
  live_status_detail: string | null;
  elapsed: number | null;
  home_score: number | null;
  away_score: number | null;
  final_verified_at: string | null;
}

export interface MatchIssuePolla {
  id: string;
  name: string;
  slug: string;
  status: CasaPollaStatus;
  statusLabel: string;
  /** Solo las pollas publicadas tienen una página que abrir. */
  linkable: boolean;
  voided: boolean;
}

export interface MatchIssueView {
  id: string;
  matchId: string;
  kind: MatchIssueKind;
  summary: string;
  homeTeam: string;
  awayTeam: string;
  tournamentName: string | null;
  scheduledIso: string | null;
  scheduledLabel: string | null;
  score: string | null;
  currentState: string | null;
  firstSeenIso: string;
  firstSeenLabel: string;
  decision: MatchIssueDecisionValue | null;
  decidedByName: string | null;
  decidedAtIso: string | null;
  decidedAtLabel: string | null;
  note: string | null;
  pollas: MatchIssuePolla[];
}

export type MatchIssuesResult =
  | {
    ok: true;
    /** Abiertos con al menos una polla Casa activa: los que bloquean un reparto. */
    open: MatchIssueView[];
    /** Abiertos cuyas pollas ya terminaron, se anularon o se archivaron. */
    inactive: MatchIssueView[];
    decided: MatchIssueView[];
    openTruncated: boolean;
  }
  | { ok: false };

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
};

export function formatIssueDate(iso: string): string {
  return formatColombiaDateTime(iso, DATE_OPTIONS);
}

const KIND_BY_CODE: Record<string, MatchIssueKind> = {
  STATUS_SUSPENDED: "suspendido", SUSPENDED: "suspendido", SUSP: "suspendido",
  STATUS_INTERRUPTED: "suspendido", INTERRUPTED: "suspendido", INT: "suspendido",
  STATUS_POSTPONED: "aplazado", POSTPONED: "aplazado", PST: "aplazado",
  STATUS_ABANDONED: "abandonado", ABANDONED: "abandonado", ABD: "abandonado",
  STATUS_CANCELED: "cancelado", STATUS_CANCELLED: "cancelado", CANCELED: "cancelado", CANCELLED: "cancelado", CANC: "cancelado",
};

/** Espejo de lectura de la clasificación SQL del contrato (`casa_match_issue_kind`).
 * Solo describe el estado vigente en pantalla; la DB decide qué casos se registran. */
export function classifyMatchIssueKind(status: string | null | undefined, detail: string | null | undefined): MatchIssueKind | null {
  const code = (detail ?? "").trim().toUpperCase();
  const byDetail = KIND_BY_CODE[code];
  if (byDetail) return byDetail;
  return (status ?? "").trim().toUpperCase() === "CANCELLED" && code !== "STATUS_SCHEDULED" ? "cancelado" : null;
}

/** Estado actual del partido global, para decidir con la información vigente. */
export function describeCurrentMatchState(
  match: Pick<MatchRow, "status" | "final_verified_at"> & Partial<Pick<MatchRow, "live_status_detail">>,
  issueKind?: MatchIssueKind,
): string | null {
  const current = match.status === "finished" ? null : classifyMatchIssueKind(match.status, match.live_status_detail);
  if (current) return current === issueKind ? `Estado actual: sigue ${current}` : `Estado actual: ${current}`;
  switch (match.status) {
    case "scheduled":
      return "Estado actual: programado";
    case "live":
      return "Estado actual: en juego";
    case "finished":
      return match.final_verified_at
        ? "Estado actual: finalizado, con resultado verificado"
        : "Estado actual: finalizado, falta verificar el resultado";
    default:
      return null;
  }
}

export function describeDecision(decision: MatchIssueDecisionValue): string {
  switch (decision) {
    case "anular":
      return "Anulado: 0 puntos para todos";
    case "resuelto":
      // El CASO se cerró (llegaron datos, se verificó o se puso el resultado); no
      // quiere decir que el partido haya terminado.
      return "Caso cerrado";
    default:
      return "Partido mantenido";
  }
}

const POLLA_STATUS_LABEL: Record<CasaPollaStatus, string> = {
  borrador: "Oculta",
  abierta: "Abierta",
  cerrada: "Cerrada",
  resuelta: "Resuelta",
  anulada: "Anulada",
};

function scoreLabel(match: MatchRow): string | null {
  return match.home_score === null || match.away_score === null ? null : `${match.home_score} - ${match.away_score}`;
}

async function buildViews(rows: IssueRow[]): Promise<MatchIssueView[] | null> {
  if (rows.length === 0) return [];
  const db = createAdminClient();
  const matchIds = rows.map((row) => row.match_id).filter((id, index, all) => all.indexOf(id) === index);
  const deciderIds = rows
    .map((row) => row.decided_by)
    .filter((id): id is string => Boolean(id))
    .filter((id, index, all) => all.indexOf(id) === index);

  const [matchesResult, linksResult, decidersResult] = await Promise.all([
    db.from("matches").select(ISSUE_MATCH_COLUMNS).in("id", matchIds),
    db.from("casa_polla_matches").select("polla_id, match_id, voided_at").in("match_id", matchIds),
    deciderIds.length
      ? db.from("users").select("id, display_name").in("id", deciderIds)
      : Promise.resolve({ data: [] as { id: string; display_name: string | null }[], error: null }),
  ]);
  if (matchesResult.error || linksResult.error || decidersResult.error) return null;

  const links = (linksResult.data ?? []) as { polla_id: string; match_id: string; voided_at: string | null }[];
  const pollaIds = links.map((link) => link.polla_id).filter((id, index, all) => all.indexOf(id) === index);
  const pollasResult = pollaIds.length
    ? await db.from("casa_pollas").select("id, name, slug, status, archived_at").in("id", pollaIds)
    : { data: [] as { id: string; name: string; slug: string; status: CasaPollaStatus; archived_at: string | null }[], error: null };
  if (pollasResult.error) return null;

  const matches = new Map(((matchesResult.data ?? []) as MatchRow[]).map((match) => [match.id, match]));
  const pollas = new Map(
    ((pollasResult.data ?? []) as { id: string; name: string; slug: string; status: CasaPollaStatus; archived_at: string | null }[])
      .filter((polla) => polla.archived_at === null)
      .map((polla) => [polla.id, polla]),
  );
  const deciders = new Map(((decidersResult.data ?? []) as { id: string; display_name: string | null }[]).map((user) => [user.id, user.display_name]));

  return rows.map((row) => {
    const match = matches.get(row.match_id);
    const affected = links
      .filter((link) => link.match_id === row.match_id && pollas.has(link.polla_id))
      .map((link) => {
        const polla = pollas.get(link.polla_id)!;
        return {
          id: polla.id,
          name: polla.name,
          slug: polla.slug,
          status: polla.status,
          statusLabel: POLLA_STATUS_LABEL[polla.status] ?? polla.status,
          linkable: polla.status !== "borrador",
          voided: link.voided_at !== null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
    return {
      id: row.id,
      matchId: row.match_id,
      kind: row.kind,
      summary: describeMatchIssue(row.kind, row.observed_elapsed ?? match?.elapsed),
      homeTeam: match?.home_team ?? "Equipo local",
      awayTeam: match?.away_team ?? "Equipo visitante",
      tournamentName: match?.tournament ? getTournamentName(match.tournament) : null,
      scheduledIso: match?.scheduled_at ?? null,
      scheduledLabel: match?.scheduled_at ? formatIssueKickoff(match.scheduled_at, match.scheduled_at_confirmed) : null,
      score: match ? scoreLabel(match) : null,
      currentState: match ? describeCurrentMatchState(match, row.kind) : null,
      firstSeenIso: row.first_seen_at,
      firstSeenLabel: formatIssueDate(row.first_seen_at),
      decision: row.decision,
      decidedByName: row.decided_by ? deciders.get(row.decided_by) ?? "Administrador" : null,
      decidedAtIso: row.decided_at,
      decidedAtLabel: row.decided_at ? formatIssueDate(row.decided_at) : null,
      note: row.note,
      pollas: affected,
    };
  });
}

/** Casos abiertos (más antiguos primero) y los últimos 20 decididos.
 * Antes de leer barre los partidos con novedades sin caso (registros perdidos);
 * si el barrido falla se registra en el log y la lectura continúa. */
export async function listMatchIssues(): Promise<MatchIssuesResult> {
  const db = createAdminClient();
  const sweep = await db.rpc("casa_sweep_match_issues");
  if (sweep.error) console.error(`[casa/match-issues] sweep failed code=${sweep.error.code ?? "unknown"}`, redactText(sweep.error.message, 24));

  const [openResult, decidedResult, activeResult] = await Promise.all([
    db.from("casa_match_issues").select(ISSUE_COLUMNS)
      .is("decision", null)
      .order("first_seen_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(OPEN_LIMIT + 1),
    db.from("casa_match_issues").select(ISSUE_COLUMNS)
      .not("decision", "is", null)
      .order("decided_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(DECIDED_LIMIT),
    db.rpc("casa_active_open_match_issue_ids"),
  ]);
  if (openResult.error || decidedResult.error) return { ok: false };
  // Sin la lista de activos no se esconde nada: todos los abiertos quedan por decidir.
  if (activeResult.error) console.error(`[casa/match-issues] active ids failed code=${activeResult.error.code ?? "unknown"}`, redactText(activeResult.error.message, 24));
  const activeIds = activeResult.error
    ? null
    : new Set(((activeResult.data ?? []) as { issue_id: string }[]).map((row) => row.issue_id));

  const openRows = (openResult.data ?? []) as IssueRow[];
  const openTruncated = openRows.length > OPEN_LIMIT;
  const views = await buildViews([...openRows.slice(0, OPEN_LIMIT), ...((decidedResult.data ?? []) as IssueRow[])]);
  if (!views) return { ok: false };
  const openViews = views.filter((view) => view.decision === null);
  const isActive = (view: MatchIssueView) => activeIds === null || activeIds.has(view.id);
  return {
    ok: true,
    open: openViews.filter(isActive),
    inactive: openViews.filter((view) => !isActive(view)),
    decided: views.filter((view) => view.decision !== null),
    openTruncated,
  };
}

/** Conteo para el aviso del panel: solo casos abiertos con al menos una polla
 * Casa activa (la misma definición que bloquea el reparto). Una sola consulta
 * HEAD con conteo exacto. `null` si no se pudo leer. */
export async function countOpenMatchIssues(): Promise<number | null> {
  const { count, error } = await createAdminClient()
    .rpc("casa_active_open_match_issue_ids", {}, { head: true, count: "exact" });
  if (error) return null;
  return count ?? 0;
}
