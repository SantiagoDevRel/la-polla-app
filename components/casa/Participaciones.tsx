"use client";

// components/casa/Participaciones.tsx — "Tus cupos" en una polla.
//
// Migración 131: una persona puede comprar varios cupos de la misma polla. Cada
// cupo tiene sus propios pronósticos, su propia transferencia y su propio
// comprobante, que el administrador aprueba por separado.
//
// (2026-09-15) Un desplegable en vez de una fila de botones: con 5-10 cupos los
// botones ocupaban media pantalla. Debajo, el estado del cupo elegido en color
// (verde pagado, amarillo en revisión) y en rojo si le faltan pronósticos. El
// estado ya no se repite en cuadros aparte bajo la tarjeta.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { StreetCard } from "@/components/street";
import { formatCop } from "@/lib/casa/format";
import type { CasaEntry } from "@/lib/casa/types";

export type ParticipationState = "activa" | "revision" | "rechazada" | "sin-comprobante";

export function participationState(entry: Pick<CasaEntry, "status" | "proof_path">): ParticipationState {
  if (entry.status === "pagada") return "activa";
  if (entry.status === "pendiente" && entry.proof_path) return "revision";
  if (entry.status === "rechazada") return "rechazada";
  return "sin-comprobante";
}

const LABEL: Record<ParticipationState, string> = {
  activa: "Pagado",
  revision: "Pago en revisión",
  rechazada: "Pago rechazado",
  "sin-comprobante": "Falta el comprobante",
};

/** Color del estado de pago: verde pagado, amarillo en revisión. */
const PILL: Record<ParticipationState, string> = {
  activa: "border-turf/50 bg-turf/15 text-turf",
  revision: "border-amber/50 bg-amber/15 text-amber",
  rechazada: "border-red-alert/50 bg-red-alert/15 text-red-alert",
  "sin-comprobante": "border-amber/50 bg-amber/15 text-amber",
};

const faltanTexto = (n: number) => (n === 1 ? "falta 1 pronóstico" : `faltan ${n} pronósticos`);

/** Texto corto para el desplegable: cabe a 320 px; el detalle va en las etiquetas de color. */
const OPTION: Record<ParticipationState, string> = {
  activa: "Pagado",
  revision: "En revisión",
  rechazada: "Rechazado",
  "sin-comprobante": "Sin comprobante",
};

export function Participaciones({
  slug,
  entries,
  selectedNumber,
  maxEntries,
  entryPriceCop,
  open,
  pendingByNumber,
}: {
  slug: string;
  /** Cupos de la persona, por número. */
  entries: Array<Pick<CasaEntry, "entry_number" | "status" | "proof_path" | "reject_reason">>;
  selectedNumber: number | null;
  maxEntries: number;
  entryPriceCop: number;
  /** La polla sigue recibiendo inscripciones. */
  open: boolean;
  /** Pronósticos que todavía se pueden hacer y faltan, por número de cupo. `null` = no aplica (preguntas). */
  pendingByNumber: Record<number, number> | null;
}) {
  const router = useRouter();
  // Una carga fallida solo se muestra mientras se pueda reintentar.
  const visible = entries.filter((e) => e.entry_number != null && (open || e.status !== "anulada"));
  const counted = entries.filter((e) => e.status !== "anulada").length;
  const selected = visible.find((e) => e.entry_number === selectedNumber) ?? visible[0];
  if (!selected?.entry_number) return null;
  const state = participationState(selected);
  const pending = pendingByNumber?.[selected.entry_number] ?? 0;
  const otrosSinPronosticos = visible
    .filter((e) => e.entry_number !== selected.entry_number && (pendingByNumber?.[e.entry_number!] ?? 0) > 0)
    .map((e) => `#${e.entry_number}`);

  return (
    <StreetCard className="mt-4 p-4 first:mt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="lp-display-sm min-w-0 text-text-primary [overflow-wrap:anywhere]">Tus cupos</h2>
        <span className="text-[13px] tabular-nums text-text-secondary">{counted} de {maxEntries}</span>
      </div>

      <label htmlFor="elegir-cupo" className="mt-3 block text-[13px] text-text-secondary">
        Elige el cupo para ver o editar sus pronósticos
      </label>
      <div className="relative mt-2">
        <select
          id="elegir-cupo"
          value={selected.entry_number}
          onChange={(event) => router.push(`/casa/${slug}?p=${event.target.value}`, { scroll: false })}
          className="lp-input min-h-12 w-full cursor-pointer appearance-none pr-10 text-[15px] font-semibold"
        >
          {visible.map((entry) => {
            const faltan = pendingByNumber?.[entry.entry_number!] ?? 0;
            return (
              <option key={entry.entry_number} value={entry.entry_number!}>
                {`Cupo ${entry.entry_number} · ${OPTION[participationState(entry)]}${faltan > 0 ? ` · faltan ${faltan}` : ""}`}
              </option>
            );
          })}
        </select>
        <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-text-secondary" />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2" aria-live="polite">
        <span className={`inline-flex min-h-8 items-center rounded-full border px-3 text-[13px] font-semibold ${PILL[state]}`}>
          {LABEL[state]}
        </span>
        {pendingByNumber && (pending > 0 ? (
          <span className="inline-flex min-h-8 items-center gap-2 rounded-full border border-red-alert/50 bg-red-alert/10 px-3 text-[13px] font-semibold text-red-alert">
            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-red-alert" />
            Te {faltanTexto(pending)}
          </span>
        ) : (
          <span className="inline-flex min-h-8 items-center rounded-full border border-border-default px-3 text-[13px] text-text-secondary">
            Pronósticos al día
          </span>
        ))}
      </div>

      {state === "rechazada" && (
        <p className="mt-3 text-[13px] leading-relaxed text-red-alert">
          {selected.reject_reason ?? "Comunícate con el administrador."}
          {open && <> <Link href={`/casa/${slug}/pagar?participacion=${selected.entry_number}`} className="font-semibold underline">Enviar otro comprobante</Link></>}
        </p>
      )}
      {state === "sin-comprobante" && open && (
        <p className="mt-3 text-[13px] leading-relaxed text-amber">
          No alcanzamos a recibir la imagen de este cupo.{" "}
          <Link href={`/casa/${slug}/pagar?participacion=${selected.entry_number}`} className="font-semibold underline">Subir el comprobante</Link>
        </p>
      )}
      {otrosSinPronosticos.length > 0 && (
        <p className="mt-3 text-[13px] leading-relaxed text-red-alert">
          También te faltan pronósticos en {otrosSinPronosticos.length === 1 ? "el cupo" : "los cupos"} {otrosSinPronosticos.join(", ")}.
        </p>
      )}

      <p className="mt-3 border-t border-border-subtle pt-3 text-[13px] leading-relaxed text-text-muted">
        Puedes pronosticar y guardar aunque el pago esté en revisión: cuando lo aprobemos, los puntos de ese cupo se verán reflejados en la tabla.
        {open && counted < maxEntries && <> Cada cupo nuevo necesita su propia transferencia de {formatCop(entryPriceCop)}.</>}
        {open && counted >= maxEntries && <> Llegaste al máximo de {maxEntries} cupos.</>}
      </p>
    </StreetCard>
  );
}
