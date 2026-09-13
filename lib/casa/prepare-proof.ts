"use client";

// lib/casa/prepare-proof.ts — reduce la imagen en el navegador ANTES del hash.
//
// Se prepara UNA vez al elegir el archivo y ese mismo Blob se reutiliza en
// begin, reintento y reemplazo. El servidor no cambia: verifica que lo subido
// coincida en bytes, SHA-256 y firma con lo declarado.
//
// Decisiones que sostienen la recuperación de cargas (ver proof-image.ts):
// - Hasta 300 KB el archivo no se toca (ni se decodifica).
// - Siempre la misma ruta de decodificación (<img>, que respeta la orientación
//   EXIF en Chrome, Safari y Firefox) y un canvas en CPU (`willReadFrequently`)
//   con fondo blanco: mismo archivo y mismo navegador => mismos bytes.
// - El original válido viaja como segundo candidato, para retomar intentos de
//   un cliente anterior o de otro motor que haya producido otros bytes.
// - La salida JPEG no lleva EXIF: se descartan GPS, cámara y fecha.

import { fileDigest } from "./upload-client";
import {
  PROOF_INPUT_MAX_BYTES,
  PROOF_JPEG_FALLBACK_QUALITY,
  PROOF_JPEG_QUALITY,
  PROOF_SIZE_RULES,
  PROOF_SKIP_BYTES,
  PROOF_UPLOAD_MAX_BYTES,
  isHeicLike,
  isProofUploadType,
  proofTargetDimensions,
  shouldKeepOriginal,
  type ProofSizeRules,
  type ProofUploadType,
} from "./proof-image";

export interface ImageCandidate {
  blob: Blob;
  sha256: string;
  contentType: ProofUploadType;
  bytes: number;
  /** true si son bytes preparados en este navegador; false si es el original. */
  prepared: boolean;
}

export interface PreparedImage {
  /** Hash del archivo tal como lo eligió la persona. */
  sourceSha256: string;
  sourceBytes: number;
  /** En orden de preferencia: preparado primero, original válido después. */
  candidates: ImageCandidate[];
}

export interface PrepareImageOptions {
  inputMaxBytes: number;
  uploadMaxBytes: number;
  /** Hasta este tamaño se sube el original sin decodificar. */
  skipBytes: number;
  /** Si la primera codificación supera esto, se usa la calidad de respaldo. */
  targetBytes: number;
  rules: ProofSizeRules;
}

export const PROOF_PREPARE_OPTIONS: PrepareImageOptions = {
  inputMaxBytes: PROOF_INPUT_MAX_BYTES,
  uploadMaxBytes: PROOF_UPLOAD_MAX_BYTES,
  skipBytes: PROOF_SKIP_BYTES,
  targetBytes: PROOF_SKIP_BYTES,
  rules: PROOF_SIZE_RULES,
};

/**
 * Foto del premio: pasa por /api/casa/admin/prize-image, y la función de
 * Vercel corta el cuerpo en 4,5 MB. Se busca menos de 1 MB y nunca se manda
 * más de 4 MB.
 */
export const PRIZE_IMAGE_PREPARE_OPTIONS: PrepareImageOptions = {
  inputMaxBytes: PROOF_INPUT_MAX_BYTES,
  uploadMaxBytes: 4 * 1024 * 1024,
  skipBytes: 1024 * 1024,
  targetBytes: 1024 * 1024,
  rules: PROOF_SIZE_RULES,
};

export type ImagePreparationReason = "too_large" | "unsupported" | "heic" | "unreadable";

export class ImagePreparationError extends Error {
  readonly reason: ImagePreparationReason;
  constructor(message: string, reason: ImagePreparationReason) {
    super(message);
    this.name = "ImagePreparationError";
    this.reason = reason;
  }
}

const megabytes = (bytes: number) => Math.round(bytes / (1024 * 1024));

