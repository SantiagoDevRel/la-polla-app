// app/api/rifas/[slug]/reportar/route.ts — «Reportar rifa».
// Cualquier persona con sesión que pueda ver la rifa. Los administradores ven
// los reportes en /admin/rifas y pueden ocultarla.
import { z } from "zod";
import { rifaError, rifaJson, RIFA_DISABLED, RIFA_UNAUTHORIZED } from "@/lib/rifas/errors";
import { getRifaViewer, rifaIdBySlug, rifaRpc, rifasEnabled } from "@/lib/rifas/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({ reason: z.string().trim().min(3).max(500) });

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!rifasEnabled()) return RIFA_DISABLED();
  const viewer = await getRifaViewer();
  if (!viewer) return RIFA_UNAUTHORIZED();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return rifaJson({ error: "Cuéntanos en pocas palabras qué pasa." }, 400);
  const rifaId = await rifaIdBySlug((await params).slug);
  if (!rifaId) return rifaJson({ error: "Esta rifa no existe o no está disponible." }, 404);
  const { error } = await rifaRpc("rifa_report_v1", { p_user: viewer.id, p_rifa: rifaId, p_reason: parsed.data.reason });
  return error ? rifaError(error) : rifaJson({ ok: true });
}
