"use client";

// components/casa/Participaciones.tsx — "Tus cupos" en una polla.
//
// Migración 131: una persona puede comprar varios cupos de la misma polla. Cada
// cupo tiene sus propios pronósticos, su propia transferencia y su propio
// comprobante, que el administrador aprueba por separado.
//
// (2026-09-18) Rediseño pedido por el dueño, tras el desplegable del 15-09:
//   · Lista de filas tocables en vez de un <select>. Elegir cupo es una
//     decisión, y para decidir hay que poder comparar; el menú nativo mostraba
//     un cupo a la vez y se cortaba a 320 px.
//   · Cada fila dice DOS cosas: quién es (Cupo 2) y qué te falta. El pago solo
//     aparece cuando NO está resuelto: si ya está aprobado, el silencio es
//     «estás dentro», y un verde permanente solo le roba atención al rojo.
//   · El párrafo largo de abajo se fue a la (i) del título. Ver Ayuda.tsx.
//   · Con un solo cupo esta tarjeta no se dibuja: la polla muestra una franja
//     de una línea (la arma la página) y se acabó.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { StreetCard } from "@/components/street";
import { formatCop } from "@/lib/casa/format";
import { isCourtesyEntry } from "@/lib/casa/courtesies-shared";
import type { CasaEntry } from "@/lib/casa/types";
import { Ayuda } from "./Ayuda";

export type ParticipationState = "activa" | "regalo" | "cortesia" | "revision" | "rechazada" | "sin-comprobante";

export function participationState(
  entry: Pick<CasaEntry, "status" | "proof_path"> & Partial<Pick<CasaEntry, "origin" | "amount_cop">>,
): ParticipationState {
  // Cupo de regalo por invitar (migración 135): activo, sin comprobante.
  if (entry.origin === "invitacion") return "regalo";
  // Cupo de cortesía (migración 138): también activo, pero decir "Pagado" sería
  // falso — nadie pagó nada por él.
  if (isCourtesyEntry(entry)) return "cortesia";
  if (entry.status === "pagada") return "activa";
  if (entry.status === "pendiente" && entry.proof_path) return "revision";
  if (entry.status === "rechazada") return "rechazada";
  return "sin-comprobante";
}

/** Un cupo resuelto no dice nada del pago; los demás sí, y en su color. */
const PAGO: Partial<Record<ParticipationState, { texto: string; clase: string }>> = {
  revision: { texto: "En revisión", clase: "text-amber" },
  rechazada: { texto: "Pago rechazado", clase: "text-red-alert" },
  "sin-comprobante": { texto: "Falta el comprobante", clase: "text-amber" },
  regalo: { texto: "Regalo por invitar", clase: "text-text-secondary" },
  cortesia: { texto: "Cortesía", clase: "text-text-secondary" },
};

export const faltanTexto = (n: number) => (n === 1 ? "Te falta 1 pronóstico" : `Te faltan ${n} pronósticos`);

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
  /** Cupos de la persona, por número (los de regalo en pausa ya vienen filtrados). */
  entries: Array<Pick<CasaEntry, "entry_number" | "status" | "proof_path" | "reject_reason">
    & Partial<Pick<CasaEntry, "origin" | "amount_cop">>>;
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
  const quedan = Math.max(0, maxEntries - counted);

  return (
    <StreetCard className="mt-4 p-4 first:mt-0">
      <div className="flex items-center justify-between gap-2">
        <h2 className="lp-display-sm min-w-0 text-text-primary [overflow-wrap:anywhere]">Tus cupos</h2>
        <Ayuda titulo="Cómo funcionan los cupos" etiqueta="Cómo funcionan los cupos">
          <li>Cada cupo tiene <strong className="font-semibold text-text-primary">sus propios pronósticos</strong> y su propio pago. Compites con todos a la vez.</li>
          <li>Puedes pronosticar desde que subes tu comprobante. Los puntos de ese cupo entran a la tabla cuando confirmemos el pago.</li>
          <li>Cada cupo nuevo es una transferencia aparte de {formatCop(entryPriceCop)}, con su propio comprobante.</li>
          <li>En esta polla puedes tener hasta {maxEntries} cupos.</li>
        </Ayuda>
      </div>

      <ul className="mt-1 space-y-2" aria-label="Elige el cupo para ver o editar sus pronósticos">
        {visible.map((entry) => {
          const numero = entry.entry_number!;
          const elegido = numero === selected.entry_number;
          const estado = participationState(entry);
          const pago = PAGO[estado];
          const faltan = pendingByNumber?.[numero] ?? 0;
          return (
            <li key={numero}>
              <button
                type="button"
                aria-pressed={elegido}
                onClick={() => router.push(`/polla/${slug}?p=${numero}`, { scroll: false })}
                className={`flex min-h-14 w-full cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${
                  elegido ? "border-gold/50 bg-gold/[0.07]" : "border-border-default bg-bg-elevated hover:border-border-strong"
                }`}
              >
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold text-text-primary [overflow-wrap:anywhere]">Cupo {numero}</span>
                  {pago && <span className={`block text-[13px] leading-snug ${pago.clase} [overflow-wrap:anywhere]`}>{pago.texto}</span>}
                </span>
                {pendingByNumber && (faltan > 0 ? (
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-red-alert/50 bg-red-alert/10 px-2.5 py-1 text-[13px] font-semibold text-red-alert">
                    <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-red-alert" />
                    Faltan {faltan}
                  </span>
                ) : (
                  <span className="shrink-0 text-[13px] text-text-secondary">Listo</span>
                ))}
              </button>
            </li>
          );
        })}
      </ul>

      {/* Lo que el cupo elegido necesita de ti, pegado a su fila. */}
      {state === "rechazada" && (
        <p className="mt-3 text-[13px] leading-relaxed text-red-alert">
          {selected.reject_reason ?? "Comunícate con el administrador."}
          {open && <> <Link href={`/polla/${slug}/pagar?participacion=${selected.entry_number}`} className="font-semibold underline">Enviar otro comprobante</Link></>}
        </p>
      )}
      {state === "sin-comprobante" && open && (
        <p className="mt-3 text-[13px] leading-relaxed text-amber">
          No alcanzamos a recibir la imagen de este cupo.{" "}
          <Link href={`/polla/${slug}/pagar?participacion=${selected.entry_number}`} className="font-semibold underline">Subir el comprobante</Link>
        </p>
      )}
      {state === "revision" && (
        <p className="mt-3 text-[13px] leading-relaxed text-text-secondary">
          Puedes pronosticar ahora. Los puntos de este cupo entran a la tabla cuando confirmemos el pago.
        </p>
      )}

      {open && quedan > 0 && (
        <Link href={`/polla/${slug}/pagar?participacion=nueva`} className="lp-btn lp-btn-ghost mt-4 w-full gap-2">
          <Plus aria-hidden="true" className="h-5 w-5 shrink-0" />
          Comprar otro cupo · {formatCop(entryPriceCop)}
        </Link>
      )}
      {open && quedan > 0 && quedan <= 2 && (
        <p className="mt-2 text-center text-[13px] text-text-muted">
          {quedan === 1 ? "Queda 1 cupo" : `Quedan ${quedan} cupos`}
        </p>
      )}
      {open && quedan === 0 && (
        <p className="mt-4 text-center text-[13px] text-text-muted">Llegaste al máximo de {maxEntries} cupos.</p>
      )}
    </StreetCard>
  );
}
