// app/(app)/rifa/[slug]/gestionar/page.tsx — panel del creador de la rifa.
//
// Solo quien creó la rifa (SQL: rifa_creator_view_v1 → CREATOR_ONLY). Aquí
// están los nombres y celulares de los compradores, por eso ni un
// administrador de La Polla entra: para cualquier otra persona es un 404.
import { notFound, redirect } from "next/navigation";
import { getCreatorView, getRifaViewer, rifasEnabled, validSlug } from "@/lib/rifas/server";
import { HeroFrame, Label } from "@/components/street";
import { RifaGestion } from "@/components/rifas/RifaGestion";

export const dynamic = "force-dynamic";

export default async function GestionarRifaPage({ params }: { params: Promise<{ slug: string }> }) {
  if (!rifasEnabled()) notFound();
  const { slug } = await params;
  if (!validSlug(slug)) notFound();
  const viewer = await getRifaViewer();
  if (!viewer) redirect(`/login?returnTo=${encodeURIComponent(`/rifa/${slug}/gestionar`)}`);
  const { data, error } = await getCreatorView(slug, viewer.id);
  if (error || !data) notFound();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://lapollacolombiana.com";

  return (
    <div className="pb-28">
      <HeroFrame height="min-h-[120px]">
        <Label>Gestionar mi rifa</Label>
        <h1 className="lp-display mt-1 text-[30px] [overflow-wrap:anywhere]">{data.name}</h1>
      </HeroFrame>
      <RifaGestion initial={data} shareUrl={`${appUrl}/rifa/${data.slug}`} />
    </div>
  );
}
