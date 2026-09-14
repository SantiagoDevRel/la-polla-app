// lib/casa/user-receipts.ts — historial de comprobantes por usuario (panel admin).
//
// El dueño pidió (domingo 13-sep-2026, hora de Colombia) que el historial
// arranque "desde hoy". Para ver más atrás basta con mover esta fecha; la
// consulta no guarda nada propio.

/** Inicio del historial, medianoche en Colombia (UTC-05:00). */
export const USER_RECEIPT_HISTORY_START = "2026-09-13T00:00:00-05:00";

export type ReceiptOutcome = "aprobado" | "rechazado" | "pendiente" | "reemplazado";

/**
 * Estado visible de un intento de comprobante. Un intento sin decisión que ya
 * no es el comprobante vigente de su inscripción fue reemplazado por otro
 * posterior (o la inscripción se anuló); no está esperando revisión.
 */
export function receiptOutcome(attempt: {
  id: string;
  decision: string | null;
  currentAttemptId: string | null;
  entryStatus: string | null;
}): ReceiptOutcome {
  if (attempt.decision === "pagada") return "aprobado";
  if (attempt.decision === "rechazada") return "rechazado";
  if (attempt.currentAttemptId === attempt.id && attempt.entryStatus === "pendiente") return "pendiente";
  return "reemplazado";
}
