// app/(app)/casa/[slug]/pagar/page.tsx — subir el pantallazo de la transferencia.
//
// La plata se mueve POR FUERA de la app (Nequi, Daviplata, transferencia). Acá
// solo se registra el comprobante y se le avisa a Tama, que aprueba a mano
// desde el bot de Telegram. Ninguna pasarela, ningún cobro automático.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyEntries, getPollaBySlug, getPot, getActiveProofs, getOutstandingTicket } from "@/lib/casa/queries";
import { ChevronRight } from "lucide-react";
import { DEFAULT_MAX_ENTRIES_PER_USER, isLiveEntry, isPollaOpen, type CasaEntry } from "@/lib/casa/types";
import { formatCop } from "@/lib/casa/format";
import { HeroFrame, Label, StreetCard } from "@/components/street";
import { PagarForm } from "@/components/casa/PagarForm";
import { CuposForm } from "@/components/casa/CuposForm";
import { CopiarDato } from "@/components/casa/CopiarDato";
import { QuienTeInvito } from "@/components/casa/QuienTeInvito";
import { getReferralInvitee, getReferralPollaView } from "@/lib/casa/referrals";
import { UsarCupoGratis } from "@/components/casa/UsarCupoGratis";
import { REFERRAL_COOKIE, validReferralCode } from "@/lib/casa/referrals-shared";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export default async function PagarPage({
  params, searchParams,
}: {
  params: Promise<{ slug: string }>;
  /** `participacion`: "nueva" o el número de una participación propia (migración 131). */
  searchParams: Promise<{ boleta?: string; participacion?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?returnTo=/polla/${(await params).slug}/pagar`);

  const polla = await getPollaBySlug((await params).slug);
  if (!polla || polla.status === "borrador") notFound();

  // Entrada gratis (migración 143): acá no hay nada que hacer — no se transfiere
  // ni se sube comprobante. La puerta es el botón «Unirme» de la polla. Se cierra
  // el camino, no solo el botón: un enlace viejo o guardado traía de vuelta la
  // pantalla que pedía el pantallazo de una transferencia de $0.
  if (polla.entry_price_cop === 0 && polla.kind !== "rifa") redirect(`/polla/${polla.slug}`);

  const [entries, pot, invitee, referral] = await Promise.all([
    polla.kind === "rifa" ? Promise.resolve([] as CasaEntry[]) : getMyEntries(polla.id, user.id),
    getPot(polla.id),
    // Invitaciones (migración 135): solo personas nuevas, antes del primer pago aprobado.
    getReferralInvitee(user.id, validReferralCode((await cookies()).get(REFERRAL_COOKIE)?.value)),
    // Cupo gratis por invitar (migración 144): si tiene saldo y esta polla lo recibe.
    polla.kind === "rifa" ? Promise.resolve(null) : getReferralPollaView(user.id, polla.id),
  ]);
  const { boleta, participacion } = await searchParams;

  // ── Qué participación se paga (migración 131) ─────────────────────────────
  // Cada participación es su propia transferencia y su propio comprobante.
  //   ?participacion=nueva → una participación más (tope por persona).
  //   ?participacion=N     → completar/reintentar la N (rechazada o sin comprobante).
  //   sin parámetro        → lo de siempre: retomar la que falte o entrar por primera vez.
  // Una participación pagada o en revisión no tiene nada que hacer acá.
  // `anulada` (se cayó la subida) SÍ puede volver a intentar: SQL reusa esa fila.
  const retryable = (e: CasaEntry) => e.status === "rechazada" || e.status === "anulada" || (e.status === "pendiente" && !e.proof_path);
  const maxEntries = polla.max_entries_per_user ?? DEFAULT_MAX_ENTRIES_PER_USER;
  const counted = entries.filter((e) => e.status !== "anulada").length;
  let target: CasaEntry | null = null;
  let isAnother = false;
  if (polla.kind !== "rifa") {
    if (participacion === "nueva") {
      isAnother = entries.some(isLiveEntry) || entries.some((e) => e.status === "rechazada");
      if (isAnother && counted >= maxEntries) {
        return <div className="px-4 py-6"><StreetCard className="space-y-4 p-4">
          <h1 className="lp-display text-[30px] [overflow-wrap:anywhere]">Llegaste al máximo</h1>
          <p className="text-[15px] text-text-secondary">Puedes tener hasta {maxEntries} cupos en {polla.name}. Si alguno fue rechazado, envía de nuevo su comprobante desde la polla.</p>
          <Link className="lp-btn lp-btn-primary w-full" href={`/polla/${polla.slug}`}>Ver mis cupos</Link>
        </StreetCard></div>;
      }
      // Una carga fallida o rechazada sin otras participaciones se retoma en su propia fila.
      if (!isAnother) target = entries.find(retryable) ?? null;
    } else if (participacion && /^\d{1,2}$/.test(participacion)) {
      target = entries.find((e) => e.entry_number === Number(participacion)) ?? null;
      if (!target) redirect(`/polla/${polla.slug}`);
      if (isLiveEntry(target)) redirect(`/polla/${polla.slug}?p=${target.entry_number}`);
    } else {
      target = entries.find(retryable) ?? null;
      if (!target && entries.some(isLiveEntry)) redirect(`/polla/${polla.slug}`);
    }
  }
  let recovering = Boolean(target);
  let rejected = target?.status === "rechazada";
  let rejectReason = target?.reject_reason;
  // Número que verá la persona: el de la fila que retoma, o el siguiente libre.
  const shownNumber = target?.entry_number
    ?? entries.find((e) => e.status === "anulada")?.entry_number
    ?? (entries.reduce((max, e) => Math.max(max, e.entry_number ?? 0), 0) + 1);
  const showNumber = polla.kind !== "rifa" && (isAnother || entries.length > 1 || shownNumber > 1);
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
        <Link className="lp-btn lp-btn-primary w-full" href={inReview ? `/polla/${polla.slug}` : `/polla/${polla.slug}/pagar?boleta=${waiting.ticket_number}`}>{inReview ? "Ver mi rifa" : "Retomar comprobante"}</Link>
      </StreetCard></div>;
    }
  }
  const resumeOnly = !isPollaOpen(polla);
  if (resumeOnly) {
    const active = await getActiveProofs(polla.id, user.id);
    if (!active.some((proof) => polla.kind !== "rifa" ? proof.entry_id === target?.id : String(proof.ticket_number) === boleta)) redirect(`/polla/${polla.slug}`);
  }

  const entrada = polla.entry_price_cop;
  if (pot.entry_prize_cop === undefined || pot.entry_house_cop === undefined || pot.projected_prize_cop === undefined) throw new Error("No se pudo leer el desglose de la entrada.");
  const alPozo = pot.entry_prize_cop;


  return (
    <div className="pb-28">
      <HeroFrame height="min-h-[168px]">
        <Label>{recovering && showNumber ? `Cupo ${shownNumber}` : isAnother ? "Más cupos en" : "Entrar a"}</Label>
        <h1 className="lp-display mt-1 text-[30px] [overflow-wrap:anywhere]">{polla.name}</h1>
      </HeroFrame>

      <div className="space-y-4 px-4 pt-5">
        {/* (2026-09-19, segunda tanda de «menos texto») En esta pantalla la gente
            PAGA: solo quedan las frases que evitan un error con plata (no repetir la
            transferencia, monto exacto, cuenta correcta). Cómo se gana, el empate y
            cómo crece el pozo viven en Info; aquí hay un enlace. grok y muse
            coincidieron: recortar de más acá sale más caro que una frase corta. */}
        {rejected ? <p className="text-[15px] text-text-secondary">Comprobante rechazado. {rejectReason} Revísalo antes de transferir otra vez.</p>
          : recovering && <p className="text-[15px] text-text-secondary">Si ya transferiste, solo completa el comprobante. No repitas el pago.</p>}
        {/* Antes de hablar de plata: si tiene un cupo gratis por invitar, puede
            entrar sin transferir. No aplica cuando está completando un comprobante. */}
        {referral?.can_redeem && !recovering && !resumeOnly && (
          <UsarCupoGratis slug={polla.slug} disponibles={referral.available} />
        )}
        {/* Qué pasa con tu plata. Explícito, sin letra chica. */}
        <StreetCard className="p-4">
          <div className="flex items-end justify-between">
            <div>
              <Label>{recovering ? "Valor del cupo" : "Valor de cada cupo"}</Label>
              <div className="lp-money mt-1 text-[34px] leading-none text-gold">
                {formatCop(entrada)}
              </div>
            </div>
          </div>
          {polla.prize_kind === "objeto" ? <p className="mt-4 text-[15px] leading-relaxed text-text-secondary [overflow-wrap:anywhere]">Premio: <strong className="text-text-primary">{polla.prize_object}</strong></p> : polla.pot_mode === "fijo" ? <div className="mt-4 space-y-1.5 border-t border-border-subtle pt-3 text-[13px]">
            {/* Mínimo garantizado (migración 109). Las cifras salen de casa_payment_details_v2.
                Filas como las del pozo proporcional: cifras, no prosa. */}
            <div className="flex justify-between gap-3">
              <span className="text-text-secondary">Pozo hoy</span>
              <span className="lp-money text-text-primary">{formatCop(pot.prize_cop)}</span>
            </div>
            {typeof polla.fixed_prize_cop === "number" && <div className="flex justify-between gap-3">
              <span className="text-text-secondary">Mínimo garantizado</span>
              <span className="lp-money text-text-primary">{formatCop(polla.fixed_prize_cop)}</span>
            </div>}
            {pot.projected_prize_cop > pot.prize_cop && <div className="flex justify-between gap-3 border-t border-border-subtle pt-1.5">
              <span className="text-text-secondary">Pozo si entras</span>
              <span className="lp-money text-text-primary">{formatCop(pot.projected_prize_cop)}</span>
            </div>}
          </div> : <div className="mt-4 space-y-1.5 border-t border-border-subtle pt-3 text-[13px]">
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
          <Link href={`/polla/${polla.slug}#info-premio`} className="mt-2 inline-flex min-h-11 items-center gap-0.5 text-[13px] font-semibold text-text-secondary underline-offset-4 transition-colors hover:text-text-primary hover:underline">
            Cómo se gana <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0" />
          </Link>
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
            {/* Número + Copiar en una fila; con texto ampliado el botón baja de línea. */}
            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <div id="copiar-numero" className="lp-money min-w-0 select-all text-[26px] leading-none text-text-primary [overflow-wrap:anywhere]">
                {polla.payout_account}
              </div>
              <CopiarDato valor={polla.payout_account} etiqueta="numero" />
            </div>
            {polla.payout_account_name && (
              <p className="mt-2 text-[13px] text-text-secondary">
                A nombre de{" "}
                <span className="text-text-primary">{polla.payout_account_name}</span>
              </p>
            )}
            <p className="mt-3 border-t border-border-subtle pt-3 text-[12px] text-text-muted">
              {recovering ? "El comprobante debe ser de esta cuenta." : <>Transfiere exactamente {formatCop(entrada)}.</>}
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

        {invitee?.can_set_referrer && !resumeOnly && <QuienTeInvito initial={invitee} variant="pagar" />}

        {polla.kind !== "rifa" && !recovering && !resumeOnly ? (
          <CuposForm slug={polla.slug} entryPriceCop={polla.entry_price_cop}
            available={Math.max(1, maxEntries - counted)} another={isAnother} />
        ) : <PagarForm resumeOnly={resumeOnly}
          slug={polla.slug}
          esRifa={polla.kind === "rifa"}
          ticketCount={polla.ticket_count}
          initialTicket={boleta && /^\d+$/.test(boleta) && Number(boleta) <= (polla.ticket_count ?? 0) ? boleta : ""}
          entryNumber={polla.kind === "rifa" ? undefined : target?.entry_number ?? null}
        />}

        <p className="text-center text-[12px] leading-relaxed text-text-muted">Revisamos tu comprobante y te avisamos.</p>
      </div>
    </div>
  );
}
