// components/casa/PruebasDePago.tsx — la prueba de que la casa pagó.
//
// (2026-09-16) Pedido del dueño: cuando una polla termina, el pantallazo de
// cada transferencia al ganador se muestra en la polla, dentro de «Pollas
// cerradas», para que la gente vea el historial y sepa que sí se paga.
//
// Sin JavaScript propio: cada comprobante es un <details> cerrado. Las URL
// vienen firmadas del servidor (una hora) solo para quien abre la polla con
// sesión; nunca son públicas.

import Image from "next/image";
import { CheckCircle2, Clock3 } from "lucide-react";
import { getPollitoBase } from "@/lib/pollitos";
import { formatCop, formatShortDate } from "@/lib/casa/format";
import type { CasaPayout } from "@/lib/casa/types";

/** «16 sep 2026», en hora de Colombia. */
export function fechaPago(iso: string): string {
  return formatShortDate(iso, { year: true });
}

function estado(p: CasaPayout, pagado: boolean) {
  return (
    <span className={`flex items-center gap-1.5 ${pagado ? "text-turf" : "text-text-muted"}`}>
      {pagado ? <CheckCircle2 aria-hidden="true" className="h-4 w-4 max-w-none shrink-0" /> : <Clock3 aria-hidden="true" className="h-4 w-4 max-w-none shrink-0" />}
      {pagado ? `Pagado · ${fechaPago(p.paid_at!)}` : "Pago pendiente"}
      {pagado && p.paid_reference && <span className="text-text-secondary"> · Ref. {p.paid_reference}</span>}
    </span>
  );
}

export function PruebasDePago({
  payouts,
  proofUrls,
  miUserId,
}: {
  payouts: CasaPayout[];
  /** id del premio → URL firmada del comprobante. Sin entrada = sin comprobante. */
  proofUrls: Record<string, string>;
  miUserId: string | null;
}) {
  const money = payouts.filter((p) => (p.prize_kind ?? "pozo") === "pozo");
  if (money.length === 0) return null;
  // El hecho (pagado y cuándo) lo ve todo el mundo; la imagen solo llega en
  // `proofUrls` para administradores, ganadores y participantes de la polla.
  const pagados = money.filter((p) => p.paid_at).length;

  return (
    <section aria-labelledby="pruebas-pago-titulo" className="mt-3 border-t border-border-subtle pt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id="pruebas-pago-titulo" className="lp-label !text-[12px]">Prueba de pago</h3>
        <span className="text-[13px] tabular-nums text-text-secondary">
          {pagados === money.length ? `${money.length === 1 ? "Premio pagado" : "Todos los premios pagados"}` : `${pagados} de ${money.length} pagados`}
        </span>
      </div>
      <ul className="mt-2 space-y-2">
        {money.map((p) => {
          const url = p.id ? proofUrls[p.id] : undefined;
          const pagado = Boolean(p.paid_at);
          const soyYo = p.user_id === miUserId;
          return (
            <li key={p.id ?? p.user_id} className="rounded-md border border-border-subtle bg-bg-elevated/60">
              <div className="flex items-center gap-2 px-3 py-2">
                <Image src={getPollitoBase(p.avatar_url)} alt="" aria-hidden="true" width={24} height={24} className="h-6 w-6 max-w-none shrink-0 rounded-full object-contain" />
                <span className="min-w-0 flex-1 text-[13px] font-semibold text-text-primary [overflow-wrap:anywhere]">
                  {p.display_name ?? "Sin nombre"}{soyYo && <span className="ml-1 text-[12px] font-normal text-turf">(tú)</span>}
                </span>
                <span className="lp-money shrink-0 text-[15px] text-text-primary">{formatCop(p.amount_cop)}</span>
              </div>
              {/* (2026-09-18) «Pagado · fecha» y «Ver comprobante» eran dos pisos;
                  ahora es uno: el estado a la izquierda y, si hay imagen, el
                  mismo renglón la despliega. */}
              {url ? (
                <details className="border-t border-border-subtle">
                  <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-x-3 px-3 text-[13px] transition-colors hover:bg-bg-elevated [&::-webkit-details-marker]:hidden">
                    {estado(p, pagado)}
                    <span className="flex items-center gap-0.5 font-semibold text-text-secondary">Comprobante <span aria-hidden="true" className="text-text-muted">›</span></span>
                  </summary>
                  <div className="px-3 pb-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={`Comprobante del pago a ${p.display_name ?? "el ganador"}`} loading="lazy" className="max-h-[420px] w-full rounded-sm bg-bg-base object-contain" />
                  </div>
                </details>
              ) : (
                <p className="border-t border-border-subtle px-3 py-1.5 text-[13px]">{estado(p, pagado)}</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
