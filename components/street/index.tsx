// components/street/index.tsx — primitivas del skin "Parche".
//
// Regla de oro del skin: el acento cal aparece MAXIMO 2 veces por pantalla.
// Todo lo demas es neutro. Lo que hace que se vea caro no es el color, es la
// distancia entre la jerarquia grande y la chica, y los hairlines finos.

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { formatCop } from "@/lib/casa/format";
import { TribunaArt } from "./TribunaArt";

/* ────────────────────────────────────────────────────────────────────────
   HeroFrame — el bloque de arriba de cada pantalla importante.
   Acepta una foto; si no hay, cae al arte vectorial de la tribuna.
   ──────────────────────────────────────────────────────────────────────── */
export function HeroFrame({
  children,
  image,
  height = "h-[196px]",
  className,
}: {
  children?: ReactNode;
  /** URL de fotografia. Si se omite, se dibuja TribunaArt. */
  image?: string;
  height?: string;
  className?: string;
}) {
  return (
    <div className={cn("relative overflow-hidden lp-grain", height, className)}>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <TribunaArt className="absolute inset-0 h-full w-full" />
      )}
      <div className="lp-scrim absolute inset-0" />
      {children ? (
        <div className="relative flex h-full flex-col justify-end p-4">{children}</div>
      ) : null}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   Tape — etiqueta de estado. Bloque solido, sin esquinas.
   ──────────────────────────────────────────────────────────────────────── */
type TapeTone = "cal" | "red" | "live" | "mute";

export function Tape({
  children,
  tone = "mute",
  className,
}: {
  children: ReactNode;
  tone?: TapeTone;
  className?: string;
}) {
  return (
    <span className={cn("lp-tape", `lp-tape-${tone}`, className)}>{children}</span>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   Label — metadato. Siempre apagado, nunca en el acento: es lo que deja
   que la cifra de al lado se lea como el dato importante.
   ──────────────────────────────────────────────────────────────────────── */
export function Label({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <span className={cn("lp-label block", className)}>{children}</span>;
}

/* ────────────────────────────────────────────────────────────────────────
   Money — cifra en pesos. El ancla visual de casi toda tarjeta.
   ──────────────────────────────────────────────────────────────────────── */
export function Money({
  cop,
  size = "text-[34px]",
  accent = false,
  className,
}: {
  cop: number;
  size?: string;
  accent?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "lp-money",
        size,
        accent ? "text-gold" : "text-text-primary",
        className,
      )}
    >
      {formatCop(cop)}
    </span>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   PctBar — "cuantos pusieron esto". Barra fina, cuadrada, con el numero
   al lado. Es un dato, no una animacion.
   ──────────────────────────────────────────────────────────────────────── */
export function PctBar({
  pct,
  showValue = true,
  className,
}: {
  /** 0-100 */
  pct: number;
  showValue?: boolean;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="lp-pct flex-1" role="presentation">
        <span style={{ width: `${clamped}%` }} />
      </div>
      {showValue ? (
        <span className="lp-money w-[34px] shrink-0 text-right text-[11px] text-text-muted">
          {clamped}%
        </span>
      ) : null}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   StreetCard — la superficie base. Plana, hairline, cero radio.
   ──────────────────────────────────────────────────────────────────────── */
export function StreetCard({
  children,
  hero = false,
  className,
  as: As = "div",
}: {
  children: ReactNode;
  /** El unico momento destacado de la pantalla. */
  hero?: boolean;
  className?: string;
  as?: "div" | "article" | "section" | "li";
}) {
  return (
    <As className={cn(hero ? "lp-card-hero" : "lp-card", className)}>{children}</As>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   SectionHead — titulo de seccion con la regla de acento.
   Reemplaza a la cinta de peligro decorativa: un solo trazo alcanza.
   ──────────────────────────────────────────────────────────────────────── */
export function SectionHead({
  title,
  meta,
  className,
}: {
  title: string;
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-3", className)}>
      <span className="lp-accent-rule mb-2" />
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="lp-display-sm text-text-primary">{title}</h2>
        {meta ? <span className="lp-label shrink-0">{meta}</span> : null}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   StatBlock — par etiqueta/valor. La jerarquia (11px tracking ancho vs
   cifra grande) es lo que separa "producto" de "plantilla".
   ──────────────────────────────────────────────────────────────────────── */
export function StatBlock({
  label,
  value,
  accent = false,
  className,
}: {
  label: string;
  value: ReactNode;
  accent?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <Label>{label}</Label>
      <div
        className={cn(
          "lp-money mt-1 truncate text-[22px]",
          accent ? "text-gold" : "text-text-primary",
        )}
      >
        {value}
      </div>
    </div>
  );
}

export { TribunaArt };
// Re-export para que las pantallas importen todo desde un solo lugar.
export { formatCop };
