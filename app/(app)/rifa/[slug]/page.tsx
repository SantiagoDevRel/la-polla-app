// app/(app)/rifa/[slug]/page.tsx — la rifa que el creador comparte por WhatsApp.
//
// Pública: cualquiera ve el tablero (estados, nunca nombres) aunque no tenga
// cuenta; al elegir un número se le pide entrar por SMS y vuelve aquí. Privada:
// solo creador y administradores, validado en SQL (rifa_public_view_v1): para
// el resto es un 404 igual al de una rifa inexistente.
// Sin sesión se cuenta la visita (embudo rifa → cuenta → polla).
import { notFound } from "next/navigation";
import Link from "next/link";
import { Settings } from "lucide-react";
import { getPublicView, getRifaViewer, rifaRpc, rifasEnabled, validSlug } from "@/lib/rifas/server";
import { HeroFrame, Label } from "@/components/street";
import { RifaComprador } from "@/components/rifas/RifaComprador";

export const dynamic = "force-dynamic";

export default async function RifaPage({ params }: { params: Promise<{ slug: string }> }) {
  if (!rifasEnabled()) notFound();
  const { slug } = await params;
  if (!validSlug(slug)) notFound();
  const viewer = await getRifaViewer();
  const { data: rifa, error } = await getPublicView(slug, viewer?.id ?? null);
  if (error || !rifa) notFound();
  if (!viewer) await rifaRpc("rifa_track_view_v1", { p_rifa: rifa.id, p_viewer: null });

  return (
    <div className="pb-28">
      <HeroFrame height="min-h-[136px]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Label>{rifa.visibility === "privada" ? "Rifa privada" : "Rifa"}{rifa.creator_name ? ` · de ${rifa.creator_name}` : ""}</Label>
            <h1 className="lp-display mt-1 text-[30px] [overflow-wrap:anywhere]">{rifa.name}</h1>
          </div>
          {rifa.viewer.is_creator && (
            <Link href={`/rifa/${rifa.slug}/gestionar`} aria-label="Gestionar mi rifa"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border-default bg-bg-card/80 text-text-primary transition-colors hover:border-gold/30">
              <Settings aria-hidden="true" className="h-5 w-5" />
            </Link>
          )}
        </div>
      </HeroFrame>
      <RifaComprador initial={rifa} />
    </div>
  );
}
