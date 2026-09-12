import { NextResponse } from "next/server";

export function casaJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export function requireCasaContract(request: Request) {
  return request.headers.get("X-Casa-Contract") === "2" ? null
    : casaJson({ error: "Actualiza la app para continuar.", code: "UPDATE_REQUIRED" }, 409);
}

const messages: Record<string, string> = {
  OPERATIONS_PAUSED: "Estamos actualizando las inscripciones. Intenta de nuevo en unos minutos; si ya transferiste, no repitas el pago.",
  UPDATE_REQUIRED: "Actualiza la app para continuar.",
  CASA_V2_NOT_ACTIVE: "Estamos actualizando la app. Intenta de nuevo en unos minutos.",
  DRAW_PENDING: "Primero debes completar el sorteo de desempate.",
  DRAW_PROTOCOL_PENDING: "El procedimiento de desempate todavía no está habilitado.",
  ALREADY_RESOLVED: "Esta polla ya está resuelta.",
  POLLA_NOT_FOUND: "No existe esta polla.",
  POLLA_FINAL: "Esta polla ya no permite esa operación.",
  INSCRIPTIONS_CLOSED: "Esta polla ya no acepta inscripciones.",
  ALREADY_SETTLED: "Esta polla ya tiene un resultado registrado.",
  ALREADY_REVIEWED: "Este comprobante ya fue revisado.",
  INVALID_TICKET: "Elige una boleta dentro del rango de esta rifa.",
  POLLA_NOT_OPEN: "Esta polla ya no acepta inscripciones.",
  CLOSE_FIRST: "Cierra la polla antes de resolverla.",
  PENDING_PROOFS: "Todavía hay comprobantes por revisar o cargas en curso.",
  NO_PAID_ENTRIES: "No hay inscripciones pagadas. Debes definir su cierre antes de continuar.",
  UNVERIFIED_MATCHES: "Todavía faltan partidos por verificar.",
  UNRESOLVED_QUESTIONS: "Todavía faltan preguntas por resolver.",
  DRAW_NUMBER_REQUIRED: "Registra el número sorteado antes de resolver.",
  UNSOLD_TICKET: "La boleta sorteada no está pagada. Aplica el procedimiento anunciado para este caso.",
  TICKET_UNAVAILABLE: "Esa boleta está reservada. Elige otra disponible.",
  ALREADY_PAID: "Esta inscripción ya está pagada.",
  PREVIOUS_TICKET_PENDING: "Completa el comprobante de tu boleta y espera la aprobación del pago antes de reservar otra.",
  PROOF_IN_REVIEW: "Tu comprobante ya está pendiente de revisión.",
  UPLOAD_IN_PROGRESS: "Ya hay una carga en curso para esta inscripción. Retómala o espera su vencimiento.",
  UPLOAD_EXPIRED: "Venció el tiempo de carga. Vuelve a seleccionar el comprobante para intentarlo de nuevo.",
  ATTEMPT_REPLACED: "Este comprobante fue reemplazado. Abre el intento vigente.",
  ATTEMPT_NOT_FOUND: "No existe este intento de carga.",
  PROOF_NOT_UPLOADED: "La carga todavía no está completa. Intenta confirmar de nuevo.",
  EVIDENCE_NOT_UPLOADED: "La evidencia todavía no está cargada. Puedes reintentar la confirmación.",
  REQUEST_CONFLICT: "Este intento corresponde a otros datos. Conserva el archivo y el ganador originales.",
  INVALID_DRAW_WINNER: "El ganador debe pertenecer a la lista de participantes empatados.",
  ADMIN_REQUIRED: "No tienes permiso para esa operación.",
};

export function casaErrorMessage(error: { message?: string; code?: string }): string {
  if (error.code === "55P03" || error.code === "57014" || error.code === "40P01")
    return "Hay otra operación en curso. Intenta de nuevo.";
  return messages[error.message ?? ""] ?? "No se pudo completar la operación. Actualiza los datos e intenta de nuevo.";
}

export function casaError(error: { message?: string; code?: string }) {
  const known = Boolean(messages[error.message ?? ""]) || ["55P03", "57014", "40P01", "23505", "22023", "55000"].includes(error.code ?? "");
  return casaJson({ error: casaErrorMessage(error), code: known ? error.message : "CASA_OPERATION_FAILED" }, known ? 409 : 500);
}
