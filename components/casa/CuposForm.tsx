"use client";

// components/casa/CuposForm.tsx — "¿Cuántos cupos quieres?" (migración 131).
//
// Regla del dueño: cada cupo es SU PROPIA transferencia por el valor de la
// entrada y SU PROPIO comprobante. Nunca un pago por varios cupos. Por eso el
// selector no suma un solo pago: abre una tarjeta de comprobante por cupo, y
// cada una se registra y se aprueba por separado.

import { useState } from "react";
import Link from "next/link";
import { formatCop } from "@/lib/casa/format";
import { PagarForm } from "./PagarForm";

interface Props {
  slug: string;
  entryPriceCop: number;
  /** Cupos que esta persona todavía puede comprar en la polla. */
  available: number;
  /** Ya tiene cupos: el texto habla de cupos adicionales. */
  another: boolean;
}

export function CuposForm({ slug, entryPriceCop, available, another }: Props) {
  const [cupos, setCupos] = useState(1);
  const [registrados, setRegistrados] = useState<Array<number | null>>([]);
  const options = Array.from({ length: Math.max(1, Math.min(available, 10)) }, (_, i) => i + 1);
  const primero = registrados.find((n): n is number => n != null);

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="cuantos-cupos" className="block text-[15px] font-semibold text-text-primary">
          {another ? "¿Cuántos cupos más quieres?" : "¿Cuántos cupos quieres en esta polla?"}
        </label>
        <select
          id="cuantos-cupos"
          value={cupos}
          disabled={registrados.length > 0}
          onChange={(e) => setCupos(Number(e.target.value))}
          className="lp-input mt-2 min-h-12 w-full cursor-pointer text-[15px] disabled:cursor-default disabled:opacity-60"
        >
          {options.map((n) => (
            <option key={n} value={n}>{n === 1 ? "1 cupo" : `${n} cupos`}</option>
          ))}
        </select>
        <p className="mt-2 text-[13px] text-text-secondary">
          Cada cupo lleva sus propios pronósticos.
          {available > 1 && ` Máximo ${available}${another ? " más" : ""}.`}
        </p>
      </div>

      <div role="note" className="border border-gold/40 bg-gold/10 p-3">
        <p className="lp-label text-gold">Una transferencia por cupo</p>
        <p className="mt-1 text-[15px] leading-relaxed text-text-primary">
          Cada cupo debe tener su propia transferencia de {formatCop(entryPriceCop)}
          {cupos > 1 && <> — {cupos} transferencias separadas, no una de {formatCop(entryPriceCop * cupos)}</>}.
          Sube un comprobante por cupo.
        </p>
      </div>

      {options.slice(0, cupos).map((n) => (
        <PagarForm
          key={n}
          slug={slug}
          esRifa={false}
          ticketCount={null}
          entryNumber={null}
          slot={{ index: n, total: cupos }}
          onRegistered={(entryNumber) => setRegistrados((prev) => [...prev, entryNumber])}
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
