// app/api/rifas/[slug]/route.ts — tablero y estado de una rifa (sesión opcional).
//
// La página lo vuelve a pedir para refrescar el tablero. Sin sesión solo se
// ven las Públicas; Privada y oculta responden 404 igual que una inexistente
// (rifa_public_view_v1 decide). Nunca trae nombres ni celulares.
import { rifaError, rifaJson, RIFA_DISABLED } from "@/lib/rifas/errors";
import { getPublicView, getRifaViewer, rifasEnabled, validSlug } from "@/lib/rifas/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!rifasEnabled()) return RIFA_DISABLED();
  const { slug } = await params;
  if (!validSlug(slug)) return rifaJson({ error: "Esta rifa no existe o no está disponible." }, 404);
  const viewer = await getRifaViewer();
  const { data, error } = await getPublicView(slug, viewer?.id ?? null);
  if (error || !data) return rifaError(error ?? {});
  return rifaJson(data);
}
