"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarDays, ChevronDown, Clock3, ImageOff, LockKeyhole, Trophy } from "lucide-react";
import { AvisoDesempate } from "@/components/casa/AvisoDesempate";
import { formatCop } from "@/lib/casa/format";

export interface PrivateCampaignSlot {
  slot_id: string;
  order: number;
  stage: string;
  stage_label: string;
  group: string | null;
  matchday: number | null;
  game_in_group_matchday: number | null;
  leg: string | number | null;
  label: string;
  home_label: string;
  away_label: string;
}

interface PrivateCampaignPreviewProps {
  polla: {
    id: string;
    name: string;
    description: string | null;
    entry_price_cop: number;
    prize_object: string | null;
  };
  slots: readonly PrivateCampaignSlot[];
  imageUrl: string;
  presentation: {
    competitionLabel: string;
    tagline: string;
    prizeCaption: string;
    imageAlt: string;
  };
}

const PICK_OPTIONS = [
  { key: "L", result: "1", label: "Gana el local" },
  { key: "E", result: "X", label: "Empate" },
  { key: "V", result: "2", label: "Gana el visitante" },
] as const;

/** Private presentation only. The calling page and image route enforce admin access. */
export function PrivateCampaignPreview({ polla, slots, imageUrl, presentation }: PrivateCampaignPreviewProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const orderedSlots = [...slots].sort((a, b) => a.order - b.order);
  const groupSlots = orderedSlots.filter((slot) => slot.stage === "cuadrangulares");
  const finalSlots = orderedSlots.filter((slot) => slot.stage === "final");
  const matchdays = [...new Set(groupSlots.flatMap((slot) => slot.matchday === null ? [] : [slot.matchday]))].sort((a, b) => a - b);
  const groupNames = [...new Set(groupSlots.flatMap((slot) => slot.group === null ? [] : [slot.group]))].sort();

  return (
    <div
      data-private-campaign={polla.id}
      className="space-y-5 px-4 pb-8 pt-3 font-body"
    >
      <Link href="/admin/pollas" className="inline-flex min-h-11 items-center gap-2 text-[15px] font-medium leading-[1.45] text-text-secondary transition-colors duration-200 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold">
        <ArrowLeft className="h-5 w-5 shrink-0" aria-hidden="true" /> Administrar pollas
      </Link>

      <div className="flex items-start gap-3 rounded-md border border-border-strong bg-bg-card/90 p-3 text-text-primary">
        <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-[15px] font-semibold leading-[1.45]">Borrador privado</p>
          <p className="mt-0.5 text-[13px] leading-[1.5] text-text-secondary">Solo administradores · Inscripciones deshabilitadas</p>
        </div>
      </div>

      <section aria-labelledby="campaign-title" className="lp-card overflow-hidden bg-gradient-to-b from-bg-base/95 via-bg-card/90 to-bg-card/80">
        <div className="px-5 pt-5 text-center">
          <p className="text-[13px] font-medium leading-[1.5] text-text-secondary">{presentation.competitionLabel}</p>
          <h1 id="campaign-title" className="lp-display mt-2 font-normal [overflow-wrap:anywhere]">{polla.name}</h1>
          <p className="mt-3 text-[15px] font-medium leading-[1.45] text-text-secondary">{presentation.tagline}</p>
        </div>

        <div className="relative mx-auto flex min-h-[288px] w-full items-center justify-center px-5 py-4">
          {imageFailed ? (
            <div role="status" className="flex min-h-[256px] max-w-64 flex-col items-center justify-center gap-3 text-center text-text-secondary">
              <ImageOff className="h-8 w-8" aria-hidden="true" />
              <p className="text-[15px] leading-[1.45]">No se pudo cargar la foto del premio.</p>
            </div>
          ) : (
            // The original Apple product image is already small and remains behind admin auth.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt={presentation.imageAlt}
              width={653}
              height={915}
              loading="eager"
              decoding="async"
              ref={(image) => {
                // A failed server-rendered image can finish before hydration attaches onError.
                if (image?.complete && image.naturalWidth === 0) setImageFailed(true);
              }}
              onError={() => setImageFailed(true)}
              className="h-[288px] w-full max-w-[288px] object-contain mix-blend-lighten"
            />
          )}
        </div>

        <div className="px-5 pb-5 text-center">
          <p className="font-display text-[30px] font-normal leading-[1.1] tracking-[0.04em] text-gold [overflow-wrap:anywhere]">{polla.prize_object ?? "Premio por confirmar"}</p>
          <p className="mt-2 text-[13px] leading-[1.5] text-text-secondary">{presentation.prizeCaption}</p>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-x-5 gap-y-3 border-t border-border-default pt-4 text-left">
            <div>
              <p className="text-[13px] font-medium leading-[1.5] text-text-secondary">Entrada por persona</p>
              <p className="lp-money mt-1 text-[40px] font-normal text-text-primary">{formatCop(polla.entry_price_cop)}</p>
            </div>
            <div className="min-w-0 text-[15px] leading-[1.45] text-text-secondary">
              <p className="font-semibold text-text-primary">{slots.length} partidos · 1X2</p>
              <p>Cuadrangulares y final</p>
            </div>
          </div>
        </div>
      </section>

      <div className="overflow-hidden rounded-xl rounded-tl-sm">
        <AvisoDesempate />
      </div>

      <section aria-labelledby="campaign-rules" className="lp-card p-4">
        <h2 id="campaign-rules" className="font-display text-[24px] font-normal leading-[1.1] tracking-[0.04em] text-text-primary">Elige el resultado · 1X2</h2>
        <dl className="mt-4 space-y-2">
          {PICK_OPTIONS.map((option) => (
            <div key={option.key} className="flex min-w-0 items-center gap-3 rounded-md border border-border-default bg-bg-subtle/70 px-3 py-2">
              <dt className="min-w-7 shrink-0 font-display text-[30px] font-normal leading-none tracking-[0.04em] text-text-primary">{option.key}</dt>
              <dd className="flex min-w-0 flex-1 items-center justify-between gap-3 text-[13px] leading-[1.5] text-text-secondary"><span className="min-w-0 [overflow-wrap:anywhere]">{option.label}</span><span className="shrink-0 font-semibold text-text-primary">{option.result}</span></dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[13px] leading-[1.5] text-text-secondary">1 acierto = 1 punto</p>
      </section>

      <section aria-labelledby="campaign-schedule">
        <div className="mb-4">
          <h2 id="campaign-schedule" className="font-display text-[26px] font-normal leading-[1.1] tracking-[0.04em] text-text-primary">El camino al premio</h2>
          <p className="mt-2 text-[15px] leading-[1.45] text-text-secondary">{groupNames.length} grupos · Final de ida y vuelta</p>
          <p className="mt-2 text-[13px] leading-[1.5] text-text-secondary">Equipos y calendario por confirmar.</p>
        </div>

        {slots.length === 0 ? (
          <div className="lp-card p-5 text-center">
            <CalendarDays className="mx-auto h-7 w-7 text-text-secondary" aria-hidden="true" />
            <h3 className="mt-3 font-display text-[24px] font-normal leading-[1.1] tracking-[0.04em] text-text-primary">Calendario pendiente</h3>
            <p className="mt-2 text-[15px] leading-[1.45] text-text-secondary">Todavía no hay partidos preparados para esta vista previa.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {matchdays.map((matchday, index) => {
              const daySlots = groupSlots.filter((slot) => slot.matchday === matchday);
              const groups = [...new Set(daySlots.flatMap((slot) => slot.group === null ? [] : [slot.group]))].sort();
              return (
                <details key={matchday} open={index === 0} className="group/day lp-card overflow-hidden" data-campaign-matchday={matchday}>
                  <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 p-4 transition-colors duration-200 hover:bg-bg-elevated/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold [&::-webkit-details-marker]:hidden">
                    <CalendarDays className="h-5 w-5 shrink-0 text-text-secondary" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <h3 className="text-[15px] font-semibold leading-[1.45] text-text-primary [overflow-wrap:anywhere]">Fecha {matchday}</h3>
                      <p className="mt-0.5 text-[13px] leading-[1.5] text-text-secondary [overflow-wrap:anywhere]">Cuadrangulares · {daySlots.length} partidos</p>
                    </div>
                    <ChevronDown className="h-5 w-5 shrink-0 text-text-secondary transition-transform duration-200 group-open/day:rotate-180" aria-hidden="true" />
                  </summary>
                  <div className="space-y-5 border-t border-border-default p-3">
                    {groups.map((group) => (
                      <section key={group} aria-labelledby={`campaign-day-${matchday}-group-${group}`}>
                        <h4 id={`campaign-day-${matchday}-group-${group}`} className="mb-2 px-1 font-display text-[20px] font-normal leading-[1.1] tracking-[0.04em] text-text-primary">Grupo {group}</h4>
                        <ol className="space-y-2">
                          {daySlots.filter((slot) => slot.group === group).map((slot) => <PlanningMatch key={slot.slot_id} slot={slot} />)}
                        </ol>
                      </section>
                    ))}
                  </div>
                </details>
              );
            })}
            {finalSlots.length > 0 && (
              <section aria-labelledby="campaign-final" className="lp-card overflow-hidden">
                <div className="flex items-center gap-3 border-b border-border-default p-4">
                  <Trophy className="h-5 w-5 shrink-0 text-text-secondary" aria-hidden="true" />
                  <div className="min-w-0">
                    <h3 id="campaign-final" className="font-display text-[24px] font-normal leading-[1.1] tracking-[0.04em] text-text-primary">La gran final</h3>
                    <p className="mt-1 text-[13px] leading-[1.5] text-text-secondary">Los ganadores de los grupos disputan el título.</p>
                  </div>
                </div>
                <ol className="space-y-2 p-3">
                  {finalSlots.map((slot) => <PlanningMatch key={slot.slot_id} slot={slot} />)}
                </ol>
              </section>
            )}
          </div>
        )}
      </section>

      <details className="group/description lp-card">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 p-4 text-[15px] font-semibold leading-[1.45] text-text-primary transition-colors duration-200 hover:bg-bg-elevated/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold [&::-webkit-details-marker]:hidden">
          Info de la polla
          <ChevronDown className="h-5 w-5 shrink-0 text-text-secondary transition-transform duration-200 group-open/description:rotate-180" aria-hidden="true" />
        </summary>
        <div className="space-y-4 border-t border-border-default p-4 text-[15px] leading-[1.45] text-text-secondary [overflow-wrap:anywhere]">
          <section>
            <h3 className="font-semibold text-text-primary">Qué marcador cuenta</h3>
            <p className="mt-1">El resultado de los 90 minutos más adición, sin alargue ni penales. Cada partido de ida y vuelta se pronostica por separado.</p>
          </section>
          <section>
            <h3 className="font-semibold text-text-primary">Cómo se gana</h3>
            <p className="mt-1">Cada acierto suma 1 punto. Gana el mayor puntaje; si hay empate, decide la fecha y hora de inscripción. Solo participan las inscripciones con pago aprobado.</p>
          </section>
          <section>
            <h3 className="font-semibold text-text-primary">Partidos por confirmar</h3>
            <p className="mt-1">Esta es la estructura del borrador. Los pronósticos se habilitarán cuando se confirmen los equipos y el calendario.</p>
          </section>
          {polla.description && <section>
            <h3 className="font-semibold text-text-primary">Descripción</h3>
            <p className="mt-1 whitespace-pre-line">{polla.description}</p>
          </section>}
        </div>
      </details>
    </div>
  );
}

function PlanningMatch({ slot }: { slot: PrivateCampaignSlot }) {
  return (
    <li data-campaign-slot={slot.slot_id} className="rounded-md border border-border-subtle bg-bg-subtle/70 p-3 transition-colors duration-200 hover:border-border-strong">
      <p className="text-[13px] font-semibold leading-[1.5] text-text-primary">{slot.stage === "final" ? slot.label : `Partido ${slot.game_in_group_matchday ?? slot.order}`}</p>
      <div className="mt-3 space-y-2 text-[15px] leading-[1.45] text-text-secondary">
        <p className="min-w-0 [overflow-wrap:anywhere]">{slot.home_label}</p>
        <p className="min-w-0 [overflow-wrap:anywhere]">{slot.away_label}</p>
      </div>
      <div className="mt-3 flex items-start gap-2 text-[13px] leading-[1.5] text-text-secondary">
        <Clock3 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>Fecha y hora por confirmar</p>
      </div>
    </li>
  );
}
