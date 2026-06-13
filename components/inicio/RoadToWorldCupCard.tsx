// Card de entrada a la bracket interactiva del Mundial (/road-to-worldcup).
// Montada en app/(app)/inicio/page.tsx tras WorldCupFactsCard.
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { WorldCupTrophy } from "@/components/icons/WorldCupTrophy";

export default function RoadToWorldCupCard() {
  return (
    <section className="px-4">
      <Link
        href="/road-to-worldcup"
        className="group flex items-center gap-3 rounded-lg border border-border-subtle bg-bg-card px-4 py-4 transition-colors active:scale-[0.99] hover:border-border-strong"
      >
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-gold/30 bg-gold/10 text-gold">
          {/* Mismo trofeo que el tab del navbar, para simetría visual. */}
          <WorldCupTrophy className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-[20px] leading-none tracking-[0.04em] text-text-primary">
            Road to World Cup
          </span>
          <span className="mt-1 block truncate text-[12px] font-medium text-text-secondary">
            Arma tu llave interactiva del Mundial 2026.
          </span>
        </span>
        <ChevronRight
          className="h-5 w-5 shrink-0 text-text-muted transition-colors group-hover:text-text-primary"
          aria-hidden="true"
        />
      </Link>
    </section>
  );
}
