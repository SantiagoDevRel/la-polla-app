"use client";

// components/casa/InvitaYGana.tsx — la regla de invitaciones junto a Compartir (migración 135).
//
// Pedido del dueño (2026-09-17): algo pequeño en Compartir que diga «por cada 5
// invitados en esta polla, tienes un cupo extra gratis», sin listas de
// condiciones: una frase, el avance, el código y una sola letra menuda. Las
// cifras salen de casa_referral_polla_view_v1; aquí solo se formatean.
// Oculto en la app de iOS, como en Perfil.
//
// (2026-09-18) De tarjeta a fila. Esto y «Comprar otro cupo» eran dos bloques a
// todo el ancho ENCIMA de los partidos: quien entraba a pronosticar bajaba una
// pantalla entera antes de ver el primero. Ahora comparten una fila de dos
// botones cortos (`leading` es el otro), y el detalle —avance, código, letra
// menuda— se abre debajo solo si alguien lo toca. La frase larga de la regla
// vive en Info → «Invita y gana cupos».
//
// (2026-09-19, migración 144) El avance es de la PERSONA, no de la polla: 5
// invitados en total = 1 cupo gratis para la polla que ella elija. El botón
// muestra siempre «N/5» camino al próximo cupo; el saldo se usa con
// <UsarCupoGratis>, no aquí.

import { useId, useState, type ReactNode } from "react";
import { ChevronDown, Gift } from "lucide-react";
import type { ReferralPollaView } from "@/lib/casa/types";
import { REFERRAL_FINE_PRINT, referralMissing, referralProgress } from "@/lib/casa/referrals-shared";
import { useIsIOSApp } from "@/components/platform/PlatformProvider";
import { CopiarDato } from "./CopiarDato";

export function InvitaYGana({ view, every, leading = null }: {
  /** null = sin invitaciones en esta polla: solo se dibuja `leading`. */
  view: ReferralPollaView | null;
  every: number | null;
  /** El otro botón de la fila (comprar otro cupo). */
  leading?: ReactNode;
}) {
  const isIOSApp = useIsIOSApp();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const invita = !isIOSApp && view && every ? { view, every } : null;
  if (!invita && !leading) return null;

  const avance = invita ? referralProgress(invita.view.counted, invita.every, invita.view.available) : 0;

  return (
    <div className="mt-4 first:mt-0">
      {/* flex-wrap: con texto ampliado cada botón baja a su propia fila. */}
      <div className="flex flex-wrap gap-2">
        {leading}
        {invita && (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls={panelId}
            className="lp-btn lp-btn-ghost min-w-0 flex-[1_1_150px] gap-2 !px-3"
          >
            <Gift aria-hidden="true" className="h-5 w-5 max-w-none shrink-0 text-turf" />
            <span className="min-w-0 [overflow-wrap:anywhere]">Invita</span>
            <span className="lp-money shrink-0 text-[15px] tabular-nums text-text-secondary" aria-label={`Llevas ${avance} de ${invita.every} invitados`}>
              {avance}/{invita.every}
            </span>
            <ChevronDown aria-hidden="true" className={`h-4 w-4 max-w-none shrink-0 text-text-secondary transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>

      {invita && open && <InvitaDetalle id={panelId} view={invita.view} every={invita.every} />}
    </div>
  );
}

function InvitaDetalle({ id, view, every }: { id: string; view: ReferralPollaView; every: number }) {
  const { counted, in_review: enRevision, available: disponibles, waiting_gifts: esperando, code } = view;
  const avance = referralProgress(counted, every, disponibles);
  const faltan = referralMissing(counted, every);
  const estado = disponibles > 0
    ? `Tienes ${disponibles === 1 ? "1 cupo gratis" : `${disponibles} cupos gratis`} por usar.`
    : `Te ${faltan === 1 ? "falta 1 invitado" : `faltan ${faltan} invitados`} para tu cupo gratis.`;

  return (
    <div id={id} className="lp-card mt-2 space-y-3 p-3">
      <p className="text-[15px] font-semibold leading-snug text-text-primary">
        {every === 1 ? "1 invitado" : `${every} invitados`} = 1 cupo gratis*
      </p>
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 gap-1" aria-hidden="true">
          {Array.from({ length: every }, (_, i) => (
            <span key={i} className={`h-2 min-w-0 flex-1 rounded-full ${i < avance ? "bg-turf" : "bg-border-default"}`} />
          ))}
        </div>
        <span className="lp-money shrink-0 text-[15px] tabular-nums text-text-primary">{avance}/{every}</span>
      </div>
      <p className="text-[15px] leading-relaxed text-text-primary">
        {estado}{enRevision > 0 && <span className="text-text-secondary"> (+{enRevision} en revisión)</span>}
      </p>
      {esperando > 0 && <p className="text-[13px] font-semibold text-amber">Llegaste al máximo de cupos de esta polla.</p>}

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
  );
}
