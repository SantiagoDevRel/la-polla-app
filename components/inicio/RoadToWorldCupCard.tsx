// Card de entrada a la bracket interactiva del Mundial (/road-to-worldcup).
// Montada en app/(app)/inicio/page.tsx tras WorldCupFactsCard.
//
// Resaltada a propósito (pedido del owner): borde + glow gold, gradiente
// sutil y un barrido de luz (.rtw-shine, ver globals.css) que cruza la card
// en loop para invitar a entrar. Es el "hero moment" del inicio.
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { WorldCupTrophy } from "@/components/icons/WorldCupTrophy";

export default function RoadToWorldCupCard() {
  return (
    <section className="px-4">
      <Link
        href="/road-to-worldcup"
        className="group relative flex items-center gap-3 overflow-hidden rounded-lg border border-gold/40 bg-gradient-to-br from-gold/[0.10] via-bg-card to-bg-card px-4 py-4 shadow-[0_0_28px_-8px_rgba(255,215,0,0.35)] transition-[box-shadow,border-color,transform] duration-300 hover:border-gold/60 hover:shadow-[0_0_36px_-6px_rgba(255,215,0,0.5)] active:scale-[0.99]"
      >
        {/* Barrido de luz diagonal en loop (CSS, respeta reduced-motion). */}
        <span
          aria-hidden="true"
          className="rtw-shine pointer-events-none absolute inset-0"
        />
        <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full border border-gold/40 bg-gold/15 text-gold shadow-[0_0_16px_-4px_rgba(255,215,0,0.55)]">
          {/* Mismo trofeo que el tab del navbar, para simetría visual. */}
          <WorldCupTrophy className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="relative min-w-0 flex-1">
          <span className="block font-display text-[20px] leading-none tracking-[0.04em] text-text-primary">
            Road to World Cup
          </span>
          <span className="mt-1 block truncate text-[12px] font-medium text-text-secondary">
            Arma tu llave interactiva del Mundial 2026.
          </span>
        </span>
        <ChevronRight
          className="relative h-5 w-5 shrink-0 text-gold/80 transition-transform duration-300 group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </Link>
    </section>
  );
}
