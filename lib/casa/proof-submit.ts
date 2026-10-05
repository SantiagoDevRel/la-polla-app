// lib/casa/proof-submit.ts — el recorrido begin → subida → confirmación.
//
// Sin DOM: la red, la subida y sessionStorage llegan inyectados, así que el
// orden de candidatos y la recuperación se prueban en node. El contrato del
// servidor (join route + SQL 098) no cambia.
//
// Cada comprobante trae candidatos: los bytes preparados en este navegador y el
// original válido. Si el servidor ya tiene una carga en curso con otros bytes
// (cliente anterior, otra pestaña u otro dispositivo), responde
// UPLOAD_IN_PROGRESS y se prueba el siguiente candidato en vez de fallar.

import {
  orderProofCandidates,
  parseStoredProofRecord,
  storedRecordMatchesSource,
  type ProofUploadType,
  type StoredProofRecord,
} from "./proof-image";

export interface SubmitCandidate {
  blob: Blob;
  sha256: string;
  contentType: ProofUploadType;
  bytes: number;
}

export interface SignedUpload {
  bucket: string;
  path: string;
  token: string | null;
}

interface BeginResult {
  attempt_id: string;
  entry_number?: number | null;
  state: string;
  upload?: SignedUpload;
}

export interface ProofSubmitDeps {
  post: (body: Record<string, unknown>) => Promise<unknown>;
  upload: (upload: SignedUpload, blob: Blob) => Promise<unknown>;
  readRecord: () => string | null;
  writeRecord: (value: string) => void;
  newRequestId: () => string;
  onRetry?: () => void;
}

export interface ProofSubmitInput {
  sourceSha256: string;
  candidates: readonly SubmitCandidate[];
  ticketNumber: number | null;
  /**
   * Con la inscripción cerrada un intento fallado ya no se puede reemplazar
   * (INSCRIPTIONS_CLOSED): nunca se marca como fallado un intento guardado.
   */
  preserveStoredAttempt?: boolean;
  /**
   * Participación (migración 131): número = retomar esa, `null` = una nueva.
   * `undefined` no manda el campo (rifas y clientes que no conocen el concepto).
   */
  entryNumber?: number | null;
}

export interface ProofSubmitResult {
  attemptId: string;
  sha256: string;
  /** Participación en la que quedó el comprobante; null en rifas. */
  entryNumber: number | null;
}

/** Códigos con los que vale la pena probar el siguiente candidato. */
export const CANDIDATE_FALLBACK_CODES: ReadonlySet<string> = new Set([
  "UPLOAD_IN_PROGRESS",
  "REQUEST_CONFLICT",
  // Un intento ya confirmado con los otros bytes se reconoce como confirmado.
  "PROOF_IN_REVIEW",
  "ALREADY_PAID",
]);

const errorCode = (cause: unknown) => (cause as { code?: string } | null)?.code ?? "";

export async function submitProof(input: ProofSubmitInput, deps: ProofSubmitDeps): Promise<ProofSubmitResult> {
  let stored: StoredProofRecord | null = null;
  try { stored = parseStoredProofRecord(deps.readRecord()); } catch { /* Storage may be disabled. */ }
  if (stored && !storedRecordMatchesSource(stored, input.sourceSha256)) {
    // Otro archivo: el intento anterior se libera para poder empezar de nuevo.
    if (stored.attemptId && !input.preserveStoredAttempt) {
      await deps.post({ action: "fail", attemptId: stored.attemptId });
    }
    stored = null;
  }

  const ordered = orderProofCandidates(input.candidates, stored?.sha256);
  if (ordered.length === 0) throw new Error("Selecciona el comprobante de nuevo.");
  for (let index = 0; index < ordered.length; index += 1) {
    const candidate = ordered[index];
    const record: StoredProofRecord = stored && stored.sha256 === candidate.sha256
      ? { ...stored, sourceSha256: input.sourceSha256 }
      : { sourceSha256: input.sourceSha256, sha256: candidate.sha256, requestId: deps.newRequestId() };
    try {
      const begun = await submitCandidate(candidate, record, input.ticketNumber, input.entryNumber, deps);
      return { attemptId: begun.attemptId, sha256: candidate.sha256, entryNumber: begun.entryNumber };
    } catch (cause) {
      if (index < ordered.length - 1 && CANDIDATE_FALLBACK_CODES.has(errorCode(cause))) continue;
      throw cause;
    }
  }
  throw new Error("No se pudo iniciar la carga.");
}

async function submitCandidate(
  candidate: SubmitCandidate,
  record: StoredProofRecord,
  ticketNumber: number | null,
  entryNumber: number | null | undefined,
  deps: ProofSubmitDeps,
): Promise<{ attemptId: string; entryNumber: number | null }> {
  const save = () => { try { deps.writeRecord(JSON.stringify(record)); } catch { /* Retry within this render still works. */ } };
  const begin = async () => {
    const result = await deps.post({
      action: "begin", requestId: record.requestId, ticketNumber,
      sha256: candidate.sha256, contentType: candidate.contentType, bytes: candidate.bytes,
      ...(entryNumber === undefined ? {} : { entryNumber }),
    }) as BeginResult;
    if (!result?.attempt_id || !["uploading", "confirmed"].includes(result.state)
      || (result.state === "uploading" && !result.upload)) {
      throw new Error("No pudimos verificar el envío. Reintenta con el mismo comprobante.");
    }
    return result;
  };
  const done = (result: BeginResult) => ({ attemptId: result.attempt_id, entryNumber: result.entry_number ?? null });

  const uploadAndConfirm = async (result: BeginResult) => {
    if (result.state === "confirmed") return done(result);
    for (let retry = 0; retry < 3; retry += 1) {
      // Storage can finish writing even when its response is lost. Only the
      // server's byte/digest verification decides whether to upload again.
      try { if (result.upload) await deps.upload(result.upload, candidate.blob); } catch { /* Confirm the immutable path. */ }
      try {
        const confirmed = await deps.post({ action: "confirm", attemptId: result.attempt_id }) as BeginResult;
        if (confirmed?.state !== "confirmed" || confirmed.attempt_id !== result.attempt_id) {
          throw new Error("No pudimos verificar el envío. Reintenta con el mismo comprobante.");
        }
        return done({ ...result, ...confirmed });
      } catch (cause) {
        if (errorCode(cause) !== "UPLOAD_NOT_READY" || retry === 2) throw cause;
        deps.onRetry?.();
      }
    }
    throw new Error("No pudimos verificar el envío. Reintenta con el mismo comprobante.");
  };

  save();
  let begun: BeginResult | undefined;
  for (let retry = 0; retry < 2; retry += 1) {
    try {
      begun = await begin();
      break;
    } catch (cause) {
      if (retry === 0 && ["UPLOAD_EXPIRED", "ATTEMPT_REPLACED"].includes(errorCode(cause))) {
        record.requestId = deps.newRequestId(); delete record.attemptId; save();
      } else throw cause;
    }
  }
  if (!begun) throw new Error("No se pudo iniciar la carga.");
  record.attemptId = begun.attempt_id; save();
  try {
    return await uploadAndConfirm(begun);
  } catch (cause) {
    if (errorCode(cause) !== "UPLOAD_MISMATCH") throw cause;
  }
  await deps.post({ action: "fail", attemptId: begun.attempt_id });
  record.requestId = deps.newRequestId(); delete record.attemptId; save();
  const replacement = await begin();
  record.attemptId = replacement.attempt_id; save();
  return uploadAndConfirm(replacement);
}
