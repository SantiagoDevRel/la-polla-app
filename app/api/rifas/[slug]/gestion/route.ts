// app/api/rifas/[slug]/gestion/route.ts — panel del creador.
//
// GET: tablero con nombres y celulares de compradores, comprobantes, resumen
// y auditoría. POST: aprobar, rechazar, revertir, venta por fuera, marcar
// pagado, liberar, resultado y visibilidad. SQL exige ser el creador en cada
// RPC (CREATOR_ONLY): ni un administrador de La Polla opera la rifa de otro.
import { z } from "zod";
import { colombiaDateTimeToIso } from "@/lib/time/colombia";
import { rifaError, rifaJson, RIFA_DISABLED, RIFA_UNAUTHORIZED } from "@/lib/rifas/errors";
import { getCreatorView, getRifaViewer, notifyBuyerReview, rifaIdBySlug, rifaRpc, rifasEnabled, validSlug } from "@/lib/rifas/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!rifasEnabled()) return RIFA_DISABLED();
  const viewer = await getRifaViewer();
  if (!viewer) return RIFA_UNAUTHORIZED();
  const { slug } = await params;
  if (!validSlug(slug)) return rifaJson({ error: "Esta rifa no existe o no está disponible." }, 404);
  const { data, error } = await getCreatorView(slug, viewer.id);
  if (error || !data) return rifaError(error ?? {});
  return rifaJson(data);
}

const uuid = z.string().uuid();
const reason = z.string().trim().min(3).max(200);
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("aprobar"), proofId: uuid }),
  z.object({ action: z.literal("rechazar"), proofId: uuid, reason }),
  z.object({ action: z.literal("revertir"), proofId: uuid, reason }),
  z.object({ action: z.literal("venta"), number: z.number().int().min(0).max(99), name: z.string().trim().min(2).max(80),
    phone: z.string().regex(/^\+[1-9]\d{7,14}$/), paid: z.boolean() }),
  z.object({ action: z.literal("pagado"), ticketId: uuid }),
  z.object({ action: z.literal("liberar"), ticketId: uuid, reason: z.string().trim().max(200).optional() }),
  z.object({ action: z.literal("resultado"), number: z.number().int().min(0).max(99),
    unsold: z.enum(["volver_a_jugar", "desierta"]).nullable(),
    newDrawAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).nullable(), newLottery: z.string().trim().max(60).nullable() }),
  z.object({ action: z.literal("visibilidad"), visibility: z.enum(["privada", "publica"]) }),
]);

interface ReviewResult { buyer_id: string; numbers: number[]; rifa_name: string; rifa_slug: string; decision: string }

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!rifasEnabled()) return RIFA_DISABLED();
  const viewer = await getRifaViewer();
  if (!viewer) return RIFA_UNAUTHORIZED();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return rifaJson({ error: "Revisa los datos." }, 400);
  const rifaId = await rifaIdBySlug((await params).slug);
  if (!rifaId) return rifaJson({ error: "Esta rifa no existe o no está disponible." }, 404);
  const b = parsed.data;
  const actor = viewer.id;

  switch (b.action) {
    case "aprobar":
    case "rechazar": {
      const { data, error } = await rifaRpc<ReviewResult>("rifa_review_proof_v1", {
        p_actor: actor, p_proof: b.proofId, p_decision: b.action, p_reason: b.action === "rechazar" ? b.reason : null });
      if (error || !data) return rifaError(error ?? {});
      await notifyBuyerReview({ buyerId: data.buyer_id, rifaName: data.rifa_name, slug: data.rifa_slug, numbers: data.numbers,
        approved: b.action === "aprobar", reason: b.action === "rechazar" ? b.reason : null });
      return rifaJson({ ok: true });
    }
    case "revertir": {
      const { error } = await rifaRpc("rifa_unpay_proof_v1", { p_actor: actor, p_proof: b.proofId, p_reason: b.reason });
      return error ? rifaError(error) : rifaJson({ ok: true });
    }
    case "venta": {
      const { error } = await rifaRpc("rifa_offline_sale_v1", { p_actor: actor, p_rifa: rifaId, p_number: b.number,
        p_name: b.name, p_phone: b.phone, p_paid: b.paid });
      return error ? rifaError(error) : rifaJson({ ok: true });
    }
    case "pagado": {
      const { error } = await rifaRpc("rifa_mark_offline_paid_v1", { p_actor: actor, p_ticket: b.ticketId });
      return error ? rifaError(error) : rifaJson({ ok: true });
    }
    case "liberar": {
      const { error } = await rifaRpc("rifa_release_ticket_v1", { p_actor: actor, p_ticket: b.ticketId, p_reason: b.reason ?? null });
      return error ? rifaError(error) : rifaJson({ ok: true });
    }
    case "resultado": {
      let newDrawAt: string | null = null;
      if (b.newDrawAt) {
        try { newDrawAt = colombiaDateTimeToIso(b.newDrawAt); } catch { return rifaJson({ error: "Revisa la fecha del nuevo sorteo." }, 400); }
      }
      const { data, error } = await rifaRpc("rifa_set_result_v1", { p_actor: actor, p_rifa: rifaId, p_number: b.number,
        p_unsold_action: b.unsold, p_new_draw_at: newDrawAt, p_new_lottery: b.newLottery });
      return error ? rifaError(error) : rifaJson({ ok: true, ...(data as object) });
    }
    case "visibilidad": {
      const { error } = await rifaRpc("rifa_set_visibility_v1", { p_actor: actor, p_rifa: rifaId, p_visibility: b.visibility });
      return error ? rifaError(error) : rifaJson({ ok: true });
    }
  }
}
