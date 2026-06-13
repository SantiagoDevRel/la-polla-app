// components/inicio/WorldCupFactsCarousel.tsx — Carrusel horizontal de datos
// curiosos del Mundial: UN dato visible a la vez, se desliza a la derecha
// para ver el siguiente (scroll-snap). Cada dato "sale" (efecto máquina de
// escribir) recién cuando es el visible — no todos de una. Puntos abajo +
// hint de deslizar.
//
// Cliente (el server WorldCupFactsCard pasa los textos ya localizados). El
// dato visible se detecta por scrollLeft (mismo patrón que los sheets del
// popup en vivo / ficha de equipo).
"use client";

import { useCallback, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { TypingText } from "@/components/inicio/TypingText";

interface WorldCupFactsCarouselProps {
  /** Textos ya localizados (es/en resuelto en el server). */
  facts: string[];
  /** Etiqueta del hint "Desliza" (i18n). */
  swipeHint: string;
}

export function WorldCupFactsCarousel({ facts, swipeHint }: WorldCupFactsCarouselProps) {
  const [active, setActive] = useState(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || el.clientWidth === 0) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    const clamped = Math.min(Math.max(idx, 0), facts.length - 1);
    setActive((prev) => (prev === clamped ? prev : clamped));
  }, [facts.length]);

  if (facts.length === 0) return null;

  return (
    <div className="lp-card overflow-hidden p-0">
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {facts.map((fact, i) => (
          <div
            key={i}
            className="flex min-h-[92px] w-full shrink-0 snap-center items-center px-4 py-4"
          >
            <div className="flex gap-3">
              {/* Viñeta sutil (no gold — el dorado se reserva para recompensa;
                  el ícono del header ya lo usa). */}
              <span
                aria-hidden="true"
                className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-text-primary/40"
              />
              <p className="text-sm leading-snug text-text-primary [overflow-wrap:anywhere]">
                <TypingText text={fact} speed={28} active={i === active} />
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Indicadores + hint de deslizar. */}
      <div className="flex items-center justify-between px-4 pb-3 pt-0.5">
        <div className="flex items-center gap-1.5" aria-hidden="true">
          {facts.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all duration-200 ${
                i === active ? "w-4 bg-text-primary/80" : "w-1.5 bg-text-primary/25"
              }`}
            />
          ))}
        </div>
        {active < facts.length - 1 ? (
          <span className="flex items-center gap-0.5 text-[11px] font-medium text-text-muted">
            {swipeHint}
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        ) : null}
      </div>
    </div>
  );
}
