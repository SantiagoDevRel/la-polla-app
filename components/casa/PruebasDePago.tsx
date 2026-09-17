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
  const pagados = money.filter((p) => p.paid_at && p.id && proofUrls[p.id]).length;

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
              <p className={`flex items-center gap-1.5 border-t border-border-subtle px-3 py-1.5 text-[12px] ${pagado ? "text-turf" : "text-text-muted"}`}>
                {pagado ? <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /> : <Clock3 aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
                {pagado ? `Pagado · ${fechaPago(p.paid_at!)}` : "Pago pendiente"}
                {pagado && p.paid_reference && <span className="text-text-secondary"> · Ref. {p.paid_reference}</span>}
              </p>
              {url && (
                <details className="border-t border-border-subtle">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3 text-[13px] font-semibold text-text-secondary transition-colors hover:text-text-primary [&::-webkit-details-marker]:hidden">
                    <span>Ver comprobante de pago</span>
                    <span aria-hidden="true" className="text-text-muted">›</span>
                  </summary>
                  <div className="px-3 pb-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={`Comprobante del pago a ${p.display_name ?? "el ganador"}`} loading="lazy" className="max-h-[420px] w-full rounded-sm bg-bg-base object-contain" />
                  </div>
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
