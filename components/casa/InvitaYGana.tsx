"use client";

// components/casa/InvitaYGana.tsx — la regla de invitaciones junto a Compartir (migración 135).
//
// Pedido del dueño (2026-09-17): algo pequeño en Compartir que diga «por cada 5
// invitados en esta polla, tienes un cupo extra gratis», sin listas de
// condiciones: una frase, el avance, el código y una sola letra menuda. Las
// cifras salen de casa_referral_polla_view_v1; aquí solo se formatean.
// Oculto en la app de iOS, como en Perfil.

import { ChevronDown, Gift } from "lucide-react";
import type { ReferralPollaView } from "@/lib/casa/types";
import { REFERRAL_FINE_PRINT, referralMissing } from "@/lib/casa/referrals-shared";
import { useIsIOSApp } from "@/components/platform/PlatformProvider";
import { CopiarDato } from "./CopiarDato";

export function InvitaYGana({ view, every }: { view: ReferralPollaView; every: number }) {
  const isIOSApp = useIsIOSApp();
  const { counted, in_review: enRevision, gifts: ganados, waiting_gifts: esperando, active_gifts: activos, owner_paid: pagado, slots_left: espacio, code } = view;
  if (isIOSApp) return null;
  const avance = counted % every;
  const faltan = referralMissing(counted, every);
  const estado = ganados > 0
    ? `Ganaste ${ganados === 1 ? "1 cupo" : `${ganados} cupos`}. Te faltan ${faltan} para el siguiente.`
    : `Te faltan ${faltan} para tu cupo.`;

  return (
    <details className="lp-card mt-3 overflow-hidden">
      <summary className="flex min-h-12 cursor-pointer list-none items-start gap-3 px-3 py-2.5 transition-colors hover:bg-bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold [&::-webkit-details-marker]:hidden">
        <Gift aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-turf" />
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          <span className="block text-[15px] font-semibold leading-snug text-text-primary">
            {every === 1 ? "Por cada invitado" : `Por cada ${every} invitados`}, te damos un cupo*
          </span>
          <span className="mt-0.5 block text-[13px] tabular-nums leading-snug text-text-secondary">
            {ganados > 0 ? `${ganados === 1 ? "1 cupo ganado" : `${ganados} cupos ganados`} · ${counted} invitados` : `Llevas ${avance} de ${every}`}
          </span>
        </span>
        <ChevronDown aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-text-secondary transition-transform duration-200 [[open]>summary>&]:rotate-180" />
      </summary>

      <div className="space-y-3 border-t border-border-subtle px-3 pb-3 pt-3">
        <div className="flex gap-1" aria-hidden="true">
          {Array.from({ length: every }, (_, i) => (
            <span key={i} className={`h-1.5 min-w-0 flex-1 rounded-full ${i < avance ? "bg-turf" : "bg-border-default"}`} />
          ))}
        </div>
        <p className="text-[15px] leading-relaxed text-text-primary">
          {estado}{enRevision > 0 && <span className="text-text-secondary"> (+{enRevision} en revisión)</span>}
        </p>
        {activos > 0 && <p className="text-[13px] font-semibold text-turf">Tu cupo de regalo ya está en Tus cupos.</p>}
        {esperando > 0 && !pagado && <p className="text-[13px] font-semibold text-amber">Tu cupo aparece cuando confirmemos tu pago en esta polla.</p>}
        {esperando > 0 && pagado && espacio === 0 && <p className="text-[13px] font-semibold text-amber">Llegaste al máximo de cupos de esta polla.</p>}

        {code && (
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-md border border-dashed border-border-strong px-3 py-2">
            <div className="min-w-0">
              <span className="lp-label">Tu código</span>
              <span id="copiar-codigo" className="lp-money mt-0.5 block select-all text-[22px] leading-none text-text-primary [overflow-wrap:anywhere]">{code}</span>
            </div>
            <CopiarDato valor={code} etiqueta="codigo" nombre="tu código" />
          </div>
        )}
        <p className="text-[13px] italic text-text-muted">{REFERRAL_FINE_PRINT}</p>
      </div>
    </details>
  );
}
