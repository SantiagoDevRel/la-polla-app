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
export type CasaPrizeKind = "pozo" | "objeto";
export type CasaCloseMode = "auto" | "manual";
export type CasaPotMode = "proporcional" | "fijo";
export type CasaPublicationMode = "ahora" | "programada" | "oculta";

/** Margen antes del pitazo. UN solo numero para todo el repo. */
export const LOCK_MINUTES = 5;

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

  /**
   * Que ES el premio (migracion 089).
   *   "pozo"   -> plata: el 70% recaudado. La UI muestra la cifra VIVA que
   *               devuelve casa_polla_pot, no un texto escrito a mano.
   *   "objeto" -> una cosa. Ahi manda prize_object y la foto opcional.
   */
  prize_kind: CasaPrizeKind;
  pot_mode?: CasaPotMode;
  fixed_prize_cop?: number | null;
  publication_mode?: CasaPublicationMode;
  prize_object: string | null;
  /** Ruta en el bucket publico `prize-images`. Solo para prize_kind objeto. */
  prize_image_path: string | null;

  points_exact: number;
  points_one_team: number;
  points_result: number;

  status: CasaPollaStatus;
  draw_pending?: boolean;
  opens_at: string;
  closes_at: string;
  /**
   * Como se calculo `closes_at` (migracion 089). No lo lee la logica de
   * apertura — para eso esta closes_at — pero deja explicar en la UI por que
   * cierra a esa hora, y permitiria recalcularlo si se reprograma un partido.
   */
  close_mode: CasaCloseMode;

  ticket_count: number | null;
  draw_method: string | null;
  drawn_number: number | null;

  settled_at: string | null;
  settle_notes: string | null;
  settlement_outcome?: "money_awarded" | "object_awarded" | "house_retained_zero_points" | null;

  /** A dónde transfiere la gente. Sin esto la polla no se puede pagar. */
  payout_method: string | null;
  payout_account: string | null;
  payout_account_name: string | null;
  /** Participaciones que una persona puede tener en esta polla (migración 131). */
  max_entries_per_user?: number;
  /**
   * Invitaciones (migración 135): cada cuántos invitados nuevos con pago
   * aprobado hay un cupo de regalo. NULL = la polla no participa. Para saber si
   * aplica, usar referralEvery() (rifas y entradas gratis nunca participan).
   */
  referral_every?: number | null;
  created_by: string;
  created_at: string;
}

export interface CasaPot {
  paid_entries: number;
  gross_cop: number;
  prize_cop: number;
  house_cop: number;
  entry_prize_cop?: number;
  entry_house_cop?: number;
  projected_prize_cop?: number;
}

/** Minimal personal-list payload: no payment accounts, proofs or user IDs. */
export interface MyCasaPolla extends Pick<CasaPolla, "id" | "slug" | "name" | "kind" | "tournament" | "status" | "closes_at"> {
  entry_status: "pendiente" | "pagada";
  tournaments: string[];
  /**
   * Pozo vivo, calculado en SQL (casa_pot_summaries_v2). La lista lo muestra
   * porque es lo único que se compara entre pollas; `undefined` si no se pudo
   * leer, y entonces la tarjeta sale sin esa fila en vez de mentir con un 0.
   */
  prize_cop?: number;
  /**
   * Participaciones vivas (pagada o en revisión) en polla de partidos/preguntas,
   * ordenadas por número. Vacío en rifas: ahí manda la boleta.
   */
  entries: Array<{
    number: number;
    status: "pendiente" | "pagada";
    /** Partidos todavía pronosticables sin pronóstico. */
    pending?: number;
    /** Cupo de regalo por invitar (migración 135). */
    gift?: boolean;
  }>;
}

export interface CasaEntry {
  id: string;
  polla_id: string;
  user_id: string;
  status: CasaEntryStatus;
  amount_cop: number;
  proof_path: string | null;
  current_proof_attempt_id?: string | null;
  proof_uploaded_at: string | null;
  reviewed_at: string | null;
  reject_reason: string | null;
  ticket_number: number | null;
  /** 1, 2, 3… en pollas de partidos/preguntas; null en rifas (migración 131). */
  entry_number?: number | null;
  /**
   * `compra` (transferencia + comprobante) o `invitacion` (cupo de regalo por
   * invitar, sin comprobante ni monto; migración 135).
   */
  origin?: "compra" | "invitacion";
  created_at: string;
}

/** Quien invitó, tal como se muestra (sin ids internos). */
export interface ReferralPerson {
  name: string | null;
  avatar: string | null;
  code: string | null;
}

