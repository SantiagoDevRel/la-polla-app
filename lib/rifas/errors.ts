// lib/rifas/errors.ts — respuestas JSON y mensajes de error de las rifas.
//
// Las RPC de la migración 157 fallan con MESSAGE = código (NUMBER_TAKEN…) y,
// cuando el mensaje lleva cifras o números concretos, DETAIL ya redactado para
// la persona. Acá se traduce el código a una frase corta en tú, tono neutro.
import { NextResponse } from "next/server";

export function rifaJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

const MESSAGES: Record<string, string> = {
  RIFA_NOT_FOUND: "Esta rifa no existe o no está disponible.",
  RIFA_HIDDEN: "Esta rifa está en revisión y no recibe reservas.",
  RIFA_CLOSED: "Esta rifa ya cerró. No se reciben más reservas.",
  RIFA_FINISHED: "Esta rifa ya tiene resultado.",
  CREATOR_CANNOT_BUY: "Creaste esta rifa. Para anotar un número usa «Venta por fuera».",
  INVALID_NUMBER: "Elige números que estén en el tablero de esta rifa.",
  NUMBER_TAKEN: "Ese número ya lo tomó otra persona. Elige otro.",
  MAX_PENDING_NUMBERS: "Tienes demasiados números sin pago confirmado en esta rifa.",
  PAYOUT_ACCOUNT_REQUIRED: "Antes de reservar, agrega la cuenta donde recibirías el premio.",
  PROFILE_INCOMPLETE: "Completa tu perfil antes de reservar.",
  USER_NOT_FOUND: "No encontramos esa cuenta.",
  CREATOR_REQUIRED: "Tu cuenta no tiene permiso para crear rifas.",
  CREATOR_ONLY: "Solo quien creó la rifa puede hacer esto.",
  ADMIN_REQUIRED: "No tienes permiso para esa operación.",
  MAX_ACTIVE_RIFAS: "Llegaste al máximo de rifas activas.",
  INVALID_DRAW_AT: "El sorteo debe ser al menos en 10 minutos y dentro de los próximos 6 meses.",
  INVALID_PRIZE: "Escribe el premio: un valor en pesos o una descripción.",
  INVALID_RIFA: "Revisa los datos de la rifa.",
  INVALID_VISIBILITY: "Elige Privada o Pública.",
  VISIBILITY_LOCKED: "Ya hay números tomados: la rifa no puede volver a ser privada.",
  REQUEST_CONFLICT: "Este intento corresponde a otro archivo. Vuelve a elegir el comprobante.",
  INVALID_UPLOAD: "Usa una imagen JPG, PNG o WEBP de hasta 8 MB.",
  DUPLICATE_PROOF: "Ese comprobante ya lo enviaste en esta rifa.",
  NO_RESERVED_NUMBERS: "No tienes números reservados esperando comprobante.",
  RESERVATION_EXPIRING: "Tu reserva está por vencer. Vuelve a elegir tus números.",
  ATTEMPT_NOT_FOUND: "No encontramos ese comprobante.",
  ATTEMPT_REPLACED: "Este comprobante fue reemplazado por uno más reciente.",
  ALREADY_REVIEWED: "Este comprobante ya fue revisado.",
  UPLOAD_EXPIRED: "Venció el tiempo de carga. Vuelve a elegir tus números y el comprobante.",
  PROOF_NOT_UPLOADED: "La carga todavía no está completa. Intenta de nuevo.",
  REASON_REQUIRED: "Escribe el motivo.",
  INVALID_DECISION: "Elige aprobar o rechazar.",
  NOT_APPROVED: "Ese pago no está aprobado.",
  TICKET_NOT_FOUND: "No encontramos ese número.",
  INVALID_TICKET_STATE: "Ese número no admite esta acción en su estado actual.",
  BUYER_NAME_REQUIRED: "Escribe el nombre de quien compra.",
  INVALID_PHONE: "Escribe un celular válido.",
  TOO_EARLY: "El resultado se escribe después de la hora del sorteo.",
  PENDING_WINNER: "El número ganador todavía no tiene el pago confirmado.",
  UNSOLD_CHOICE_REQUIRED: "Ese número no se vendió. Elige qué pasa con la rifa.",
  RATE_LIMITED: "Enviaste muchos reportes hoy. Intenta mañana.",
  INVALID_PATH: "No se pudo guardar la foto.",
  DRAW_LOCKED: "Después del sorteo solo puedes aprobar pagos. Si hay un problema, usa «Reportar rifa».",
  OWNER_ONLY: "Solo quien creó la rifa puede cambiar su equipo.",
  ALREADY_MANAGER: "Esa persona ya administra esta rifa.",
  MAX_MANAGERS: "La rifa ya tiene 5 coadministradores.",
  MANAGER_HAS_NUMBERS: "Esa persona tiene números en esta rifa. Libéralos antes de sumarla al equipo.",
  REPLAY_LIMIT: "Esta rifa ya se volvió a jugar 3 veces. Marca el resultado como desierta.",
};

/** Errores cuyo DETAIL de SQL ya viene redactado con los números o cifras exactos. */
const DETAILED = new Set(["NUMBER_TAKEN", "MAX_PENDING_NUMBERS", "MAX_ACTIVE_RIFAS", "PENDING_WINNER", "UNSOLD_CHOICE_REQUIRED"]);
const FORBIDDEN = new Set(["CREATOR_ONLY", "OWNER_ONLY", "ADMIN_REQUIRED", "CREATOR_REQUIRED"]);

export interface RpcError { message?: string; code?: string; details?: string | null }

export function rifaErrorMessage(error: RpcError): string {
  if (error.code === "55P03" || error.code === "57014" || error.code === "40P01") return "Hay otra operación en curso. Intenta de nuevo.";
  const code = error.message ?? "";
  if (DETAILED.has(code) && error.details) return error.details;
  return MESSAGES[code] ?? "No se pudo completar la operación. Actualiza e intenta de nuevo.";
}

export function rifaErrorStatus(error: RpcError): number {
  const code = error.message ?? "";
  if (code === "RIFA_NOT_FOUND") return 404;
  if (FORBIDDEN.has(code)) return 403;
  if (MESSAGES[code] || ["55P03", "57014", "40P01"].includes(error.code ?? "")) return 409;
  return 500;
}

export function rifaError(error: RpcError) {
  const status = rifaErrorStatus(error);
  if (status === 500) console.error("[rifas] error inesperado:", error.code, error.message);
  return rifaJson({ error: rifaErrorMessage(error), code: MESSAGES[error.message ?? ""] ? error.message : "RIFA_OPERATION_FAILED" }, status);
}

export const RIFA_DISABLED = () => rifaJson({ error: "No encontrado." }, 404);
export const RIFA_UNAUTHORIZED = () => rifaJson({ error: "Necesitas iniciar sesión." }, 401);
