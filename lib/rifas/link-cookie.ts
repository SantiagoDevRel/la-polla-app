// lib/rifas/link-cookie.ts — cookie lp_rifa del embudo rifa → cuenta.
//
// proxy.ts la pone cuando alguien SIN sesión abre /rifa/<slug> (valor
// «slug.milisegundos», httpOnly, 30 días, el primer enlace manda). Sola no
// decide nada: rifa_record_signup_v1 exige que la cuenta de auth.users se
// haya creado después de esa visita.
import { RIFA_SLUG_RE } from "./shared";

export const RIFA_PAGE_RE = /^\/rifa\/([a-z0-9]{8})$/;

export function rifaLinkCookieValue(slug: string, now = Date.now()): string | null {
  return RIFA_SLUG_RE.test(slug) ? `${slug}.${now}` : null;
}

export function parseRifaLinkCookie(raw: string | undefined | null): { slug: string; firstSeen: Date } | null {
  const match = /^([a-z0-9]{8})\.(\d{12,14})$/.exec(raw ?? "");
  if (!match) return null;
  const firstSeen = new Date(Number(match[2]));
  return Number.isNaN(firstSeen.getTime()) ? null : { slug: match[1], firstSeen };
}
