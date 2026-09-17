// app/api/casa/admin/payouts/[id]/proof/route.ts — la casa paga a un ganador
// y sube el pantallazo de la transferencia (migración 133).
//
// Un solo request con el archivo (el cliente ya lo comprimió a menos de 1 MB
// con prepareImageUpload, igual que la foto del premio): la función de Vercel
// lo recibe, lo guarda en el bucket privado `payout-proofs` y llama al RPC
// que marca el premio como pagado. Si el RPC rechaza, el archivo se borra.
//
// Auth ANTES de leer el archivo. Solo administradores, solo premios en dinero
// de pollas ya resueltas; SQL vuelve a comprobar todo eso con locks.

import { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { casaError, casaJson, requireCasaContract } from "@/lib/casa/operations";
import {
  PAYOUT_PROOF_MAX_BYTES,
  isPayoutProofType,
  matchesImageSignature,
  payoutProofPath,
  removePayoutProof,
  uploadPayoutProof,
} from "@/lib/casa/payout-proofs";
import { redactId } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return casaJson({ error: "No autenticado." }, 401);
  if (!user.is_admin) return casaJson({ error: "Solo el administrador." }, 403);
  const contractError = requireCasaContract(request);
  if (contractError) return contractError;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return casaJson({ error: "Premio inválido." }, 400);

  const db = createAdminClient();
  const { data: payout, error: payoutError } = await db
    .from("casa_payouts")
    .select("id, polla_id, prize_kind, paid_at, proof_path, casa_pollas!inner(status, settlement_outcome, archived_at)")
    .eq("id", id)
    .maybeSingle();
  if (payoutError) return casaError(payoutError);
  const polla = Array.isArray(payout?.casa_pollas) ? payout?.casa_pollas[0] : payout?.casa_pollas;
  if (!payout || payout.prize_kind !== "pozo") return casaJson({ error: "No existe ese premio.", code: "PAYOUT_NOT_FOUND" }, 404);
  if (!polla || polla.archived_at || polla.status !== "resuelta" || polla.settlement_outcome !== "money_awarded") {
    return casaJson({ error: "Solo se registran pagos de premios en dinero de pollas ya resueltas.", code: "PAYOUT_NOT_PAYABLE" }, 409);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return casaJson({ error: "No pude leer el formulario." }, 400);
  }
  const file = form.get("image");
  const reference = form.get("reference");
  if (!(file instanceof File)) return casaJson({ error: "Falta el pantallazo de la transferencia." }, 400);
  if (file.size < 1 || file.size > PAYOUT_PROOF_MAX_BYTES) return casaJson({ error: "La imagen debe pesar menos de 8 MB." }, 413);
  if (!isPayoutProofType(file.type)) {
    const esHeic = /heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name ?? "");
    return casaJson({ error: esHeic ? "Ese formato de iPhone no sirve. Toma un pantallazo y sube esa imagen." : "Solo se aceptan imágenes JPG, PNG o WEBP." }, 415);
  }
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!matchesImageSignature(head, file.type)) return casaJson({ error: "El archivo no es una imagen válida." }, 415);
  if (typeof reference === "string" && reference.trim().length > 200) return casaJson({ error: "La referencia es muy larga (máximo 200 caracteres)." }, 400);

  const path = payoutProofPath(payout.polla_id, payout.id, file.type);
  try {
    await uploadPayoutProof(path, file, file.type);
  } catch (cause) {
    console.error("[casa/payout-proof] upload:", cause instanceof Error ? cause.message : cause);
    return casaJson({ error: "No se pudo subir el comprobante. Intenta de nuevo." }, 500);
  }

  const { data, error } = await db.rpc("casa_mark_payout_paid_v2", {
    p_payout_id: payout.id,
    p_actor_id: user.id,
    p_contract: 2,
    p_proof_path: path,
    p_reference: typeof reference === "string" && reference.trim() ? reference.trim() : null,
  });
  if (error) {
    await removePayoutProof(path);
    return casaError(error);
  }
  const result = data as { previous_proof_path?: string | null; paid_count: number; total_count: number; paid_at: string };
  // El comprobante anterior (si se volvió a subir) ya no lo referencia nadie.
  if (result.previous_proof_path) await removePayoutProof(result.previous_proof_path);
  console.log(`[casa/payout-proof] premio ${redactId(payout.id)} pagado por ${redactId(user.id)} (${result.paid_count}/${result.total_count})`);
  return casaJson({ ok: true, paidAt: result.paid_at, paidCount: result.paid_count, totalCount: result.total_count });
}
