// app/api/rifas/[slug]/combo/route.ts — guarda «¿Eres de un combo de Los Del Sur?».
//
// Solo en rifas hechas con una barra (lib/rifas/partner.ts) y con sesión. El
// user_id sale de la sesión. La respuesta no cambia nada de la compra.
import { rifaJson, RIFA_DISABLED, RIFA_UNAUTHORIZED } from "@/lib/rifas/errors";
import { getRifaViewer, rifaIdBySlug, rifasEnabled } from "@/lib/rifas/server";
import { rifaPartnerBySlug } from "@/lib/rifas/partner";
import { comboAnswerSchema } from "@/lib/rifas/combo-shared";
import { saveComboAnswer } from "@/lib/rifas/combo";
import { redactId } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!rifasEnabled()) return RIFA_DISABLED();
  const viewer = await getRifaViewer();
  if (!viewer) return RIFA_UNAUTHORIZED();
  const { slug } = await params;
  if (!rifaPartnerBySlug(slug)) return rifaJson({ error: "No encontrado." }, 404);
  const parsed = comboAnswerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return rifaJson({ error: "Escribe el nombre del combo." }, 400);
  const rifaId = await rifaIdBySlug(slug);
  if (!rifaId) return rifaJson({ error: "No encontrado." }, 404);
  const error = await saveComboAnswer(rifaId, viewer.id, parsed.data);
  if (error) {
    console.error("[rifa-combo] no se guardó", { user: redactId(viewer.id), code: error.code });
    return rifaJson({ error: "No se pudo guardar. Intenta de nuevo." }, 500);
  }
  return rifaJson({ ok: true });
}
