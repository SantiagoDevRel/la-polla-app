// app/api/rifas/[slug]/visto/route.ts — registro de visita con sesión.
//
// La pantalla de la rifa lo llama una vez al abrirse con sesión:
//   1. guarda la rifa en «abiertas por enlace» de la pestaña RIFAS;
//   2. si el navegador trae la cookie lp_rifa (abrió una rifa SIN sesión, la
//      pone proxy.ts), atribuye la cuenta a esa rifa cuando SQL confirma que
//      la cuenta se creó después (rifa_record_signup_v1) y borra la cookie.
// Así se mide el embudo rifa → cuenta → polla sin tocar el login.
import { cookies } from "next/headers";
import { rifaJson, RIFA_DISABLED, RIFA_UNAUTHORIZED } from "@/lib/rifas/errors";
import { getRifaViewer, RIFA_LINK_COOKIE, rifaIdBySlug, rifaRpc, rifasEnabled } from "@/lib/rifas/server";
import { parseRifaLinkCookie } from "@/lib/rifas/link-cookie";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!rifasEnabled()) return RIFA_DISABLED();
  const viewer = await getRifaViewer();
  if (!viewer) return RIFA_UNAUTHORIZED();
  const rifaId = await rifaIdBySlug((await params).slug);
  if (!rifaId) return rifaJson({ error: "No encontrado." }, 404);
  await rifaRpc("rifa_track_view_v1", { p_rifa: rifaId, p_viewer: viewer.id });

  const link = parseRifaLinkCookie((await cookies()).get(RIFA_LINK_COOKIE)?.value);
  const response = rifaJson({ ok: true });
  if (link) {
    const linkedRifa = await rifaIdBySlug(link.slug);
    if (linkedRifa) {
      await rifaRpc("rifa_record_signup_v1", { p_user: viewer.id, p_rifa: linkedRifa, p_first_seen_at: link.firstSeen.toISOString() });
    }
    response.cookies.delete(RIFA_LINK_COOKIE);
  }
  return response;
}
