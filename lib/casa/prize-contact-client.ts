import type { PrizeContactData } from "@/lib/casa/prize-contact";
import { requestJson, type JsonRequestResult } from "@/lib/http/json-request";

const AUTH_ERROR = "Tu sesión venció. Ingresa de nuevo; conservamos ambos correos.";
const UNCERTAIN_ERROR = "No pudimos confirmar el guardado. Conservamos ambos correos. Comprueba el estado antes de volver a guardar.";
const ACCOUNT_ERROR = "Tu cuenta cambió. Vuelve a ingresar con la cuenta original; conservamos ambos correos.";
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
export type OwnedPrizeContactData = PrizeContactData & { owner_id: string; revision: number; request_id: string | null };
export type PrizeContactOperation = { email: string; confirmation: string; requestId: string; expectedRevision: number };

export function isPrizeContactData(value: unknown): value is PrizeContactData {
  if (typeof value !== "object" || value === null || "error" in value || ("ok" in value && value.ok === false)) return false;
  return "email" in value && (value.email === null || (typeof value.email === "string" && value.email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)))
    && "winner" in value && typeof value.winner === "boolean"
    && "editable" in value && typeof value.editable === "boolean";
}

export function isOwnedPrizeContactData(value: unknown): value is OwnedPrizeContactData {
  return isPrizeContactData(value) && "owner_id" in value && typeof value.owner_id === "string" && value.owner_id.length > 0
    && "revision" in value && typeof value.revision === "number" && Number.isSafeInteger(value.revision) && value.revision >= 0
    && "request_id" in value && (value.request_id === null || (typeof value.request_id === "string" && UUID.test(value.request_id)));
}

export async function readPrizeContact(endpoint: string, timeoutMs?: number, ownerId?: string): Promise<JsonRequestResult<OwnedPrizeContactData>> {
  const result = await requestJson(endpoint, ownerId ? { headers: { "X-Casa-Owner": ownerId } } : {}, isOwnedPrizeContactData, timeoutMs);
  if (result.ok) return result;
  return { ...result, error: result.kind === "auth" ? AUTH_ERROR : result.code === "SESSION_CHANGED" ? ACCOUNT_ERROR
    : "No se pudo cargar tu correo. Comprueba tu conexión e intenta de nuevo." };
}

export type PrizeContactSaveResult =
  | { ok: true; data: OwnedPrizeContactData }
  | { ok: false; kind: "changed"; error: string; retrySameEmail: false; current: OwnedPrizeContactData }
  | { ok: false; kind: "auth" | "account" | "rejected" | "uncertain"; error: string; retrySameEmail: boolean };

/** A revision fence distinguishes a completed write from a value present before it. */
export async function verifyPrizeContact(endpoint: string, operation: PrizeContactOperation, ownerId: string, timeoutMs?: number): Promise<PrizeContactSaveResult> {
  const result = await readPrizeContact(endpoint, timeoutMs, ownerId);
  if (result.ok && result.data.owner_id !== ownerId) return { ok: false, kind: "account", retrySameEmail: false, error: ACCOUNT_ERROR };
  if (result.ok && result.data.revision > operation.expectedRevision) {
    if (result.data.email === operation.email) return { ok: true, data: result.data };
    return { ok: false, kind: "changed", retrySameEmail: false, current: result.data,
      error: result.data.editable ? "El correo cambió en otra pantalla. Conservamos lo que escribiste. Revisa los datos y pulsa Guardar correo si deseas enviarlos."
        : "El correo registrado cambió y la entrega ya no permite editarlo. Comunícate con el administrador." };
  }
  if (result.ok) return { ok: false, kind: "uncertain", retrySameEmail: result.data.editable,
    error: result.data.editable ? "Este intento todavía no aparece confirmado. Puedes comprobar de nuevo o reenviar los mismos datos."
      : "La entrega ya no permite cambiar el correo. Comunícate con el administrador." };
  return { ok: false, kind: result.kind === "auth" ? "auth" : result.code === "SESSION_CHANGED" ? "account" : "uncertain", retrySameEmail: false,
    error: result.kind === "auth" ? AUTH_ERROR : result.code === "SESSION_CHANGED" ? ACCOUNT_ERROR : UNCERTAIN_ERROR };
}

export async function savePrizeContact(endpoint: string, operation: PrizeContactOperation, ownerId: string, timeoutMs?: number): Promise<PrizeContactSaveResult> {
  const result = await requestJson(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "X-Casa-Contract": "2", "X-Casa-Owner": ownerId },
    body: JSON.stringify(operation) }, (value): value is OwnedPrizeContactData => isOwnedPrizeContactData(value) && value.owner_id === ownerId
      && value.email === operation.email && value.request_id === operation.requestId && value.revision > operation.expectedRevision, timeoutMs);
  if (result.ok) return result;
  if (result.kind === "auth") return { ok: false, kind: "auth", error: AUTH_ERROR, retrySameEmail: false };
  if (result.code === "SESSION_CHANGED") return { ok: false, kind: "account", retrySameEmail: false, error: ACCOUNT_ERROR };
  if (result.code === "PRIZE_CONTACT_CHANGED") return verifyPrizeContact(endpoint, operation, ownerId, timeoutMs);
  if (result.kind === "rejected") return { ok: false, kind: "rejected", retrySameEmail: false, error: result.status === 400
    ? "No pudimos enviar este intento. Revisa ambos correos y vuelve a guardar."
    : result.status === 403 ? "Tu participación ya no permite cambiar el correo."
    : result.code === "UPDATE_REQUIRED" ? "Actualiza la app para continuar."
    : "La entrega ya no permite cambiar el correo. Comunícate con el administrador." };
  return verifyPrizeContact(endpoint, operation, ownerId, timeoutMs);
}
