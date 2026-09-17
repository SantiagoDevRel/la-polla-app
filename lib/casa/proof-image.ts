// lib/casa/proof-image.ts — reglas puras para preparar el comprobante.
//
// Sin DOM ni red: se prueban en node. El navegador (prepare-proof.ts) decide
// con estas funciones QUÉ bytes sube; el servidor (verifyCasaUpload + SQL 098)
// no cambia y sigue verificando tamaño, SHA-256 y firma de lo declarado.
//
// Por qué importa que esto sea determinista: la recuperación de una carga
// (sessionStorage, otra pestaña u otro dispositivo, o la polla ya cerrada)
// compara el hash de lo que se sube. Por eso las dimensiones salen de una
// fórmula fija y el original viaja como segundo candidato.

/** Tipos que aceptan el endpoint, el SQL 098 y el bucket payment-proofs. */
export const PROOF_UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ProofUploadType = (typeof PROOF_UPLOAD_TYPES)[number];

/** Lo que el servidor admite por comprobante (zod, SQL 098). */
export const PROOF_UPLOAD_MAX_BYTES = 8 * 1024 * 1024;
/** Tope de lo que la persona puede elegir antes de preparar la imagen. */
export const PROOF_INPUT_MAX_BYTES = 20 * 1024 * 1024;
/** Hasta este tamaño el archivo se sube tal cual, sin decodificar. */
export const PROOF_SKIP_BYTES = 300 * 1024;

export const PROOF_LONG_EDGE = 1600;
/** Lado corto mínimo: por debajo, el texto de un comprobante deja de leerse. */
export const PROOF_MIN_SHORT_EDGE = 720;
export const PROOF_MAX_PIXELS = 4_000_000;
/** Límites de Telegram para sendPhoto: ancho + alto y proporción. */
export const TELEGRAM_MAX_DIMENSION_SUM = 10_000;
export const TELEGRAM_MAX_ASPECT_RATIO = 20;

export const PROOF_JPEG_QUALITY = 0.82;
export const PROOF_JPEG_FALLBACK_QUALITY = 0.72;
/** Si la preparación ahorra menos que esto, se sube el original. */
export const PROOF_MIN_SAVING_RATIO = 0.1;

export function isProofUploadType(type: string): type is ProofUploadType {
  return (PROOF_UPLOAD_TYPES as readonly string[]).includes(type);
}

/**
 * Tipo real según los primeros bytes. `File.type` sale de la EXTENSIÓN: un PNG
 * guardado como .jpg (pasa con comprobantes compartidos desde Nequi en Android)
 * se declaraba image/jpeg y el servidor, que verifica la firma, lo rechazaba.
 */
export function sniffProofType(head: Uint8Array): ProofUploadType | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (head.length >= 8 && png.every((byte, i) => head[i] === byte)) return "image/png";
  const ascii = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to));
  if (head.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

export function isHeicLike(type: string, name = ""): boolean {
  return /hei[cf]/i.test(type) || /\.hei[cf]$/i.test(name);
}

export interface ProofDimensions {
  width: number;
  height: number;
}

export interface ProofSizeRules {
  longEdge: number;
  minShortEdge: number;
  maxPixels: number;
}

export const PROOF_SIZE_RULES: ProofSizeRules = {
  longEdge: PROOF_LONG_EDGE,
  minShortEdge: PROOF_MIN_SHORT_EDGE,
  maxPixels: PROOF_MAX_PIXELS,
};

/**
 * Dimensiones de salida. Nunca agranda. Reduce el lado largo a 1600 px, salvo
 * que eso deje el lado corto por debajo de 720 px (capturas largas): ahí manda
 * el lado corto. Devuelve null cuando no hay una reducción que conserve la
 * legibilidad dentro de 4 MP y de los límites de Telegram, o si la entrada no
 * es una medida válida. Con null, quien llama conserva el original.
 */
export function proofTargetDimensions(
  width: number,
  height: number,
  rules: ProofSizeRules = PROOF_SIZE_RULES,
): ProofDimensions | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null;
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  if (long / short > TELEGRAM_MAX_ASPECT_RATIO) return null;
  const byLongEdge = Math.min(1, rules.longEdge / long);
  const keepsShortEdge = Math.min(1, rules.minShortEdge / short);
  const scale = Math.max(byLongEdge, keepsShortEdge);
  const target = {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
  if (target.width * target.height > rules.maxPixels) return null;
  if (target.width + target.height > TELEGRAM_MAX_DIMENSION_SUM) return null;
  return target;
}

/** Conserva el original cuando el ahorro no llega al 10 % (o no hay ahorro). */
export function shouldKeepOriginal(originalBytes: number, preparedBytes: number): boolean {
  if (!Number.isFinite(originalBytes) || !Number.isFinite(preparedBytes) || preparedBytes < 1) return true;
  return preparedBytes > originalBytes * (1 - PROOF_MIN_SAVING_RATIO);
}

/**
 * Orden de prueba de los candidatos: el que ya tiene un intento guardado va
 * primero (así se retoma sin crear otro), y nunca se repite un mismo hash.
 */
export function orderProofCandidates<T extends { sha256: string }>(
  candidates: readonly T[],
  preferredSha256?: string | null,
): T[] {
  const unique: T[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.sha256)) continue;
    seen.add(candidate.sha256);
    unique.push(candidate);
  }
  const preferred = preferredSha256 ? unique.findIndex((c) => c.sha256 === preferredSha256) : -1;
  if (preferred > 0) unique.unshift(...unique.splice(preferred, 1));
  return unique;
}

/**
 * Registro del intento en sessionStorage. `sourceSha256` es el hash del
 * archivo ORIGINAL que eligió la persona; `sha256`, el de lo que se subió.
 * Los registros del cliente anterior solo traen `sha256` (subían el original).
 */
export interface StoredProofRecord {
  sourceSha256?: string;
  sha256: string;
  requestId: string;
  attemptId?: string;
}

const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseStoredProofRecord(raw: string | null | undefined): StoredProofRecord | null {
  if (!raw) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.sha256 !== "string" || !SHA256.test(record.sha256)) return null;
  if (typeof record.requestId !== "string" || !UUID.test(record.requestId)) return null;
  if (record.sourceSha256 !== undefined && (typeof record.sourceSha256 !== "string" || !SHA256.test(record.sourceSha256))) return null;
  if (record.attemptId !== undefined && (typeof record.attemptId !== "string" || !UUID.test(record.attemptId))) return null;
  return {
    sha256: record.sha256,
    requestId: record.requestId,
    ...(record.sourceSha256 ? { sourceSha256: record.sourceSha256 as string } : {}),
    ...(record.attemptId ? { attemptId: record.attemptId as string } : {}),
  };
}

/** ¿El registro guardado corresponde al mismo archivo original? */
export function storedRecordMatchesSource(record: StoredProofRecord, sourceSha256: string): boolean {
  return (record.sourceSha256 ?? record.sha256) === sourceSha256;
}
