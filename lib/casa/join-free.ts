// lib/casa/join-free.ts — unirse a una polla gratis, desde el cliente.
//
// (2026-09-18, migración 143) Una sola llamada compartida por la tarjeta de la
// puerta y por la hoja que aparece al intentar pronosticar sin estar inscrito:
// dos botones, un solo camino, para que no se separen con el tiempo.
//
// El servidor es idempotente — si ya tienes cupo devuelve ese — así que quien
// llama no tiene que cuidarse de un doble toque.

import { requestJson } from "@/lib/http/json-request";
import { CASA_HEADERS } from "./contract";

type JoinResult = { ok: true } | { ok: false; kind: "auth" | "account" | "rejected" | "uncertain"; error: string };
type JoinAck = { ok: true; owner_id: string; slug: string; entry_id: string; entry_number: number | null; created: boolean };
type JoinRead = { ok: true; owner_id: string; slug: string; joined: boolean; entry: null | { entry_id: string; entry_number: number | null; status: "pagada" } };
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const entryNumber = (value: unknown) => value === null || (typeof value === "number" && Number.isInteger(value) && value > 0);

/** SQL enrollment is idempotent. A lost response is reconciled without another write. */
export async function joinFreePolla(slug: string, ownerId?: string): Promise<JoinResult> {
  if (!ownerId) return { ok: false, kind: "auth", error: "Ingresa de nuevo antes de inscribirte." };
  const endpoint = `/api/casa/pollas/${encodeURIComponent(slug)}/unirme`;
  const joined = await requestJson(endpoint, { method: "POST", headers: { ...CASA_HEADERS, "X-Casa-Owner": ownerId }, body: "{}" },
    (value): value is JoinAck => isRecord(value) && value.ok === true && value.owner_id === ownerId && value.slug === slug
      && typeof value.entry_id === "string" && value.entry_id.length > 0
      && entryNumber(value.entry_number) && typeof value.created === "boolean");
  if (joined.ok) return { ok: true };
  if (joined.kind !== "uncertain") return joined.status === 412
    ? { ok: false, kind: "account", error: joined.error } : joined;

  const current = await requestJson(endpoint, { headers: CASA_HEADERS }, (value): value is JoinRead => {
    if (!isRecord(value) || value.ok !== true || typeof value.owner_id !== "string" || value.slug !== slug || typeof value.joined !== "boolean") return false;
    if (!value.joined) return value.entry === null;
    return isRecord(value.entry) && value.entry.status === "pagada"
      && typeof value.entry.entry_id === "string" && value.entry.entry_id.length > 0 && entryNumber(value.entry.entry_number);
  }, 5_000);
  if (current.ok && current.data.owner_id !== ownerId) return { ok: false, kind: "account", error: "Tu cuenta cambió. Revisa tu perfil e ingresa con la cuenta original." };
  if (current.ok && current.data.joined) return { ok: true };
  if (!current.ok && current.kind === "auth") return current;
  return { ok: false, kind: "uncertain", error: "No pudimos confirmar tu inscripción. Intenta de nuevo; no se crearán dos inscripciones." };
}
