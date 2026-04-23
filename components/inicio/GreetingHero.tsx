// components/inicio/GreetingHero.tsx — Inicio §2 talking-pollito greeting
//
// Replaces the old "Hola, {name}" block with a two-column layout:
// user's pollito on the left (breathing animation via Framer Motion),
// speech bubble on the right with either a rank callout or a soft CTA.
//
// Purely presentational. Ranks and polla names are derived server-side
// and passed in. No emojis — mini trophy glyph is inline SVG, per the
// design contract. Gold cap: one gold surface (the bubble background)
// plus an accent on the name — matches the §3 "max 3 golds" rule
// (bubble, name, and the existing header wordmark).

"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { getPollitoByPosition, DEFAULT_POLLITO } from "@/lib/pollitos";

export interface GreetingHeroProps {
  firstName: string;
  pollitoType: string | null | undefined;
  /**
   * Rank callout for the speech bubble. When provided, renders
   * "Vas #{rank} en {pollaName}". When null, falls back to the soft
   * "¿Listo pa' pronosticar?" line.
   */
  rankCallout?: { rank: number; pollaName: string } | null;
}

function TrophyGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M5 3h14v3a5 5 0 0 1-5 5h-.3a4 4 0 0 1-3.4 0H10A5 5 0 0 1 5 6V3zm-3 2h2v1a3 3 0 0 0 3 3V7a1 1 0 0 1 2 0v2a5 5 0 0 1-5-5V5H2V3h2zm18-2h2v2h2v1a5 5 0 0 1-5 5V9a3 3 0 0 0 3-3V5h-2V3zM10 14h4v1.5c0 1.4.6 2.8 1.7 3.8l.8.7H7.5l.8-.7c1.1-1 1.7-2.4 1.7-3.8V14zm-3 7h10v2H7v-2z" />
    </svg>
  );
}

export function GreetingHero({
  firstName,
  pollitoType,
  rankCallout,
}: GreetingHeroProps) {
  // Moods: lider for #1, peleando (fighting) for 2-3, base otherwise.
  const type = pollitoType || DEFAULT_POLLITO;
  const mood =
    rankCallout?.rank === 1 ? "lider" : rankCallout ? "peleando" : "base";
  const src = `/pollitos/pollito_${type}_${mood}.webp`;
  // Lider image variant is the "celebrate" pose — fall back gracefully.
  const fallbackSrc = getPollitoByPosition(type, 1, 1);

  return (
    <section className="px-4 pb-6">
      <div className="max-w-lg mx-auto flex items-start gap-3">
        <motion.div
          className="flex-shrink-0"
          animate={{ y: [0, -3, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        >
          <Image
            src={src}
            alt=""
            width={84}
            height={84}
            className="object-contain"
            priority
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).src = fallbackSrc;
            }}
          />
        </motion.div>

        <div className="flex-1 min-w-0 pt-1">
          <p className="font-body text-[11px] font-semibold text-text-muted leading-none">
            Hola,
          </p>
          <h1 className="font-display text-[32px] leading-none tracking-[0.02em] text-gold mt-1 mb-2">
            {firstName}
          </h1>

          {rankCallout ? (
            <div
              className="inline-flex items-center gap-1.5 rounded-[14px] rounded-bl-[2px] bg-gold text-bg-base px-3 py-2 font-body text-[12px] font-semibold leading-tight shadow-[0_10px_24px_-10px_rgba(255,215,0,0.55)] max-w-full"
              role="status"
            >
              <TrophyGlyph className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">
                Vas{" "}
                <span className="font-extrabold">#{rankCallout.rank}</span>
                {" en "}
                <span className="font-bold">{rankCallout.pollaName}</span>
              </span>
            </div>
          ) : (
            <p className="font-body text-[13px] text-text-secondary leading-tight">
              ¿Listo pa&apos; pronosticar?
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

export default GreetingHero;
