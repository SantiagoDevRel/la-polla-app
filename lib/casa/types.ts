// lib/casa/types.ts — el modelo de la polla centralizada.
//
// Espejo TS del schema de las migraciones 081/082. Si tocas una, toca la otra:
// el motor de puntaje vive en SQL (fuente de verdad) y aca solo lo describimos.

export type CasaPollaKind = "partidos" | "manual" | "rifa";
export type CasaScoringMode = "1x2" | "marcador";
export type CasaPollaStatus =
  | "borrador"
  | "abierta"
  | "cerrada"
  | "resuelta"
  | "anulada";
export type CasaEntryStatus = "pendiente" | "pagada" | "rechazada" | "anulada";

/** L = local gana · E = empate · V = visitante gana. Las UNICAS 3 opciones. */
export type Pick1x2 = "L" | "E" | "V";

export interface CasaPolla {
  id: string;
  slug: string;
  name: string;
  kind: CasaPollaKind;
  tournament: string | null;
  scoring_mode: CasaScoringMode | null;
  description: string | null;

  entry_price_cop: number;
  house_cut_pct: number;
  prize_object: string | null;

  points_exact: number;
  points_one_team: number;
  points_result: number;

  status: CasaPollaStatus;
  opens_at: string;
  closes_at: string;

  ticket_count: number | null;
  draw_method: string | null;
  drawn_number: number | null;

  settled_at: string | null;
  settle_notes: string | null;

  /** A dónde transfiere la gente. Sin esto la polla no se puede pagar. */
  payout_method: string | null;
  payout_account: string | null;
  payout_account_name: string | null;
  created_by: string;
  created_at: string;
}

export interface CasaPot {
  paid_entries: number;
  gross_cop: number;
  prize_cop: number;
  house_cop: number;
}

export interface CasaEntry {
  id: string;
  polla_id: string;
  user_id: string;
  status: CasaEntryStatus;
  amount_cop: number;
  proof_path: string | null;
  proof_uploaded_at: string | null;
  reviewed_at: string | null;
  reject_reason: string | null;
  ticket_number: number | null;
  created_at: string;
}

export interface CasaPick {
  id: string;
  entry_id: string;
  polla_id: string;
  user_id: string;
  match_id: string | null;
  question_id: string | null;
  pick_1x2: Pick1x2 | null;
  home_score: number | null;
  away_score: number | null;
  option_id: string | null;
  free_text: string | null;
  points_earned: number;
}

export interface CasaQuestion {
  id: string;
  polla_id: string;
  prompt: string;
  order_index: number;
  points: number;
  input_kind: "opciones" | "texto";
  resolved_option_id: string | null;
  resolved_text: string | null;
  resolved_at: string | null;
  options?: CasaOption[];
}

export interface CasaOption {
  id: string;
  question_id: string;
  label: string;
  order_index: number;
}

export interface CasaLeaderboardRow {
  entry_id: string;
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  points: number;
  aciertos: number;
  puesto: number;
}

/**
 * Una fila de casa_payouts: a quien le toco cuanto cuando se repartio.
 *
 * (2026-09-02) La tabla existia desde la migracion 081 y `casa_settle_polla`
 * la escribia, pero NADIE la leia en toda la app: la plata entraba, se
 * puntuaba, se repartia en SQL... y ahi se acababa. El jugador nunca se
 * enteraba de que habia ganado.
 */
export interface CasaPayout {
  user_id: string;
  place: number;
  points: number | null;
  amount_cop: number;
  paid_at: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

/** Lo que devuelve casa_pick_distribution: conteos crudos por clave. */
export interface CasaDistribution {
  resultado: Record<string, { conteo: Record<string, number>; total: number }>;
  marcador: Record<string, { conteo: Record<string, number>; total: number }>;
  preguntas: Record<string, { conteo: Record<string, number>; total: number }>;
}

/* ── Columnas explicitas ────────────────────────────────────────────────
   Regla dura del repo: nunca `select("*")` en tablas con datos de usuario.
   Enumerar evita que una columna sensible futura se filtre sola. */
export const CASA_POLLA_COLUMNS =
  "id, slug, name, kind, tournament, scoring_mode, description, entry_price_cop, house_cut_pct, prize_object, points_exact, points_one_team, points_result, status, opens_at, closes_at, ticket_count, draw_method, drawn_number, settled_at, settle_notes, payout_method, payout_account, payout_account_name, created_by, created_at" as const;

export const CASA_ENTRY_COLUMNS =
  "id, polla_id, user_id, status, amount_cop, proof_path, proof_uploaded_at, reviewed_at, reject_reason, ticket_number, created_at" as const;

export const CASA_PICK_COLUMNS =
  "id, entry_id, polla_id, user_id, match_id, question_id, pick_1x2, home_score, away_score, option_id, free_text, points_earned" as const;

/* ── Helpers de dominio ─────────────────────────────────────────────── */

/** El pozo de una polla = lo recaudado menos lo que se queda la casa. */
export function prizeFromGross(grossCop: number, houseCutPct: number): number {
  return Math.floor((grossCop * (100 - houseCutPct)) / 100);
}

/** Se puede seguir entrando / cambiando pronosticos? */
export function isPollaOpen(polla: Pick<CasaPolla, "status" | "closes_at">): boolean {
  return polla.status === "abierta" && new Date(polla.closes_at) > new Date();
}

/** Etiqueta corta de estado, en el idioma de la app. */
export function pollaStatusLabel(polla: CasaPolla): {
  text: string;
  tone: "cal" | "red" | "live" | "mute";
} {
  if (polla.status === "resuelta") return { text: "Resuelta", tone: "mute" };
  if (polla.status === "anulada") return { text: "Anulada", tone: "red" };
  if (polla.status === "borrador") return { text: "Borrador", tone: "mute" };
  if (polla.status === "cerrada") return { text: "Cerrada", tone: "red" };
  if (new Date(polla.closes_at) <= new Date())
    return { text: "Cerrando", tone: "red" };
  return { text: "Abierta", tone: "cal" };
}

/** Resultado 1X2 real de un partido, a 90 minutos. null si no se verifico. */
export function result1x2(
  homeScore: number | null,
  awayScore: number | null,
  finalVerifiedAt: string | null,
): Pick1x2 | null {
  if (!finalVerifiedAt || homeScore === null || awayScore === null) return null;
  if (homeScore > awayScore) return "L";
  if (homeScore < awayScore) return "V";
  return "E";
}
