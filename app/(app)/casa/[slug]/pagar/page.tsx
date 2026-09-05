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
  params: Promise<{ slug: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?returnTo=/casa/${(await params).slug}/pagar`);

  const polla = await getPollaBySlug((await params).slug);
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
              <Label>Tienes que transferir</Label>
              <div className="lp-money mt-1 text-[34px] leading-none text-gold">
                {formatCop(entrada)}
              </div>
            </div>
          </div>
          <div className="mt-4 space-y-1.5 border-t border-border-subtle pt-3 text-[13px]">
            <div className="flex justify-between">
              <span className="text-text-secondary">
                Va al pozo
              </span>
              <span className="lp-money text-text-primary">{formatCop(alPozo)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-secondary">
                Costo del servicio
              </span>
              <span className="lp-money text-text-muted">
                {formatCop(entrada - alPozo)}
              </span>
            </div>
            <div className="flex justify-between border-t border-border-subtle pt-1.5">
              <span className="text-text-secondary">Pozo si entras</span>
              <span className="lp-money text-text-primary">
                {formatCop(pot.prize_cop + alPozo)}
              </span>
            </div>
          </div>
        </StreetCard>

        {/* A DÓNDE se transfiere. Sin esto el flujo era imposible de
            completar: la pantalla pedía el pantallazo de una transferencia
            que la persona no sabía a quién hacer. */}
        {polla.payout_account ? (
          <StreetCard hero className="p-4">
            <Label>Transfiere a</Label>
            <div className="lp-display-sm mt-1 text-gold">
              {(polla.payout_method ?? "").toUpperCase()}
            </div>
            <div className="lp-money mt-2 select-all text-[26px] leading-none text-text-primary">
              {polla.payout_account}
            </div>
            {polla.payout_account_name && (
              <p className="mt-2 text-[13px] text-text-secondary">
                A nombre de{" "}
                <span className="text-text-primary">{polla.payout_account_name}</span>
              </p>
            )}
            <p className="mt-3 border-t border-border-subtle pt-3 text-[12px] text-text-muted">
              Transfiere exactamente {formatCop(entrada)}. Luego subes el
              comprobante aquí abajo y lo confirmamos.
            </p>
          </StreetCard>
        ) : (
          <div className="border border-red-alert/40 bg-red-alert/10 p-3">
            <p className="lp-label text-red-alert">Falta la cuenta de cobro</p>
            <p className="mt-1 text-[13px] text-text-secondary">
              Esta polla todavía no tiene cuenta de cobro. Avisa al
              administrador antes de transferir dinero.
            </p>
          </div>
        )}

        <PagarForm
          slug={polla.slug}
          esRifa={polla.kind === "rifa"}
          ticketCount={polla.ticket_count}
        />

        <p className="text-center text-[11px] leading-relaxed text-text-muted">
          El administrador revisa el comprobante. Se guarda solo para verificar
          tu pago. Si hay un error, lo rechaza y te avisa.
        </p>
      </div>
    </div>
  );
}
