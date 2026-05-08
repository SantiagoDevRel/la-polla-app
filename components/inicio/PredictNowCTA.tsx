// components/inicio/PredictNowCTA.tsx — Pill prominente en /inicio que
// le dice al user "tienes N pronósticos pendientes, toca para ir directo
// al primero". Pensado para usuarios mayores que se pierden en el flow
// (Pollas → polla → Partidos → input).
//
// One-tap desde home → polla del primer match pendiente con el tab
// Partidos abierto. La página de polla auto-expande la fecha más
// próxima, así que el match queda visible al landear.
//
// No-render cuando count = 0.

import Link from "next/link";
import { ChevronRight, Pencil } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { PendingFirst } from "@/lib/predictions/pending";

interface Props {
  count: number;
  first: PendingFirst | null;
}

export default async function PredictNowCTA({ count, first }: Props) {
  if (count <= 0 || !first) return null;
  const t = await getTranslations("Inicio");
  const label = t("predictPending", { count });
  return (
    <section className="px-4">
      <Link
        href={`/pollas/${first.pollaSlug}?tab=partidos`}
        className="flex items-center gap-3 rounded-2xl bg-gold text-bg-base px-4 py-3.5 shadow-[0_8px_24px_-6px_rgba(255,215,0,0.45)] active:scale-[0.99] transition-transform"
      >
        <span className="flex-shrink-0 w-9 h-9 rounded-full bg-bg-base/10 border border-bg-base/30 flex items-center justify-center">
          <Pencil className="w-[18px] h-[18px]" strokeWidth={2.4} aria-hidden="true" />
        </span>
        <span className="flex-1 min-w-0">
          <p className="font-display tracking-[0.04em] uppercase text-[16px] leading-none">
            {t("predictAction")}
          </p>
          <p className="text-[12px] font-semibold opacity-80 mt-0.5 truncate">
            {label} · {first.pollaName}
          </p>
        </span>
        <ChevronRight className="w-5 h-5 flex-shrink-0" strokeWidth={2.4} aria-hidden="true" />
      </Link>
    </section>
  );
}
