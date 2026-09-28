// app/api/admin/rifas/route.ts — panel de administración de rifas.
//
// GET: creadores (con cuántas rifas activas), todas las rifas (reportes,
// ocultas) y el embudo rifa → cuenta → polla. POST: asignar o quitar el
// permiso de creador y ocultar/mostrar una rifa. Solo users.is_admin; SQL lo
// vuelve a exigir en cada RPC (ADMIN_REQUIRED).
// /api/admin/* está exento del gate de sesión del middleware: esta ruta valida
// la sesión antes de tocar la base.
import { z } from "zod";
import { rifaError, rifaJson, RIFA_DISABLED, RIFA_UNAUTHORIZED } from "@/lib/rifas/errors";
import { getRifaViewer, rifaRpc, rifasEnabled } from "@/lib/rifas/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (!rifasEnabled()) return RIFA_DISABLED();
  const viewer = await getRifaViewer();
  if (!viewer) return RIFA_UNAUTHORIZED();
  if (!viewer.is_admin) return rifaJson({ error: "No tienes permiso para esa operación." }, 403);
  const [creators, rifas, funnel] = await Promise.all([
    rifaRpc("rifa_admin_creators_v1", { p_actor: viewer.id }),
    rifaRpc("rifa_admin_list_v1", { p_actor: viewer.id }),
    rifaRpc("rifa_funnel_v1", { p_actor: viewer.id }),
  ]);
  const failed = creators.error ?? rifas.error ?? funnel.error;
  if (failed) return rifaError(failed);
  return rifaJson({ creators: creators.data, rifas: rifas.data, funnel: funnel.data });
}

const uuid = z.string().uuid();
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("asignar"), userId: uuid }),
  z.object({ action: z.literal("quitar"), userId: uuid }),
  z.object({ action: z.literal("ocultar"), rifaId: uuid, reason: z.string().trim().min(3).max(300) }),
  z.object({ action: z.literal("mostrar"), rifaId: uuid }),
]);

export async function POST(request: Request) {
  if (!rifasEnabled()) return RIFA_DISABLED();
  const viewer = await getRifaViewer();
  if (!viewer) return RIFA_UNAUTHORIZED();
  if (!viewer.is_admin) return rifaJson({ error: "No tienes permiso para esa operación." }, 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return rifaJson({ error: "Revisa los datos." }, 400);
  const b = parsed.data;
  let result;
  if (b.action === "asignar" || b.action === "quitar") {
    result = await rifaRpc(b.action === "asignar" ? "rifa_grant_creator_v1" : "rifa_revoke_creator_v1", { p_actor: viewer.id, p_user: b.userId });
  } else {
    result = await rifaRpc("rifa_admin_hide_v1", { p_actor: viewer.id, p_rifa: b.rifaId, p_hidden: b.action === "ocultar",
      p_reason: b.action === "ocultar" ? b.reason : null });
  }
  return result.error ? rifaError(result.error) : rifaJson({ ok: true });
}
