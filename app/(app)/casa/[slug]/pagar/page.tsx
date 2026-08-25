// app/(app)/casa/[slug]/pagar/page.tsx — subir el pantallazo de la transferencia.
//
// La plata se mueve POR FUERA de la app (Nequi, Daviplata, transferencia). Acá
// solo se registra el comprobante y se le avisa a Tama, que aprueba a mano
// desde el bot de Telegram. Ninguna pasarela, ningún cobro automático.

import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyEntry, getPollaBySlug, getPot } from "@/lib/casa/queries";
import { isPollaOpen } from "@/lib/casa/types";
import { formatCop } from "@/lib/casa/format";
import { HeroFrame, Label, StreetCard } from "@/components/street";
import { PagarForm } from "@/components/casa/PagarForm";

export const dynamic = "force-dynamic";

export default async function PagarPage({
  params,
}: {
  params: { slug: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?returnTo=/casa/${params.slug}/pagar`);

  const polla = await getPollaBySlug(params.slug);
  if (!polla || polla.status === "borrador") notFound();

  const [entry, pot] = await Promise.all([
    getMyEntry(polla.id, user.id),
    getPot(polla.id),
  ]);

  // Ya entró y no fue rechazado: no tiene nada que hacer acá.
  if (entry && entry.status !== "rechazada" && polla.kind !== "rifa") {
    redirect(`/casa/${polla.slug}`);
  }
  if (!isPollaOpen(polla)) redirect(`/casa/${polla.slug}`);

  const entrada = polla.entry_price_cop;
  const alPozo = Math.floor((entrada * (100 - polla.house_cut_pct)) / 100);

  return (
    <div className="pb-28">
      <HeroFrame height="h-[168px]">
        <Label>Entrar a</Label>
        <h1 className="lp-display mt-1 text-[30px]">{polla.name}</h1>
      </HeroFrame>

      <div className="space-y-4 px-4 pt-5">
        {/* Qué pasa con tu plata. Explícito, sin letra chica. */}
        <StreetCard className="p-4">
          <div className="flex items-end justify-between">
            <div>
              <Label>Tenés que transferir</Label>
              <div className="lp-money mt-1 text-[34px] leading-none text-gold">
                {formatCop(entrada)}
              </div>
            </div>
          </div>
          <div className="mt-4 space-y-1.5 border-t border-border-subtle pt-3 text-[13px]">
            <div className="flex justify-between">
              <span className="text-text-secondary">
                Va al pozo ({100 - polla.house_cut_pct}%)
              </span>
              <span className="lp-money text-text-primary">{formatCop(alPozo)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-secondary">
                Se queda la casa ({polla.house_cut_pct}%)
              </span>
              <span className="lp-money text-text-muted">
                {formatCop(entrada - alPozo)}
              </span>
            </div>
            <div className="flex justify-between border-t border-border-subtle pt-1.5">
              <span className="text-text-secondary">Pozo si entrás</span>
              <span className="lp-money text-text-primary">
                {formatCop(pot.prize_cop + alPozo)}
              </span>
            </div>
          </div>
        </StreetCard>

        <PagarForm
          slug={polla.slug}
          esRifa={polla.kind === "rifa"}
          ticketCount={polla.ticket_count}
        />

        <p className="text-center text-[11px] leading-relaxed text-text-muted">
          El pantallazo lo revisa Tama a mano. Se guarda solo para verificar tu
          pago. Si algo no cuadra, te lo rechaza y te avisa.
        </p>
      </div>
    </div>
  );
}