export async function prepareImageUpload(
  file: File,
  options: PrepareImageOptions = PROOF_PREPARE_OPTIONS,
): Promise<PreparedImage> {
  if (file.size > options.inputMaxBytes) {
    throw new ImagePreparationError(
      `La imagen supera los ${megabytes(options.inputMaxBytes)} MB. Toma una captura de pantalla y sube esa imagen.`,
      "too_large",
    );
  }
  const heic = isHeicLike(file.type, file.name);
  const acceptedType = isProofUploadType(file.type);
  if (!acceptedType && !heic) {
    throw new ImagePreparationError(
      "Usa una imagen JPG, PNG o WEBP. En iPhone puedes tomar una captura de la transferencia.",
      "unsupported",
    );
  }

  const sourceSha256 = await fileDigest(file);
  const original: ImageCandidate | null =
    acceptedType && file.size <= options.uploadMaxBytes
      ? { blob: file, sha256: sourceSha256, contentType: file.type as ProofUploadType, bytes: file.size, prepared: false }
      : null;
  if (original && file.size <= options.skipBytes) {
    return { sourceSha256, sourceBytes: file.size, candidates: [original] };
  }

  let prepared: ImageCandidate | null = null;
  try {
    prepared = await encodeJpegCandidate(file, options);
  } catch {
    prepared = null; // El original, si es válido, sigue sirviendo.
  }

  const candidates: ImageCandidate[] = [];
  if (prepared && prepared.bytes <= options.uploadMaxBytes
    && !(original && shouldKeepOriginal(original.bytes, prepared.bytes))) {
    candidates.push(prepared);
  }
  if (original) candidates.push(original);
  if (candidates.length > 0) return { sourceSha256, sourceBytes: file.size, candidates };

  if (heic) {
    throw new ImagePreparationError(
      "No pudimos abrir esa foto de iPhone (HEIC). Toma una captura de pantalla y sube esa imagen.",
      "heic",
    );
  }
  throw new ImagePreparationError(
    `No pudimos preparar esta imagen y supera los ${megabytes(options.uploadMaxBytes)} MB. Toma una captura de pantalla y sube esa imagen.`,
    "unreadable",
  );
}

/** Bytes JPEG preparados, o null si no hay reducción que conserve la legibilidad. */
async function encodeJpegCandidate(file: File, options: PrepareImageOptions): Promise<ImageCandidate | null> {
  const decoded = await decodeImage(file);
  let canvas: HTMLCanvasElement | null = null;
  try {
    const target = proofTargetDimensions(decoded.width, decoded.height, options.rules);
    if (!target) return null;
    canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    // willReadFrequently pide un canvas en CPU: evita que la GPU cambie bytes.
    const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    if (!context) return null;
    context.fillStyle = "#ffffff"; // Las transparencias de un PNG quedan sobre blanco, no negro.
    context.fillRect(0, 0, target.width, target.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(decoded.source, 0, 0, target.width, target.height);

    let blob = await toJpeg(canvas, PROOF_JPEG_QUALITY);
    if (blob && blob.size > options.targetBytes) blob = await toJpeg(canvas, PROOF_JPEG_FALLBACK_QUALITY);
    if (!blob) return null;
    return { blob, sha256: await fileDigest(blob), contentType: "image/jpeg", bytes: blob.size, prepared: true };
  } finally {
    if (canvas) { canvas.width = 0; canvas.height = 0; }
    decoded.release();
  }
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

async function decodeImage(file: Blob): Promise<DecodedImage> {
  try {
    return await decodeWithImageElement(file);
  } catch (cause) {
    if (typeof createImageBitmap !== "function") throw cause;
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  }
}

async function decodeWithImageElement(file: Blob): Promise<DecodedImage> {
  const url = URL.createObjectURL(file);
  const image = new Image();
  const release = () => { image.removeAttribute("src"); URL.revokeObjectURL(url); };
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("No se pudo decodificar la imagen."));
      image.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("La imagen no tiene medidas.");
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, release };
  } catch (cause) {
    release();
    throw cause;
  }
}

/** toBlob cae a PNG en silencio si el navegador no codifica JPEG: se verifica. */
async function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob || blob.type !== "image/jpeg" || blob.size < 3) return null;
  const head = new Uint8Array(await blob.slice(0, 3).arrayBuffer());
  return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff ? blob : null;
}
