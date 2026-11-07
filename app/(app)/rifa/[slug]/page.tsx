// app/(app)/rifa/[slug]/page.tsx — la rifa que el creador comparte por WhatsApp.
//
// Pública: cualquiera ve el tablero (estados, nunca nombres) aunque no tenga
// cuenta; al elegir un número se le pide entrar por SMS y vuelve aquí. Privada:
// solo creador y administradores, validado en SQL (rifa_public_view_v1): para
// el resto es un 404 igual al de una rifa inexistente.
// Sin sesión se cuenta la visita (embudo rifa → cuenta → polla).
import { notFound } from "next/navigation";
import Link from "next/link";
import { Camera, ChevronDown, Settings } from "lucide-react";
import { getPublicView, getRifaViewer, rifaRpc, rifasEnabled, validSlug } from "@/lib/rifas/server";
import { HeroFrame, Label, Tape } from "@/components/street";
import { RifaComprador } from "@/components/rifas/RifaComprador";
import { PrizeMotion, PrizePhotoCarousel } from "@/components/casa/PrizeShowcase";
import { rifaBenefit } from "@/lib/rifas/benefit";
import { rifaPartner } from "@/lib/rifas/partner";
import { hasComboAnswer } from "@/lib/rifas/combo";
import { ComboPregunta } from "@/components/rifas/ComboPregunta";

export const dynamic = "force-dynamic";

export default async function RifaPage({ params }: { params: Promise<{ slug: string }> }) {
  if (!rifasEnabled()) notFound();
  const { slug } = await params;
  if (!validSlug(slug)) notFound();
  const viewer = await getRifaViewer();
  const { data: rifa, error } = await getPublicView(slug, viewer?.id ?? null);
  if (error || !rifa) notFound();
  if (!viewer) await rifaRpc("rifa_track_view_v1", { p_rifa: rifa.id, p_viewer: null });
  const benefit = rifaBenefit(rifa.id);
  const partner = rifaPartner(rifa.id);
  // (2026-11-07) Rifa con barra: «¿Eres de un combo?» una vez, con sesión (migración 180).
  const askCombo = partner !== null && viewer !== null && !(await hasComboAnswer(rifa.id, viewer.id));
  const gestionar = rifa.viewer.is_creator && (
    <Link href={`/rifa/${rifa.slug}/gestionar`} aria-label="Gestionar mi rifa"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border-default bg-bg-card/80 text-text-primary transition-colors hover:border-gold/30">
      <Settings aria-hidden="true" className="h-5 w-5" />
    </Link>
  );

  if (benefit) return (
    <div className="pb-28">
      {/* Rifa sin ánimo de lucro: lo primero es para quién es la plata, en grande. */}
      <HeroFrame height="min-h-[136px]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {/* (2026-11-06) Rifa con Los Del Sur: el escudo de la barra va primero (lib/rifas/partner.ts). */}
            {partner && (
              <div className="mb-3 flex min-w-0 items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element -- WebP en su tamaño real, sin Image Optimization */}
                <img src={partner.escudo} alt="" width={52} height={52} className="h-[52px] w-[52px] max-w-none shrink-0" />
                <div className="min-w-0">
                  <p className="lp-display text-[26px] leading-none [overflow-wrap:anywhere]">{partner.name}</p>
                  <p className="mt-1 text-[13px] text-text-secondary">La barra y sus combos</p>
                </div>
              </div>
            )}
            <Tape tone="live" className="max-w-full [overflow-wrap:anywhere]">Sin ánimo de lucro</Tape>
            <p className="lp-label mt-3">Rifa para</p>
            <h1 className="lp-display mt-1 text-[34px] leading-[1.02] [overflow-wrap:anywhere]">{benefit.cause}</h1>
          </div>
          {gestionar}
        </div>
        <p className="mt-3 text-[15px] leading-snug text-text-primary">{benefit.detail}</p>
        {benefit.jersey && (
          <div className="mt-4 flex min-w-0 items-center gap-3">
            <PrizeMotion media={benefit.jersey.media} label={benefit.jersey.label} interactive className="h-28 w-24 shrink-0" />
            <div className="min-w-0">
              <Label>Premio</Label>
              <p className="lp-money mt-1 text-[24px] !leading-[1.1] text-gold [overflow-wrap:anywhere]">{rifa.prize_text ?? "Camiseta firmada"}</p>
              <p className="mt-1 text-[13px] text-text-secondary [overflow-wrap:anywhere]">{rifa.name}</p>
            </div>
          </div>
        )}
        {/* (2026-11-08) Las fotos reales de la camiseta, cerradas por defecto: el giro se hizo con ellas. */}
        {benefit.jersey && benefit.jersey.photos.length > 0 && (
          <details className="group/fotos mt-4">
            <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 rounded-full border border-border-strong bg-bg-elevated/90 px-4 py-2.5 text-[15px] font-semibold leading-[1.45] text-text-primary transition-colors hover:bg-bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold [&::-webkit-details-marker]:hidden">
              <Camera aria-hidden="true" className="h-5 w-5 shrink-0" />
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">Ver foto original</span>
              <ChevronDown aria-hidden="true" className="h-5 w-5 shrink-0 transition-transform duration-200 group-open/fotos:rotate-180" />
            </summary>
            <PrizePhotoCarousel photos={benefit.jersey.photos} className="mt-3 rounded-xl border border-border-default bg-bg-card/80 p-3" />
          </details>
        )}
      </HeroFrame>
      <RifaComprador initial={rifa} benefitCause={benefit.cause} />
      {askCombo && partner && <ComboPregunta slug={rifa.slug} partnerName={partner.name} escudo={partner.escudo} />}
    </div>
  );

  return (
    <div className="pb-28">
      <HeroFrame height="min-h-[136px]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Label>{rifa.visibility === "privada" ? "Rifa privada" : "Rifa"}{rifa.creator_name ? ` · de ${rifa.creator_name}` : ""}</Label>
            <h1 className="lp-display mt-1 text-[30px] [overflow-wrap:anywhere]">{rifa.name}</h1>
          </div>
          {gestionar}
        </div>
      </HeroFrame>
      <RifaComprador initial={rifa} />
      {askCombo && partner && <ComboPregunta slug={rifa.slug} partnerName={partner.name} escudo={partner.escudo} />}
    </div>
  );
}
