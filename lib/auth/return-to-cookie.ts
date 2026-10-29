// lib/auth/return-to-cookie.ts — a dónde volver después del login por WhatsApp.
//
// (2026-10-29, informe de participación) El enlace personal de WhatsApp se abre
// en otra pestaña: el sessionStorage del login no llega y quien venía de una
// polla terminaba en Inicio. El login deja aquí el returnTo (30 min, mismo
// sitio) y /api/auth/wa-magic lo lee al abrir la sesión. Se sanea en los dos
// lados con safeReturnTo: solo rutas internas.
import { safeReturnTo } from "@/lib/auth/safe-return-to";

export const RETURN_TO_COOKIE = "lp_return_to";
const MAX_LENGTH = 512;

/** Valor de la cookie → ruta interna segura, o null. */
export function parseReturnToCookie(raw: string | null | undefined): string | null {
  if (!raw || raw.length > MAX_LENGTH * 3) return null;
  try {
    const value = decodeURIComponent(raw);
    return value.length <= MAX_LENGTH ? safeReturnTo(value) : null;
  } catch {
    return null;
  }
}

/** Solo navegador: guarda (o borra con null) el destino del login. */
export function rememberReturnTo(path: string | null) {
  const safe = path && path.length <= MAX_LENGTH ? safeReturnTo(path) : null;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = safe
    ? `${RETURN_TO_COOKIE}=${encodeURIComponent(safe)}; Path=/; Max-Age=1800; SameSite=Lax${secure}`
    : `${RETURN_TO_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}
