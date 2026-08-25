// components/layout/BrandHeader.tsx — la marca, arriba, en todas las pantallas.
//
// PARCHE v1.0 (2026-08-25): el wordmark era tricolor (dorado/azul/rojo) con
// sombra y blur detrás. Tres colores compitiendo en 20px se leen como banner
// de página vieja, no como marca. Ahora es monocromo con UNA palabra en el
// acento, sobre una barra sólida con hairline abajo. El pollito se queda —
// es la marca — pero baja a 26px: pasa de mascota protagonista a firma.
"use client";

import { useTranslations } from "next-intl";
import WhatsAppBubble from "@/components/shared/WhatsAppBubble";
import ReportProblemBubble from "@/components/shared/ReportProblemBubble";

export default function BrandHeader() {
  const t = useTranslations("Brand");
  const part1 = t("wordmarkPart1");
  const part2 = t("wordmarkPart2");
  const part3 = t("wordmarkPart3");

  return (
    <header className="sticky top-0 z-40 border-b border-border-subtle bg-bg-base px-4 py-3">
      <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
        {/* min-w-0 + overflow-hidden: con el text-zoom de accesibilidad el
            wordmark crecía y se metía DEBAJO de las burbujas. Preferimos
            clipearlo antes que dejar que se monte encima. */}
        <div className="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/pollitos/pollito_pibe_lider.webp"
            alt=""
            width={26}
            height={26}
            className="h-[26px] w-[26px] max-w-none shrink-0 object-contain"
          />
          <span className="lp-stencil flex items-baseline gap-[6px] whitespace-nowrap text-[17px] text-text-primary">
            <span>{part1}</span>
            {/* Una sola palabra en el acento. El resto, papel. */}
            <span className="text-gold">{part2}</span>
            {part3 ? <span>{part3}</span> : null}
          </span>
        </div>

        <div className="flex flex-shrink-0 items-center gap-2">
          <ReportProblemBubble size={32} />
          <WhatsAppBubble size={32} />
        </div>
      </div>
    </header>
  );
}
