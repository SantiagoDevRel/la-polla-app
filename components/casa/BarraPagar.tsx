// components/casa/BarraPagar.tsx — el botón de pagar te sigue mientras miras.
//
// (2026-09-18) La otra mitad del «no sé dónde pagar»: la puerta estaba arriba
// del todo, y la gente baja a los partidos. Mientras no haya una inscripción
// viva, el botón vive pegado abajo, encima de la navegación, en cualquier punto
// del scroll. Desaparece solo: la página deja de dibujarlo apenas hay cupo.
//
// No lleva estado ni JavaScript propio: es un enlace pegajoso.

import Link from "next/link";
import { formatCop } from "@/lib/casa/format";

export function BarraPagar({ href, entryPriceCop, texto }: {
  href: string;
  entryPriceCop: number;
  /** Por defecto, «Pagar la entrada · $20.000». */
  texto?: string;
}) {
  return (
    <div
      className="sticky bottom-[88px] z-20 -mx-4 mt-4 border-t border-border-default bg-bg-base/95 px-4 pb-3 pt-3 backdrop-blur"
      style={{ bottom: "calc(88px + env(safe-area-inset-bottom, 0px))" }}
    >
      <Link href={href} className="lp-btn lp-btn-primary w-full !px-4">
        {texto ?? `Pagar la entrada · ${formatCop(entryPriceCop)}`}
      </Link>
    </div>
  );
}
