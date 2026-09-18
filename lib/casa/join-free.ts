// lib/casa/join-free.ts — unirse a una polla gratis, desde el cliente.
//
// (2026-09-18, migración 143) Una sola llamada compartida por la tarjeta de la
// puerta y por la hoja que aparece al intentar pronosticar sin estar inscrito:
// dos botones, un solo camino, para que no se separen con el tiempo.
//
// El servidor es idempotente — si ya tienes cupo devuelve ese — así que quien
// llama no tiene que cuidarse de un doble toque.

import { CASA_HEADERS } from "./contract";

export async function joinFreePolla(slug: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetch(`/api/casa/pollas/${encodeURIComponent(slug)}/unirme`, {
      method: "POST", headers: CASA_HEADERS, body: "{}",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, error: data.error ?? "No pudimos registrarte. Intenta otra vez." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Se cayó la conexión. Intenta otra vez." };
  }
}
