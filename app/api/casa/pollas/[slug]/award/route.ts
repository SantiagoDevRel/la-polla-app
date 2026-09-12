import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/auth/admin";
import { getPollaBySlug, getMyEntry, getPayouts } from "@/lib/casa/queries";
import { casaJson, casaError, requireCasaContract } from "@/lib/casa/operations";
import { signedCasaUpload, verifyCasaUpload, DRAW_EVIDENCE_BUCKET } from "@/lib/casa/uploads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return casaJson({ error: "No autenticado." }, 401);
  const polla = await getPollaBySlug((await params).slug);
  if (!polla || polla.prize_kind !== "objeto") return casaJson({ error: "No existe ese premio." }, 404);
  if (!user.is_admin && (await getMyEntry(polla.id, user.id))?.status !== "pagada") return casaJson({ error: "Solo participantes con pago confirmado." }, 403);
  const db = createAdminClient();
  const { data: draw, error } = await db.from("casa_object_draws")
    .select("id, state, prize_object, top_points, winner_id, created_at, resolved_at, confirmation_id")
    .eq("polla_id", polla.id).maybeSingle();
  if (error) return casaError(error);
  const candidates: Array<{ user_id: string; ticket: number; points: number; name: string }> = [];
  if (draw) {
    for (let offset = 0; ; offset += 500) {
      const result = await db.from("casa_object_draw_candidates").select("user_id, ticket, points, users(display_name)")
        .eq("draw_id", draw.id).order("ticket").range(offset, offset + 499);
      if (result.error) return casaError(result.error);
      for (const candidate of result.data ?? []) {
        const profile = Array.isArray(candidate.users) ? candidate.users[0] : candidate.users;
        candidates.push({ user_id: candidate.user_id, ticket: candidate.ticket, points: candidate.points, name: profile?.display_name ?? "Participante" });
      }
      if ((result.data?.length ?? 0) < 500) break;
    }
  }
  let evidenceUrl: string | null = null;
  if (draw?.state === "resolved" && draw.confirmation_id) {
    const evidence = await db.from("casa_draw_confirmation_attempts").select("evidence_path")
      .eq("id", draw.confirmation_id).eq("draw_id", draw.id).eq("state", "confirmed").single();
    if (evidence.error) return casaError(evidence.error);
    const signed = await db.storage.from(DRAW_EVIDENCE_BUCKET).createSignedUrl(evidence.data.evidence_path, 300);
    if (signed.error) return casaError(signed.error);
    evidenceUrl = signed.data.signedUrl;
  }
  const control = await db.from("casa_operation_control").select("object_draws_enabled").eq("singleton", true).single();
  if (control.error) return casaError(control.error);
  return casaJson({ draw, candidates, evidenceUrl, enabled: control.data.object_draws_enabled,
    payouts: await getPayouts(polla.id), admin: user.is_admin });
}

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("begin"), drawId: z.string().uuid(), winnerId: z.string().uuid(), requestId: z.string().uuid(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/), contentType: z.enum(["video/mp4", "video/webm", "video/quicktime"]),
    bytes: z.number().int().positive().max(50 * 1024 * 1024) }),
  z.object({ action: z.literal("confirm"), attemptId: z.string().uuid() }),
  z.object({ action: z.literal("retry"), attemptId: z.string().uuid() }),
  z.object({ action: z.literal("delivery"), payoutId: z.string().uuid(), reference: z.string().trim().min(3).max(500) }),
]);

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return casaJson({ error: "No autenticado." }, 401);
  if (!user.is_admin) return casaJson({ error: "Solo el administrador." }, 403);
  const contractError = requireCasaContract(request);
  if (contractError) return contractError;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return casaJson({ error: "Datos de adjudicación inválidos." }, 400);
  const polla = await getPollaBySlug((await params).slug);
  if (!polla || polla.prize_kind !== "objeto") return casaJson({ error: "No existe ese premio." }, 404);
  const db = createAdminClient();
  const body = parsed.data;
  const actor = { p_actor_id: user.id, p_contract: 2 };
  if (body.action === "delivery") {
    const award = await db.from("casa_payouts").select("id").eq("id", body.payoutId).eq("polla_id", polla.id).maybeSingle();
    if (award.error) return casaError(award.error);
    if (!award.data) return casaJson({ error: "No existe esa adjudicación." }, 404);
    const { data, error } = await db.rpc("casa_record_delivery_v2", { p_payout_id: body.payoutId, p_reference: body.reference, ...actor });
    return error ? casaError(error) : casaJson({ ok: true, ...data });
  }
  const draw = await db.from("casa_object_draws").select("id").eq("polla_id", polla.id).maybeSingle();
  if (draw.error) return casaError(draw.error);
  if (!draw.data) return casaJson({ error: "No existe ese desempate." }, 404);
  if (body.action === "begin") {
    if (body.drawId !== draw.data.id) return casaJson({ error: "Desempate inválido." }, 400);
    const { data, error } = await db.rpc("casa_begin_draw_confirmation_v2", { p_draw_id: draw.data.id,
      p_winner_id: body.winnerId, p_request_id: body.requestId, p_sha256: body.sha256, p_content_type: body.contentType, p_bytes: body.bytes, ...actor });
    if (error) return casaError(error);
    if (data.state === "confirmed") return casaJson({ ok: true, ...data });
    try { return casaJson({ ok: true, ...data, upload: await signedCasaUpload(DRAW_EVIDENCE_BUCKET, data.evidence_path) }); }
    catch { return casaJson({ error: "No se pudo preparar la evidencia. Reintenta con el mismo archivo y ganador." }, 503); }
  }
  const attempt = await db.from("casa_draw_confirmation_attempts")
    .select("id, state, evidence_path, content_sha256, content_type, content_bytes")
    .eq("id", body.attemptId).eq("draw_id", draw.data.id).eq("actor_id", user.id).maybeSingle();
  if (attempt.error) return casaError(attempt.error);
  if (!attempt.data) return casaJson({ error: "No existe ese intento de confirmación." }, 404);
  if (body.action === "retry") {
    const { data, error } = await db.rpc("casa_retry_draw_upload_v2", { p_attempt_id: attempt.data.id, ...actor });
    if (error) return casaError(error);
    try { return casaJson({ ok: true, ...data, upload: await signedCasaUpload(DRAW_EVIDENCE_BUCKET, data.evidence_path) }); }
    catch { return casaJson({ error: "No se pudo preparar la carga. Reintenta con el mismo archivo y ganador." }, 503); }
  }
  if (attempt.data.state !== "confirmed") {
    try { await verifyCasaUpload(DRAW_EVIDENCE_BUCKET, attempt.data.evidence_path, attempt.data); }
    catch (error) { return casaJson({ error: error instanceof Error ? error.message : "No se pudo verificar la evidencia.", code: (error as { code?: string }).code }, 409); }
  }
  const { data, error } = await db.rpc("casa_confirm_object_draw_v2", { p_attempt_id: attempt.data.id, ...actor });
  return error ? casaError(error) : casaJson({ ok: true, ...data });
}
