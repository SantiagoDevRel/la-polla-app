// lib/vision/preprocess-image.ts
//
// Wrapper client-side: cualquier File/Blob de imagen → la redimensiona
// y comprime al tamaño más barato y rápido para Claude Vision (Haiku
// 4.5). Resultado: un Blob JPEG <300KB, long-edge ≤ 1568px.
//
// Por qué 1568px: Anthropic redimensiona automáticamente al consumir
// imágenes — el long edge se cap-ea a 1568px. Si subimos más grande,
// gastamos bandwidth de upload + el server downscalea igual. Mejor
// downscale en cliente.
//
// Por qué JPEG 80%: balance calidad-tamaño. Para screenshots de banking
// apps con texto legible, JPEG 80% es indistinguible visualmente y
// pesa ~5x menos que PNG.
//
// Token estimate per imagen post-preprocess:
//   width × height / 750 → con long-edge=1568, short side proporcional.
//   Screenshot móvil típico (1080x2400) → resize a 705×1568 → ~1474 tokens.
//   Screenshot desktop (1920x1080) → resize a 1568×882 → ~1844 tokens.
//
// Costo per imagen con Haiku 4.5 ($1/$5 per MTok):
//   ~1700 input tokens × $1/M = $0.0017
//   + 200 prompt tokens × $1/M = $0.0002
//   + 150 output tokens × $5/M = $0.00075
//   ≈ $0.0027 per screenshot. ~1000 screenshots = $2.70.

const TARGET_LONG_EDGE = 1568;
const JPEG_QUALITY = 0.8;

export interface PreprocessResult {
  blob: Blob;
  width: number;
  height: number;
  bytesIn: number;
  bytesOut: number;
  estimatedTokens: number;
}

/**
 * Preprocesa una imagen para enviar a Claude Vision.
 * Solo client-side — usa canvas. Para Node/server, usar sharp.
 */
export async function preprocessImageForVision(
  input: File | Blob,
): Promise<PreprocessResult> {
  if (typeof window === "undefined") {
    throw new Error("preprocessImageForVision is client-only");
  }
  const bytesIn = input.size;

  const img = await loadImage(input);
  const { canvas, width, height } = drawResized(img, TARGET_LONG_EDGE);

  const blob = await canvasToJpeg(canvas, JPEG_QUALITY);

  return {
    blob,
    width,
    height,
    bytesIn,
    bytesOut: blob.size,
    estimatedTokens: Math.round((width * height) / 750),
  };
}

function loadImage(input: File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(input);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo decodificar la imagen"));
      void e;
    };
    img.src = url;
  });
}

function drawResized(
  img: HTMLImageElement,
  targetLongEdge: number,
): { canvas: HTMLCanvasElement; width: number; height: number } {
  const longEdge = Math.max(img.width, img.height);
  const scale = longEdge > targetLongEdge ? targetLongEdge / longEdge : 1;
  const width = Math.round(img.width * scale);
  const height = Math.round(img.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  // Smooth downscale para mantener legibilidad del texto del screenshot.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);
  return { canvas, width, height };
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("toBlob falló"));
      },
      "image/jpeg",
      quality,
    );
  });
}

/**
 * Convierte un Blob a base64 (sin data: prefix). Lo que la API de
 * Anthropic espera en la propiedad `source.data` cuando type='base64'.
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  // btoa requiere binary string; convertimos byte por byte. Para
  // archivos pequeños (<300KB típico post-preprocess) es OK.
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
