"use client";

// components/casa/InvitaYGana.tsx — la regla de invitaciones junto a Compartir (migración 135).
//
// Pedido del dueño (2026-09-17): algo pequeño en Compartir que diga «por cada 5
// invitados en esta polla, tienes un cupo extra gratis». En el celular no hay
// hover, así que es una línea visible que se despliega con el avance, el código
// y las condiciones. Las cifras salen de casa_referral_polla_view_v1; aquí solo
// se formatean.

import { ChevronDown, Gift } from "lucide-react";
import type { ReferralPollaView } from "@/lib/casa/types";
import { referralMissing } from "@/lib/casa/referrals-shared";
import { CopiarDato } from "./CopiarDato";

const cupos = (n: number) => `${n} ${n === 1 ? "cupo" : "cupos"}`;

export function InvitaYGana({ view, every }: { view: ReferralPollaView; every: number }) {
  const { counted, in_review: enRevision, earned, active_gifts: activos, removed_gifts: removidos, owner_paid: pagado, slots_left: espacio, code } = view;
  const avance = counted % every;
  const faltan = referralMissing(counted, every);
  const esperando = Math.max(earned - removidos - activos, 0);

  return (
    <details className="lp-card mt-3 overflow-hidden">
      <summary className="flex min-h-12 cursor-pointer list-none items-start gap-3 px-3 py-2.5 transition-colors hover:bg-bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold [&::-webkit-details-marker]:hidden">
        <Gift aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-turf" />
        {/* El avance va en su propio renglón: al lado de la regla se apretaba a 320 px. */}
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          <span className="block text-[13px] leading-snug text-text-secondary">
            Por cada {every} {every === 1 ? "invitado nuevo" : "invitados nuevos"} en esta polla, te regalamos un cupo.
          </span>
          <span className="mt-0.5 block text-[13px] font-semibold tabular-nums leading-snug text-text-primary">
            {earned > 0
              ? `${cupos(earned)} ${earned === 1 ? "ganado" : "ganados"} · ${counted} ${counted === 1 ? "invitado" : "invitados"}`
              : `Llevas ${avance} de ${every}`}
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
          {counted === 0
            ? "Todavía no tienes invitados con pago aprobado en esta polla."
            : `${counted} ${counted === 1 ? "invitado" : "invitados"} con pago aprobado${earned > 0 ? `: ${earned === 1 ? "ganaste 1 cupo" : `ganaste ${earned} cupos`}` : ""}.`}{" "}
          {earned > 0
            ? `Para el siguiente ${faltan === 1 ? "te falta 1" : `te faltan ${faltan}`}.`
            : faltan === 1 ? "Te falta 1 para tu cupo de regalo." : `Te faltan ${faltan} para tu cupo de regalo.`}
          {enRevision > 0 && ` ${enRevision} más con el pago en revisión.`}
        </p>

        {activos > 0 && (
          <p className="rounded-md border border-turf/40 bg-turf/10 p-2.5 text-[13px] leading-relaxed text-text-primary">
            Tienes {cupos(activos)} de regalo {activos === 1 ? "activo" : "activos"}: {activos === 1 ? "lo ves" : "los ves"} en Tus cupos, en la pestaña Partidos.
          </p>
        )}
        {esperando > 0 && !pagado && (
          <p className="rounded-md border border-amber/40 bg-amber/10 p-2.5 text-[13px] leading-relaxed text-text-primary">
            Ya ganaste {cupos(esperando)} de regalo. {esperando === 1 ? "Aparece" : "Aparecen"} cuando confirmemos el pago de tu cupo en esta polla.
          </p>
        )}
        {esperando > 0 && pagado && espacio === 0 && (
          <p className="rounded-md border border-amber/40 bg-amber/10 p-2.5 text-[13px] leading-relaxed text-text-primary">
            Ya ganaste {cupos(esperando)} de regalo, pero llegaste al máximo de cupos de esta polla.
          </p>
        )}

        {code && (
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-md border border-border-default px-3 py-2">
            <div className="min-w-0">
              <span className="lp-label">Tu código</span>
              <span id="copiar-codigo" className="lp-money mt-0.5 block select-all text-[22px] leading-none text-text-primary [overflow-wrap:anywhere]">{code}</span>
            </div>
            <CopiarDato valor={code} etiqueta="codigo" />
          </div>
        )}

        <ul className="list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-text-secondary marker:text-text-muted">
          <li>Cuenta quien crea su cuenta con tu enlace o tu código y paga esta polla como su primera polla.</li>
          <li>Cada persona cuenta una sola vez. En otra polla el conteo empieza de cero.</li>
          <li>El cupo de regalo aparece solo y compite como cualquier cupo; no suma dinero al pozo.</li>
          <li>Necesitas tu propio cupo pagado en esta polla, antes o después de que paguen tus invitados.</li>
        </ul>
      </div>
    </details>
  );
}
