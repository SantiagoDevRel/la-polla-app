import { cn } from "@/lib/cn";

export type PrizeCrest = { src: string; alt: string; width: number; height: number };

/**
 * Premio que se presenta con los escudos de los equipos (POLLA REGALO 2:
 * boletas para el clásico). Quietos a propósito: sin giro ni gestos.
 */
export function CrestPairPrize({ crests, className }: { crests: readonly PrizeCrest[]; className?: string }) {
  return (
    <span className={cn("flex shrink-0 items-center justify-center", className)}>
      {crests.map((crest, index) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={crest.src}
          src={crest.src}
          alt={crest.alt}
          width={crest.width}
          height={crest.height}
          decoding="async"
          className={cn(
            "h-[62%] w-auto max-w-none select-none drop-shadow-[0_4px_10px_rgba(0,0,0,0.45)]",
            index > 0 && "-ml-[10%]",
          )}
        />
      ))}
    </span>
  );
}
