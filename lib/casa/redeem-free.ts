// lib/casa/redeem-free.ts — usar un cupo gratis por invitar, desde el cliente.
//
// (2026-09-19, migración 144) Una sola llamada para el botón «Usar mi cupo
// gratis». El servidor devuelve el mismo cupo ante un doble toque, así que quien
// llama no tiene que cuidarse de eso.

import { CASA_HEADERS } from "./contract";

export async function redeemFreeEntry(slug: string): Promise<{ ok: true; entryNumber: number | null } | { ok: false; error: string }> {
  try {
    const response = await fetch(`/api/casa/pollas/${encodeURIComponent(slug)}/canjear`, {
      method: "POST", headers: CASA_HEADERS, body: "{}",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, error: data.error ?? "No pudimos usar tu cupo. Intenta otra vez." };
    return { ok: true, entryNumber: typeof data.entry_number === "number" ? data.entry_number : null };
  } catch {
    return { ok: false, error: "Se cayó la conexión. Intenta otra vez." };
  }
}
