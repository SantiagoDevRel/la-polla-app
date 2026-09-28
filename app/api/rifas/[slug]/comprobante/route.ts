// app/api/rifas/[slug]/comprobante/route.ts — comprobante del comprador.
//
// Mismo contrato que los comprobantes de Casa (lib/casa/uploads.ts, reutilizado
// tal cual): SQL fija la ruta inmutable, el navegador sube directo al bucket
// privado con una URL firmada, y al confirmar el servidor verifica bytes,
// SHA-256 y firma de tipo antes de pasar los números a «en revisión».
// Un comprobante cubre todos los números reservados del comprador: una sola
// transferencia por el valor que calcula SQL.
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { signedCasaUpload, verifyCasaUpload } from "@/lib/casa/uploads";
import { rifaError, rifaJson, RIFA_DISABLED, RIFA_UNAUTHORIZED } from "@/lib/rifas/errors";
import { getRifaViewer, notifyCreatorNewProof, RIFA_PROOF_BUCKET, rifaIdBySlug, rifaRpc, rifasEnabled } from "@/lib/rifas/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("begin"), requestId: z.string().uuid(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
    contentType: z.enum(["image/jpeg", "image/png", "image/webp"]), bytes: z.number().int().positive().max(8 * 1024 * 1024) }),
  z.object({ action: z.enum(["confirm", "fail"]), proofId: z.string().uuid() }),
]);

interface BeginResult { proof_id: string; path: string; state: string; numbers: number[]; amount_cop: number; expires_at: string }
interface ConfirmResult { state: string; numbers: number[]; creator_id?: string; rifa_name?: string; already: boolean }

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!rifasEnabled()) return RIFA_DISABLED();
  const viewer = await getRifaViewer();
  if (!viewer) return RIFA_UNAUTHORIZED();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return rifaJson({ error: "Usa una imagen JPG, PNG o WEBP de hasta 8 MB." }, 400);
  const { slug } = await params;
  const rifaId = await rifaIdBySlug(slug);
  if (!rifaId) return rifaJson({ error: "Esta rifa no existe o no está disponible." }, 404);
  const body = parsed.data;

  if (body.action === "begin") {
    const { data, error } = await rifaRpc<BeginResult>("rifa_begin_proof_v1", {
      p_rifa: rifaId, p_buyer: viewer.id, p_request_id: body.requestId, p_sha256: body.sha256,
      p_content_type: body.contentType, p_bytes: body.bytes,
    });
    if (error || !data) return rifaError(error ?? {});
    if (data.state !== "subiendo") return rifaJson({ ok: true, ...data });
    try {
      const upload = await signedCasaUpload(RIFA_PROOF_BUCKET, data.path);
      return rifaJson({ ok: true, ...data, upload });
    } catch {
      return rifaJson({ error: "No se pudo preparar la carga. Reintenta con el mismo comprobante." }, 503);
    }
  }

  // Solo el dueño del comprobante lo confirma o lo abandona.
  const { data: proof } = await createAdminClient().from("rifa_proofs")
    .select("id, path, content_sha256, content_type, content_bytes, state")
    .eq("id", body.proofId).eq("buyer_id", viewer.id).eq("rifa_id", rifaId).maybeSingle();
  if (!proof) return rifaJson({ error: "No encontramos ese comprobante." }, 404);

  if (body.action === "fail") {
    const { error } = await rifaRpc("rifa_fail_proof_v1", { p_proof: proof.id, p_buyer: viewer.id });
    return error ? rifaError(error) : rifaJson({ ok: true });
  }

  if (proof.state === "subiendo") {
    try {
      await verifyCasaUpload(RIFA_PROOF_BUCKET, proof.path, {
        content_sha256: proof.content_sha256, content_type: proof.content_type, content_bytes: proof.content_bytes,
      });
    } catch (err) {
      const mismatch = (err as { code?: string }).code === "UPLOAD_MISMATCH";
      return rifaJson({ error: (err as Error).message, code: mismatch ? "UPLOAD_MISMATCH" : "PROOF_NOT_UPLOADED" }, mismatch ? 409 : 503);
    }
  }
  const { data, error } = await rifaRpc<ConfirmResult>("rifa_confirm_proof_v1", { p_proof: proof.id, p_buyer: viewer.id });
  if (error || !data) return rifaError(error ?? {});
  if (!data.already && data.creator_id && data.rifa_name) {
    await notifyCreatorNewProof({ creatorId: data.creator_id, rifaName: data.rifa_name, slug, numbers: data.numbers });
  }
  return rifaJson({ ok: true, state: data.state, numbers: data.numbers });
}
