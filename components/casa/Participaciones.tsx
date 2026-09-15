// components/casa/Participaciones.tsx — "Tus participaciones" en una polla.
//
// Migración 131: una persona puede entrar varias veces a la misma polla. Cada
// participación es una opción más de ganar, con sus propios pronósticos, su
// propia transferencia y su propio comprobante, que el administrador aprueba
// por separado. Aquí se elige cuál se está viendo (?p=N) y se suma otra.
//
// Sin JavaScript de cliente: son enlaces, así la página del servidor carga los
// pronósticos de la participación elegida y el botón atrás funciona.

import Link from "next/link";
import { Plus } from "lucide-react";
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
  activa: "Activa",
  revision: "En revisión",
  rechazada: "Rechazada",
  "sin-comprobante": "Sin comprobante",
};

const DOT: Record<ParticipationState, string> = {
  activa: "bg-turf",
  revision: "bg-amber",
  rechazada: "bg-red-alert",
  "sin-comprobante": "bg-amber",
};

export function Participaciones({
  slug,
  entries,
  selectedNumber,
  maxEntries,
  entryPriceCop,
  open,
}: {
  slug: string;
  /** Participaciones de la persona, por número. */
  entries: Array<Pick<CasaEntry, "entry_number" | "status" | "proof_path">>;
  selectedNumber: number | null;
  maxEntries: number;
  entryPriceCop: number;
  /** La polla sigue recibiendo inscripciones. */
  open: boolean;
}) {
  // Una carga fallida solo se muestra mientras se pueda reintentar.
  const visible = entries.filter((e) => e.entry_number != null && (open || e.status !== "anulada"));
  const counted = entries.filter((e) => e.status !== "anulada").length;
  const canAdd = open && counted < maxEntries;

  return (
    <StreetCard className="mt-4 p-4 first:mt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="lp-display-sm min-w-0 text-text-primary [overflow-wrap:anywhere]">Tus participaciones</h2>
        <span className="text-[13px] tabular-nums text-text-secondary">{counted} de {maxEntries}</span>
      </div>
      <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">
        Cada participación es una opción más de ganar, con sus propios pronósticos. Suma puntos cuando aprobamos su pago.
      </p>

      <nav aria-label="Elegir participación" className="mt-3">
        <ul className="flex flex-wrap gap-2">
          {visible.map((entry) => {
            const state = participationState(entry);
            const selected = entry.entry_number === selectedNumber;
            return (
              <li key={entry.entry_number}>
                <Link
                  href={`/casa/${slug}?p=${entry.entry_number}`}
                  scroll={false}
                  aria-current={selected ? "true" : undefined}
                  aria-label={`Participación ${entry.entry_number}: ${LABEL[state]}`}
                  className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 py-2 text-[15px] font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary active:scale-[0.98] ${
                    selected
                      ? "border-text-primary bg-bg-elevated text-text-primary"
                      : "border-border-default text-text-secondary hover:border-border-strong hover:bg-bg-elevated hover:text-text-primary"
                  }`}
                >
                  <span className="tabular-nums">#{entry.entry_number}</span>
                  <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${DOT[state]}`} />
                  <span className="text-[13px] font-medium">{LABEL[state]}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {canAdd ? (
        <>
          <Link href={`/casa/${slug}/pagar?participacion=nueva`} className="lp-btn lp-btn-ghost mt-4 w-full gap-2 !whitespace-normal text-center">
            <Plus aria-hidden="true" className="h-5 w-5 shrink-0" />
            Sumar otra participación por {formatCop(entryPriceCop)}
          </Link>
          <p className="mt-2 text-[13px] leading-relaxed text-text-muted">
            Cada una necesita su propia transferencia de {formatCop(entryPriceCop)} y su propio comprobante.
          </p>
        </>
      ) : open ? (
        <p className="mt-3 text-[13px] text-text-muted">Llegaste al máximo de {maxEntries} participaciones en esta polla.</p>
      ) : null}
    </StreetCard>
  );
}
