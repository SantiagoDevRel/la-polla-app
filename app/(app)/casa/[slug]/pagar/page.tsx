// app/(app)/casa/[slug]/pagar/page.tsx — subir el pantallazo de la transferencia.
//
// La plata se mueve POR FUERA de la app (Nequi, Daviplata, transferencia). Acá
// solo se registra el comprobante y se le avisa a Tama, que aprueba a mano
// desde el bot de Telegram. Ninguna pasarela, ningún cobro automático.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyEntry, getPollaBySlug, getPot, getActiveProofs, getOutstandingTicket } from "@/lib/casa/queries";
import { isPollaOpen } from "@/lib/casa/types";
import { formatCop } from "@/lib/casa/format";
import { HeroFrame, Label, StreetCard } from "@/components/street";
import { PagarForm } from "@/components/casa/PagarForm";

export const dynamic = "force-dynamic";

export default async function PagarPage({
  params, searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ boleta?: string }>;
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

  // Ya entró y no fue rechazado: no tiene nada que hacer acá. `anulada` (se
  // cayó la subida del comprobante) SÍ puede volver a intentar — el endpoint de
  // join reusa esa fila a propósito; si esta pantalla la rebota, la persona
  // queda sin ninguna puerta para entrar a la polla.
  if (
    entry &&
    entry.status !== "rechazada" &&
    entry.status !== "anulada" &&
    (entry.status === "pagada" || entry.proof_path !== null) &&
    polla.kind !== "rifa"
  ) {
    redirect(`/casa/${polla.slug}`);
  }
  const boleta = (await searchParams).boleta;
  let recovering = Boolean(entry);
  let rejected = entry?.status === "rechazada";
  let rejectReason = entry?.reject_reason;
  if (polla.kind === "rifa") {
    const outstanding = await getOutstandingTicket(polla.id, user.id);
    const number = boleta && /^\d+$/.test(boleta) && Number.isSafeInteger(Number(boleta)) ? Number(boleta) : undefined;
    const selected = number !== undefined ? await getOutstandingTicket(polla.id, user.id, number) : null;
    recovering = Boolean(selected);
    rejected = selected?.status === "rechazada";
    rejectReason = selected?.reject_reason;
    if (outstanding && (!selected || (selected.status === "pendiente" && selected.proof_path))) {
      const waiting = selected ?? outstanding;
      const inReview = waiting.status === "pendiente" && Boolean(waiting.proof_path);
      return <div className="px-4 py-6"><StreetCard className="space-y-4 p-4">
        <h1 className="lp-display text-[30px] [overflow-wrap:anywhere]">{inReview ? "Comprobante en revisión" : "Ya tienes una boleta reservada"}</h1>
        <p className="text-[15px] text-text-secondary">Boleta {waiting.ticket_number} de {polla.name}. {inReview ? "Espera la confirmación de tu pago antes de comprar otra boleta." : "Completa el comprobante de esta boleta antes de reservar otra."} Si ya transferiste, no repitas el pago.</p>
        <Link className="lp-btn lp-btn-primary w-full" href={inReview ? `/casa/${polla.slug}` : `/casa/${polla.slug}/pagar?boleta=${waiting.ticket_number}`}>{inReview ? "Ver mi rifa" : "Retomar comprobante"}</Link>
      </StreetCard></div>;
    }
  }
  const resumeOnly = !isPollaOpen(polla);
  if (resumeOnly) {
    const active = await getActiveProofs(polla.id, user.id);
    if (!active.some((proof) => polla.kind !== "rifa" || String(proof.ticket_number) === boleta)) redirect(`/casa/${polla.slug}`);
  }

  const entrada = polla.entry_price_cop;
  if (pot.entry_prize_cop === undefined || pot.entry_house_cop === undefined || pot.projected_prize_cop === undefined) throw new Error("No se pudo leer el desglose de la entrada.");
  const alPozo = pot.entry_prize_cop;


  return (
    <div className="pb-28">
      <HeroFrame height="min-h-[168px]">
        <Label>Entrar a</Label>
        <h1 className="lp-display mt-1 text-[30px]">{polla.name}</h1>
      </HeroFrame>

      <div className="space-y-4 px-4 pt-5">
        {rejected ? <p className="text-[15px] text-text-secondary">Tu comprobante fue rechazado. {rejectReason} Revisa el motivo y consulta con el administrador antes de hacer otra transferencia.</p>
          : recovering && <p className="text-[15px] text-text-secondary">Si ya transferiste, solo completa el comprobante. No repitas el pago.</p>}
        {/* Qué pasa con tu plata. Explícito, sin letra chica. */}
        <StreetCard className="p-4">
          <div className="flex items-end justify-between">
            <div>
              <Label>{recovering ? "Valor de la inscripción" : "Tienes que transferir"}</Label>
              <div className="lp-money mt-1 text-[34px] leading-none text-gold">
                {formatCop(entrada)}
              </div>
            </div>
          </div>
          {polla.prize_kind === "objeto" ? <p className="mt-4 text-[15px] leading-relaxed text-text-secondary">El premio es <strong className="text-text-primary">{polla.prize_object}</strong>. La inscripción te permite participar por ese objeto. No hay reparto del pozo ni premio adicional en dinero.</p> : <div className="mt-4 space-y-1.5 border-t border-border-subtle pt-3 text-[13px]">
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
                {formatCop(pot.entry_house_cop)}
              </span>
            </div>
            <div className="flex justify-between border-t border-border-subtle pt-1.5">
              <span className="text-text-secondary">Pozo si entras</span>
              <span className="lp-money text-text-primary">
                {formatCop(pot.projected_prize_cop)}
              </span>
            </div>
          </div>}
        </StreetCard>

        {/* A DÓNDE se transfiere. Sin esto el flujo era imposible de
            completar: la pantalla pedía el pantallazo de una transferencia
            que la persona no sabía a quién hacer. */}
        {polla.payout_account ? (
          <StreetCard hero className="p-4">
            <Label>{recovering ? "Cuenta de la inscripción" : "Transfiere a"}</Label>
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
              {recovering ? "Verifica que el comprobante corresponda a esta cuenta y súbelo para revisión." : <>Transfiere exactamente {formatCop(entrada)}. Luego subes el comprobante aquí abajo y lo confirmamos.</>}
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

        <PagarForm resumeOnly={resumeOnly}
          slug={polla.slug}
          esRifa={polla.kind === "rifa"}
          ticketCount={polla.ticket_count}
          initialTicket={boleta && /^\d+$/.test(boleta) && Number(boleta) <= (polla.ticket_count ?? 0) ? boleta : ""}
        />

        <p className="text-center text-[11px] leading-relaxed text-text-muted">
          El administrador revisa el comprobante. Se guarda solo para verificar
          tu pago. Si hay un error, lo rechaza y te avisa.
        </p>
      </div>
    </div>
  );
}
