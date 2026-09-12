// Proof upload uses an immutable attempt and goes directly to private Storage.
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPollaBySlug, getPot } from "@/lib/casa/queries";
import { casaJson, casaError, requireCasaContract } from "@/lib/casa/operations";
import { signedCasaUpload, verifyCasaUpload } from "@/lib/casa/uploads";
import { notifyNewProof, PROOF_BUCKET } from "@/lib/telegram/notify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("begin"), requestId: z.string().uuid(), ticketNumber: z.number().int().positive().nullable(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/), contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    bytes: z.number().int().positive().max(8 * 1024 * 1024) }),
  z.object({ action: z.enum(["confirm", "fail"]), attemptId: z.string().uuid() }),
]);

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return casaJson({ error: "Necesitas iniciar sesión." }, 401);
  const contractError = requireCasaContract(request);
  if (contractError) return contractError;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return casaJson({ error: "Datos de comprobante inválidos. Usa una imagen JPG, PNG o WEBP de hasta 8 MB." }, 400);
  const body = parsed.data;
  const polla = await getPollaBySlug((await params).slug);
  if (!polla || polla.status === "borrador") return casaJson({ error: "Esa polla no existe." }, 404);
  const db = createAdminClient();
  if (body.action === "begin") {
    const { data, error } = await db.rpc("casa_begin_entry_proof_v2", {
      p_polla_id: polla.id, p_user_id: user.id, p_request_id: body.requestId, p_ticket: body.ticketNumber,
      p_sha256: body.sha256, p_content_type: body.contentType, p_bytes: body.bytes, p_contract: 2,
    });
    if (error) return casaError(error);
    if (data.state === "confirmed") return casaJson({ ok: true, ...data });
    try { return casaJson({ ok: true, ...data, upload: await signedCasaUpload(PROOF_BUCKET, data.proof_path) }); }
    catch { return casaJson({ error: "No se pudo preparar la carga. Reintenta con el mismo comprobante." }, 503); }
  }
  const { data: attempt, error: readError } = await db.from("casa_entry_proof_attempts")
    .select("id, entry_id, proof_path, state, content_sha256, content_type, content_bytes, casa_entries!casa_entry_proof_attempts_entry_id_fkey!inner(polla_id)")
    .eq("id", body.attemptId).eq("user_id", user.id).eq("casa_entries.polla_id", polla.id).maybeSingle();
  if (readError) return casaError(readError);
  if (!attempt) return casaJson({ error: "No existe este intento de carga." }, 404);
  if (body.action === "fail") {
    const { data, error } = await db.rpc("casa_fail_entry_proof_v2", { p_attempt_id: attempt.id, p_user_id: user.id, p_contract: 2 });
    return error ? casaError(error) : casaJson({ ok: true, changed: data });
  }
  if (attempt.state !== "confirmed") {
    try { await verifyCasaUpload(PROOF_BUCKET, attempt.proof_path, attempt); }
    catch (error) { return casaJson({ error: error instanceof Error ? error.message : "No se pudo verificar la carga.", code: (error as { code?: string }).code }, 409); }
  }
  const { data, error } = await db.rpc("casa_confirm_entry_proof_v2", { p_attempt_id: attempt.id, p_user_id: user.id, p_contract: 2 });
  if (error) return casaError(error);
  if (data.changed) {
    try {
      const [{ data: profile }, { data: entry }, pot] = await Promise.all([
        db.from("users").select("display_name").eq("id", user.id).maybeSingle(),
        db.from("casa_entries").select("amount_cop, ticket_number").eq("id", attempt.entry_id).eq("user_id", user.id).single(),
        getPot(polla.id, attempt.entry_id),
      ]);
      if (entry) await notifyNewProof({
        entryId: attempt.entry_id, attemptId: attempt.id, pollaName: polla.name, pollaSlug: polla.slug,
        userName: profile?.display_name ?? "Sin nombre", amountCop: entry.amount_cop,
        proofPath: attempt.proof_path, ticketNumber: entry.ticket_number,
        potAfterCop: pot.projected_prize_cop ?? pot.prize_cop,
        prizeKind: polla.prize_kind, prizeObject: polla.prize_object,
      });
    } catch { console.warn("[casa/join] Comprobante confirmado; aviso administrativo pendiente de consulta en la cola."); }
  }
  return casaJson({ ok: true, ...data });
}
