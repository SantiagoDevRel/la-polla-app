// lib/casa/referrals-shared.ts — lo que la UI necesita de las invitaciones (migración 135).
//
// Solo lectura y formato. La autoridad es SQL: casa_referral_every decide si una
// polla participa, casa_set_referrer_v1 quién invitó a quién,
// casa_referral_balance cuántos cupos gratis hay y casa_referral_redeem_v1
// dónde se usan. Aquí no se decide nada que cambie cupos ni dinero.
//
// (2026-09-19, migración 144) El conteo es de la PERSONA, no de la polla: cada 5
// invitados que pagan una polla dan un cupo gratis para la polla que ella elija.

import type { CasaEntry, CasaPolla, ReferralPollaView } from "./types";
import { premioCompartir, type PremioCompartir } from "./share-text";

/** Cookie con el código del primer enlace de invitación que abrió la persona. */
export const REFERRAL_COOKIE = "lp_ref";
export const REFERRAL_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
/** Parámetro del enlace: /polla/<slug>?ref=JUANPE4821 */
export const REFERRAL_PARAM = "ref";
/**
 * «Nadie me invitó» en el inicio de Casa: cookie (no localStorage) para que el
 * servidor no pinte la tarjeta y no parpadee al hidratar. Solo es una
 * preferencia de esa pantalla; /pagar y Perfil siguen ofreciendo el código.
 */
export const REFERRAL_DISMISS_COOKIE = "lp_ref_no";

/**
 * DEFAULT de casa_pollas.referral_every. Desde la 144 esa columna es solo el
 * interruptor por polla (NULL = fuera del programa); el divisor real es global
 * (casa_referral_settings.every) y llega en las lecturas como `every`.
 */
export const DEFAULT_REFERRAL_EVERY = 5;

/** Mismo formato que casa_referral_codes: letras del nombre (3-6) + 4-6 dígitos. */
export const REFERRAL_CODE_RE = /^[A-Z]{3,6}[0-9]{4,6}$/;

/** Lo que escribe una persona → forma canónica. Igual a casa_referral_normalize_code. */
export function normalizeReferralCode(value: string | null | undefined): string | null {
  if (!value || value.length > 40) return null;
  const code = value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return code || null;
}

/** Código con el formato válido, o null (enlaces y cookie). */
export function validReferralCode(value: string | null | undefined): string | null {
  const code = normalizeReferralCode(value);
  return code && REFERRAL_CODE_RE.test(code) ? code : null;
}

/**
 * ¿La polla participa en las invitaciones? null = no: sus pagos no cuentan y el
 * cupo gratis no se usa ahí. Espejo de casa_referral_every: rifas y entradas
 * gratis nunca participan.
 */
export function referralEvery(
  polla: Pick<CasaPolla, "kind" | "entry_price_cop"> & { referral_every?: number | null },
): number | null {
  return polla.referral_every != null && polla.kind !== "rifa" && polla.entry_price_cop > 0
    ? polla.referral_every
    : null;
}

/** Cupo de regalo por invitar: sin comprobante ni monto. */
export function isGiftEntry(entry: Pick<CasaEntry, "origin"> | null | undefined): boolean {
  return entry?.origin === "invitacion";
}

/** Enlace de invitación con el dominio público; sin polla lleva al inicio. */
export function referralLink(origin: string, slug: string | null, code: string | null): string {
  const base = slug ? `${origin}/polla/${encodeURIComponent(slug)}` : `${origin}/inicio`;
  return code ? `${base}?${REFERRAL_PARAM}=${encodeURIComponent(code)}` : base;
}

/** La regla en una frase, con el número que llega de SQL (nunca un 5 escrito a mano). */
export function referralRule(every: number): string {
  return every === 1
    ? "Por cada invitado, te damos un cupo gratis."
    : `Por cada ${every} invitados, te damos un cupo gratis.`;
}

/** Letra menuda única (pedido del dueño: nada de listas de condiciones). */
export const REFERRAL_FINE_PRINT =
  "*Cuenta cada usuario nuevo que entre con tu código o enlace y pague una polla.";

/**
 * Aviso al entrar (pedido del dueño, 2026-09-17): «Por 5 invitados, te damos un
 * cupo en la POLLAGOL». Sale para la polla ABIERTA con invitaciones que cierra
 * primero — la de este fin de semana —, sea cual sea su nombre.
 */
export interface ReferralPromo {
  pollaId: string;
  slug: string;
  name: string;
  every: number;
  code: string;
  entryPriceCop: number;
  premio: PremioCompartir;
}

type PromoPolla = Pick<CasaPolla, "id" | "slug" | "name" | "kind" | "entry_price_cop" | "prize_kind" | "prize_object"> & {
  referral_every?: number | null;
  pot_mode?: CasaPolla["pot_mode"];
  closes_at?: string;
};

/** ¿Esta polla es la del aviso? La lista ya viene filtrada a pollas abiertas. */
export function isPromoPolla(polla: PromoPolla): boolean {
  return referralEvery(polla) !== null;
}

/**
 * La polla del aviso entre las abiertas: la que cierra primero y, si dos cierran a
 * la misma hora, la de id menor — para que el aviso no cambie entre dos cargas.
 */
export function pickPromoPolla<T extends PromoPolla>(abiertas: T[]): T | undefined {
  return abiertas.filter(isPromoPolla).sort((a, b) =>
    (a.closes_at ?? "").localeCompare(b.closes_at ?? "") || a.id.localeCompare(b.id))[0];
}

/** El aviso para esta persona, o null: sin código o sin programa en la polla. */
export function referralPromo(polla: PromoPolla, view: Pick<ReferralPollaView, "code" | "every"> | null, prizeCop: number): ReferralPromo | null {
  if (!isPromoPolla(polla) || !view?.code || !view.every) return null;
  return {
    pollaId: polla.id,
    slug: polla.slug,
    name: polla.name,
    every: view.every,
    code: view.code,
    entryPriceCop: polla.entry_price_cop,
    premio: premioCompartir(polla, prizeCop),
  };
}

/** Cuántos invitados faltan para el próximo cupo gratis. */
export function referralMissing(counted: number, every: number): number {
  return every - (counted % every);
}

/**
 * La barrita «2/5» (pedido del dueño, 2026-09-19): cuántos puntos van llenos
 * camino al PRÓXIMO cupo. Con un cupo recién ganado y sin usar se ve llena
 * (5/5) en vez de volver a cero: el premio se nota.
 */
export function referralProgress(counted: number, every: number, available: number): number {
  const avance = counted % every;
  return avance === 0 && available > 0 ? every : avance;
}

/** Mensajes para los resultados {ok:false,error} de casa_set_referrer_v1. */
const REFERRAL_ERRORS: Record<string, string> = {
  REFERRAL_CODE_NOT_FOUND: "No encontramos ese código. Revísalo con la persona que te invitó.",
  SELF_REFERRAL: "Ese es tu propio código. Escribe el de la persona que te invitó.",
  REFERRAL_LOCKED: "Ya confirmamos tu primer pago, así que quien te invitó ya no se puede cambiar.",
  NOT_NEW_USER: "Las invitaciones son para personas que entran por primera vez a La Polla.",
  REFERRAL_RATE_LIMITED: "Intentaste muchos códigos. Espera una hora y vuelve a intentarlo.",
};

export function referralErrorMessage(code: string | null | undefined): string {
  return REFERRAL_ERRORS[code ?? ""] ?? "No pudimos guardar el código. Intenta de nuevo.";
}