/** casa_referral_polla_view_v1: la polla vista por una persona. */
export interface ReferralPollaView {
  code: string | null;
  /** null = esta polla no tiene invitaciones. */
  every: number | null;
  /** Invitados que cuentan aquí con un cupo pagado aquí. */
  counted: number;
  /** Invitados con comprobante en revisión aquí (todavía no cuentan). */
  in_review: number;
  earned: number;
  /** Ganados que valen: sin los que el administrador removió. */
  gifts: number;
  /** Ganados que todavía no están activos (falta tu pago o espacio). */
  waiting_gifts: number;
  active_gifts: number;
  removed_gifts: number;
  owner_paid: boolean;
  slots_left: number;
  referrer: ReferralPerson | null;
  referrer_locked: boolean;
  can_set_referrer: boolean;
}

/** casa_referral_invitee_v1: quién invitó a esta persona y qué ofrece el enlace. */
export interface ReferralInviteeState {
  can_set_referrer: boolean;
  referrer: ReferralPerson | null;
  referrer_locked: boolean;
  /** Invitador del enlace abierto, si todavía se puede elegir y es otro. */
  hint: ReferralPerson | null;
}

/** casa_referral_profile_v1 */
export interface ReferralProfile {
  code: string | null;
  invited: number;
  counted: number;
  gifts: number;
  referrer: ReferralPerson | null;
  referrer_locked: boolean;
  can_set_referrer: boolean;
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
  /** Número de la participación (migración 131). */
  entry_number?: number | null;
  /** Cuántas participaciones aprobadas tiene esa persona en la polla. */
  user_entries?: number;
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
  id?: string;
  prize_kind?: CasaPrizeKind;
  prize_object?: string | null;
  delivered_at?: string | null;
  user_id: string;
  place: number;
  points: number | null;
  amount_cop: number;
  paid_at: string | null;
  /**
   * Prueba de pago (migración 133): pantallazo de la transferencia en el
   * bucket privado `payout-proofs`. Nunca es una URL pública: se firma en el
   * servidor y se muestra al ganador y a los participantes de la polla.
   */
  proof_path?: string | null;
  proof_uploaded_at?: string | null;
  paid_reference?: string | null;
  /** Nota del reparto («Empate en 6 puntos · 2 participaciones ganadoras»). */
  note?: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

/**
 * ¿La polla ya se puede repartir? (migración 134). Mismas condiciones que
 * casa_settle_polla_v2: todos los partidos (o preguntas) cerrados, sin casos
 * abiertos, sin comprobantes por revisar, con inscripciones pagadas y cerrada.
 */
export interface CasaSettlementReadiness {
  pollaId: string;
  totalItems: number;
  doneItems: number;
  openIssues: number;
  pendingProofs: number;
  paidEntries: number;
  inscriptionsClosed: boolean;
  ready: boolean;
}

/** Reparto por persona que haría hoy casa_settle_polla_v2 (migración 134). */
export interface CasaProvisionalPayout {
  user_id: string;
  amount_cop: number;
  winning_entries: number;
}

/** En qué punto está el pago de una polla, visto desde el panel. */
export type AdminPayoutStage = "en_curso" | "lista" | "repartida" | "sin_ganador" | "no_aplica";

/** Un premio en dinero visto desde el panel del administrador: a quién, cuánto, a qué cuenta y si ya se pagó. */
export interface AdminPayoutRow {
  id: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  amountCop: number;
  points: number | null;
  note: string | null;
  paidAt: string | null;
  paidReference: string | null;
  /** URL firmada (1 h) del comprobante, o null si todavía no se pagó. */
  proofUrl: string | null;
  account: { method: string | null; number: string | null; holder: string | null; type: string | null } | null;
}

/**
 * Lo que se llevaría hoy cada participación que va arriba, si la polla
 * terminara con los marcadores de este momento (migración 133). Sale de
 * `casa_provisional_prizes_v2`, con el mismo redondeo que el reparto real.
 */
export interface CasaProvisionalPrize {
  entry_id: string;
  user_id: string;
  amount_cop: number;
}

/** Un pronóstico de la persona para un partido en vivo, por cupo. */
export interface CasaLiveMatchPick {
  entryNumber: number | null;
  pick1x2: Pick1x2 | null;
  homeScore: number | null;
  awayScore: number | null;
}

/**
 * Partido en juego (o recién terminado) de una polla donde la persona
 * participa: lo que se muestra arriba en POLLAS con «Tu marcador».
 */
export interface CasaLiveMatch {
  matchId: string;
  pollaId: string;
  pollaSlug: string;
  pollaName: string;
  scoringMode: CasaScoringMode;
  homeTeam: string;
  awayTeam: string;
  homeFlag: string | null;
  awayFlag: string | null;
  homeScore: number | null;
  awayScore: number | null;
  /** waiting = ya pasó la hora de inicio y todavía no llegan datos del partido. */
  status: "live" | "finished" | "waiting";
  elapsed: number | null;
  liveStatusDetail: string | null;
  scheduledAt: string;
  finalVerifiedAt: string | null;
  picks: CasaLiveMatchPick[];
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
  "id, slug, name, kind, tournament, scoring_mode, description, entry_price_cop, house_cut_pct, prize_kind, pot_mode, fixed_prize_cop, publication_mode, prize_object, prize_image_path, points_exact, points_one_team, points_result, status, opens_at, closes_at, close_mode, ticket_count, draw_method, drawn_number, settled_at, settle_notes, settlement_outcome, payout_method, payout_account, payout_account_name, max_entries_per_user, referral_every, created_by, created_at" as const;

export const CASA_ENTRY_COLUMNS =
  "id, polla_id, user_id, status, amount_cop, proof_path, current_proof_attempt_id, proof_uploaded_at, reviewed_at, reject_reason, ticket_number, entry_number, origin, created_at" as const;

export const CASA_PICK_COLUMNS =
  "id, entry_id, polla_id, user_id, match_id, question_id, pick_1x2, home_score, away_score, option_id, free_text, points_earned" as const;

/* ── Helpers de dominio ─────────────────────────────────────────────── */

/** Tope por defecto si una lectura vieja no trae la columna (migración 131). */
export const DEFAULT_MAX_ENTRIES_PER_USER = 10;

/** Una participación cuenta como inscripción viva: pagada o con comprobante en revisión. */
export function isLiveEntry(entry: Pick<CasaEntry, "status" | "proof_path"> | null | undefined): boolean {
  return Boolean(entry && (entry.status === "pagada" || (entry.status === "pendiente" && entry.proof_path)));
}

/** Se puede seguir entrando / cambiando pronosticos? */
export function isPollaPublished(polla: Pick<CasaPolla, "status"> & Partial<Pick<CasaPolla, "opens_at" | "publication_mode">>, now = new Date()): boolean {
  return polla.status !== "borrador" && polla.publication_mode !== "oculta" &&
    (!polla.opens_at || new Date(polla.opens_at) <= now);
}

export function isPollaOpen(polla: Pick<CasaPolla, "status" | "closes_at"> & Partial<Pick<CasaPolla, "opens_at" | "publication_mode">>): boolean {
  return isPollaPublished(polla) && polla.status === "abierta" && new Date(polla.closes_at) > new Date();
}

/**
 * (2026-09-17, decisión del dueño) Las pollas cerradas desde el 16-sep-2026
 * (Ofigolazo en adelante, hora de Colombia) son públicas: cualquier usuario con
 * sesión las ve en Pollas cerradas y ve los pronósticos de los partidos ya
 * empezados, aunque no se haya inscrito. Las anteriores siguen siendo solo de
 * sus participantes. Los comprobantes de pago NO entran acá: pueden mostrar la
 * cuenta del ganador.
 */
export const PUBLIC_CLOSED_SINCE = "2026-09-16T00:00:00-05:00";

export function isPublicClosedPolla(polla: Pick<CasaPolla, "status" | "closes_at"> & Partial<Pick<CasaPolla, "opens_at" | "publication_mode">>): boolean {
  return isPollaPublished(polla) && polla.status !== "anulada" && !isPollaOpen(polla)
    && new Date(polla.closes_at) >= new Date(PUBLIC_CLOSED_SINCE);
}

/** Etiqueta corta de estado, en el idioma de la app. */
export function pollaStatusLabel(polla: CasaPolla): {
  text: string;
  tone: "cal" | "red" | "live" | "mute";
} {
  if (polla.status === "resuelta") return { text: "Resuelta", tone: "mute" };
  if (polla.status === "anulada") return { text: "Anulada", tone: "red" };
  if (polla.status === "borrador" || polla.publication_mode === "oculta") return { text: "Oculta", tone: "mute" };
  if (new Date(polla.opens_at) > new Date()) return { text: "Programada", tone: "mute" };
  if (polla.draw_pending) return { text: "Desempate pendiente", tone: "red" };
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
