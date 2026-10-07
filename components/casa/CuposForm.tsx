"use client";

// components/casa/CuposForm.tsx — "¿Cuántos cupos quieres?" (migración 131).
//
// Regla del dueño: cada cupo es SU PROPIA transferencia por el valor de la
// entrada y SU PROPIO comprobante. Nunca un pago por varios cupos. Por eso el
// selector no suma un solo pago: abre una tarjeta de comprobante por cupo, y
// cada una se registra y se aprueba por separado.

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { formatCop } from "@/lib/casa/format";
import { PagarForm } from "./PagarForm";
import { useHydrated } from "@/lib/use-hydrated";

interface Props {
  slug: string;
  entryPriceCop: number;
  /** Cupos que esta persona todavía puede comprar en la polla. */
  available: number;
  /** Ya tiene cupos: el texto habla de cupos adicionales. */
  another: boolean;
  embedded?: boolean;
  paymentDetails?: ReactNode;
}

export function CuposForm({ slug, entryPriceCop, available, another, embedded = false, paymentDetails }: Props) {
  const hydrated = useHydrated();
  const [cupos, setCupos] = useState(1);
  const [registrados, setRegistrados] = useState<Array<number | null>>([]);
  const [enviando, setEnviando] = useState<Record<number, boolean>>({});
  const options = Array.from({ length: Math.max(1, Math.min(available, 10)) }, (_, i) => i + 1);
  const primero = registrados.find((n): n is number => n != null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label htmlFor="cuantos-cupos" className="block text-[15px] font-semibold text-text-primary">
          {another ? "Cupos adicionales" : "Cupos"}
        </label>
        <div className="relative min-w-[7rem] flex-1">
        <select
          id="cuantos-cupos"
          value={cupos}
          disabled={!hydrated || registrados.length > 0 || Object.values(enviando).some(Boolean)}
          onChange={(e) => setCupos(Number(e.target.value))}
          className="lp-input min-h-12 w-full cursor-pointer appearance-none pr-10 text-[15px] [color-scheme:dark] disabled:cursor-default disabled:opacity-60"
        >
          {options.map((n) => (
            <option key={n} value={n}>{n === 1 ? "1 cupo" : `${n} cupos`}</option>
          ))}
        </select>
        <ChevronDown aria-hidden="true" size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary" />
        </div>
        <p className="w-full text-[13px] leading-relaxed text-text-secondary">
          {cupos === 1 ? "Una transferencia y un comprobante por cupo." : `${cupos} transferencias de ${formatCop(entryPriceCop)}, cada una con su comprobante.`}
        </p>
      </div>

      {paymentDetails}

      {options.slice(0, cupos).map((n) => (
        <PagarForm
          key={n}
          embedded={embedded}
          slug={slug}
          esRifa={false}
          ticketCount={null}
          entryNumber={null}
          slot={{ index: n, total: cupos }}
          onRegistered={(entryNumber) => setRegistrados((prev) => [...prev, entryNumber])}
          onSendingChange={(sending) => setEnviando((prev) => ({ ...prev, [n]: sending }))}
        />
      ))}

      {registrados.length > 0 && (
        <div className="space-y-2">
          {registrados.length < cupos && (
            <p role="status" className="text-[13px] text-text-secondary">
              Enviaste {registrados.length} de {cupos}. Los que falten puedes enviarlos ahora o más tarde desde la polla.
            </p>
          )}
          <Link href={`/polla/${slug}${primero ? `?p=${primero}` : ""}`} className="lp-btn lp-btn-primary w-full">
            {registrados.length === 1 ? "Ver mi cupo y pronosticar" : "Ver mis cupos y pronosticar"}
          </Link>
        </div>
      )}
    </div>
  );
}
