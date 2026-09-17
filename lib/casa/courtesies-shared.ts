// lib/casa/courtesies-shared.ts — lo que la UI necesita de las cortesías (migración 136).
//
// Solo formato y lectura. La autoridad es SQL: casa_grant_courtesies_v1 decide
// quién puede dar cortesías y casa_redeem_courtesy_v1 quién puede usarlas (una
// cuenta nueva, una sola vez, en esa polla). Acá no se decide nada.

/** Cookie con el código del enlace que abrió la persona (30 días, solo servidor). */
export const COURTESY_COOKIE = "lp_cortesia";
export const COURTESY_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
/** Parámetro del enlace: /casa/<slug>?cortesia=ABCDEFGHJK */
export const COURTESY_PARAM = "cortesia";

/** Mismo alfabeto que casa_courtesy_new_code: sin 0/O/1/I/L. */
export const COURTESY_CODE_RE = /^[A-HJ-NP-Z2-9]{10}$/;

/** Lo que escribe o pega una persona → forma canónica. Espejo de casa_courtesy_normalize_code. */
export function normalizeCourtesyCode(value: string | null | undefined): string | null {
  if (!value || value.length > 40) return null;
  const code = value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return code || null;
}

/** El código con el formato válido, o null (enlaces y cookie). */
export function validCourtesyCode(value: string | null | undefined): string | null {
  const code = normalizeCourtesyCode(value);
  return code && COURTESY_CODE_RE.test(code) ? code : null;
}

/** El enlace que reparte quien tiene la cortesía. */
export function courtesyLink(origin: string, slug: string, code: string): string {
  return `${origin}/casa/${encodeURIComponent(slug)}?${COURTESY_PARAM}=${encodeURIComponent(code)}`;
}

/** Letra menuda única: una frase, sin lista de condiciones. */
export const COURTESY_FINE_PRINT =
  "*Solo para quien nunca ha tenido cuenta en La Polla, una vez por persona y solo en esta polla.";

/** Mensaje de invitación listo para WhatsApp. */
export function courtesyShareText(polla: string, url: string): string {
  return `Te regalo un cupo gratis en ${polla}. Abre el enlace, crea tu cuenta y quedas dentro:\n${url}`;
}

/** Lo que devuelve casa_redeem_courtesy_v1 cuando no se pudo. */
const COURTESY_ERRORS: Record<string, string> = {
  COURTESY_NOT_FOUND: "Ese enlace de cortesía no existe. Pídele a quien te invitó que te lo mande otra vez.",
  COURTESY_USED: "Alguien más ya usó esa cortesía.",
  COURTESY_MINE: "Ya usaste esta cortesía: tu cupo está en la polla.",
  COURTESY_REVOKED: "Esa cortesía ya no está disponible.",
  COURTESY_SELF: "Esta cortesía es para que la regales, no para ti.",
  COURTESY_EXPIRED: "Esta polla ya cerró sus inscripciones, así que la cortesía venció.",
  COURTESY_ALREADY_REDEEMED: "Ya usaste una cortesía antes. Es una sola por persona.",
  NOT_NEW_USER: "Las cortesías son para quien entra por primera vez a La Polla.",
};

export function courtesyErrorMessage(code: string | null | undefined): string {
  return COURTESY_ERRORS[code ?? ""] ?? "No pudimos activar la cortesía. Intenta de nuevo.";
}

/**
 * ¿Este cupo entró con una cortesía? Es la forma que garantiza
 * casa_redeem_courtesy_v1 y NADA más la produce: una inscripción aprobada
 * siempre tiene comprobante y un monto mayor a cero.
 *
 * El cupo de cortesía NO lleva `origin` propio a propósito: el guard de las
 * invitaciones (migración 135, `casa_referral_entry_guard`) rechaza cualquier
 * inscripción cuyo origen no sea 'compra' si no viene con su evento de
 * referido. Por eso acá se excluye explícitamente el regalo por invitar, que
 * tiene la misma forma pero sí marca su origen.
 *
 * Solo para mostrar: ningún cálculo de dinero ni de puntaje depende de esto.
 */
export function isCourtesyEntry(
  entry: { status: string; proof_path?: string | null; amount_cop?: number | null; origin?: string | null },
): boolean {
  return entry.status === "pagada" && !entry.proof_path && entry.amount_cop === 0
    && entry.origin !== "invitacion";
}

/**
 * `revocada` es la que el administrador retiró ANTES de que alguien la usara;
 * `retirada` es la que ya se había usado y el administrador deshizo (migración
 * 137): el cupo gratis queda anulado y la cuenta que la usó tampoco puede ir a
 * buscar otra, porque la cortesía conserva a su nombre.
 */
export type CourtesyStatus = "disponible" | "redimida" | "revocada" | "retirada";

/** Una cortesía de quien la reparte (casa_my_courtesies_v1). */
export interface MyCourtesy {
  id: string;
  code: string;
  status: CourtesyStatus;
  slug: string;
  polla: string;
  closes_at: string;
  polla_status: string;
  redeemed_name: string | null;
  redeemed_at: string | null;
}

/** Una cortesía en el panel (casa_courtesies_admin_v1). */
export interface AdminCourtesy extends MyCourtesy {
  polla_id: string;
  holder_id: string;
  holder_name: string | null;
  granted_at: string;
}

/** Lo que ve quien abre el enlace antes de tener cuenta (casa_courtesy_preview_v1). */
export interface CourtesyPreview {
  status: CourtesyStatus;
  slug: string;
  name: string;
  entry_price_cop: number;
  holder: string | null;
  usable: boolean;
  /** Es mía para regalar (solo con sesión). */
  mine: boolean;
  /** Esta persona la puede activar ahora mismo (solo con sesión). */
  redeemable: boolean;
}

/**
 * ¿Esta cortesía todavía sirve? La polla tiene que seguir abierta: cuando cierra
 * la polla, la cortesía no repartida vence y no se traslada a otra.
 */
export function isCourtesyLive(courtesy: Pick<MyCourtesy, "status" | "polla_status" | "closes_at">): boolean {
  return courtesy.status === "disponible" && courtesy.polla_status === "abierta"
    && new Date(courtesy.closes_at).getTime() > Date.now();
}

/**
 * Etiqueta corta para la lista: lo que la persona necesita saber de un vistazo.
 * Los tonos son los de <Tape>. Verde = todavía se puede regalar; apagado = ya no
 * hay nada que hacer con esa. NINGUNA usa el dorado: en esta app el oro es la
 * plata (el pozo, el premio) y se reserva a tres apariciones por pantalla.
 */
export function courtesyLabel(courtesy: MyCourtesy): { text: string; tone: "live" | "mute" } {
  if (courtesy.status === "redimida") {
    return { text: courtesy.redeemed_name ? `La usó ${courtesy.redeemed_name}` : "Usada", tone: "mute" };
  }
  if (courtesy.status === "revocada" || courtesy.status === "retirada") {
    return { text: "Retirada", tone: "mute" };
  }
  return isCourtesyLive(courtesy) ? { text: "Sin usar", tone: "live" } : { text: "Vencida", tone: "mute" };
}
