// lib/casa/payout-proofs.ts — la prueba de pago a los ganadores (migración 133).
//
// El pantallazo de cada transferencia va al bucket privado `payout-proofs`
// (existe desde la 046, service_role solo) bajo `casa/<polla>/<premio>/…`.
// El cron cleanup-payout-proofs borra únicamente lo que referencia
// `polla_payouts` (modelo P2P), así que estos archivos quedan como historial.
//
// Las URL se firman acá, por una hora. Quién las recibe lo decide la página
// de la polla: administradores, ganadores y participantes de esa polla (el
// pantallazo puede traer el número de cuenta del ganador); el resto solo ve
// «Pagado · fecha».

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CasaPayout } from "./types";

export const PAYOUT_PROOF_BUCKET = "payout-proofs";
/** Igual que la foto del premio: el cliente comprime a menos de 1 MB antes. */
export const PAYOUT_PROOF_MAX_BYTES = 8 * 1024 * 1024;
export const PAYOUT_PROOF_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type PayoutProofType = (typeof PAYOUT_PROOF_TYPES)[number];

export function isPayoutProofType(type: string): type is PayoutProofType {
  return (PAYOUT_PROOF_TYPES as readonly string[]).includes(type);
}

/** Ruta inmutable que después valida casa_mark_payout_paid_v2 (prefijo de ESTE premio). */
export function payoutProofPath(pollaId: string, payoutId: string, type: PayoutProofType, id = crypto.randomUUID()): string {
  const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  return `casa/${pollaId}/${payoutId}/${id}.${ext}`;
}

/** Firma de los primeros bytes: un .jpg renombrado no pasa como comprobante. */
export function matchesImageSignature(head: Uint8Array, type: PayoutProofType): boolean {
  if (type === "image/jpeg") return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (type === "image/png") return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => head[i] === b);
  const ascii = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to));
  return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
}

export async function uploadPayoutProof(path: string, file: Blob, type: PayoutProofType): Promise<void> {
  const { error } = await createAdminClient().storage.from(PAYOUT_PROOF_BUCKET)
    .upload(path, file, { contentType: type, upsert: false });
  if (error) throw new Error(`No se pudo guardar el comprobante: ${error.message}`);
}

/** Mejor esfuerzo: un archivo huérfano no vale una request fallida. */
export async function removePayoutProof(path: string | null | undefined): Promise<void> {
  if (!path) return;
  const { error } = await createAdminClient().storage.from(PAYOUT_PROOF_BUCKET).remove([path]);
  if (error) console.warn("[casa/payout-proofs] no se pudo borrar el comprobante anterior:", error.message);
}

/**
 * URL firmada (1 h) por premio con comprobante. Un premio sin comprobante o
 * cuya firma falle simplemente no aparece: la pantalla dice «sin comprobante».
 */
export async function signPayoutProofs(payouts: Array<Pick<CasaPayout, "id" | "proof_path">>, expiresIn = 3600): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const withProof = payouts.filter((p): p is typeof p & { id: string; proof_path: string } => Boolean(p.id && p.proof_path));
  if (withProof.length === 0) return out;
  const { data, error } = await createAdminClient().storage.from(PAYOUT_PROOF_BUCKET)
    .createSignedUrls(withProof.map((p) => p.proof_path), expiresIn);
  if (error || !data) {
    console.warn("[casa/payout-proofs] no se pudieron firmar los comprobantes:", error?.message);
    return out;
  }
  for (const payout of withProof) {
    const signed = data.find((row) => row.path === payout.proof_path && row.signedUrl && !row.error);
    if (signed?.signedUrl) out[payout.id] = signed.signedUrl;
  }
  return out;
}
