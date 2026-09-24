import type { ReactNode } from "react";
import type { CasaPollaKind } from "@/lib/casa/types";
import { TournamentIdentity } from "./TournamentIdentity";

/** Logos por tarjeta: seis de 32 px caben en una fila desde 320 px. */
const MAX_LOGOS = 6;

const TONOS = {
  gold: "text-gold",
  primary: "text-text-primary",
  secondary: "text-text-secondary",
} as const;

export type PollaCardDato = { label?: ReactNode; value?: ReactNode; tone?: keyof typeof TONOS };

/**
 * El molde de TODA tarjeta de polla (Mis pollas, Para entrar, Terminadas).
 *
 * (2026-09-19, pedido del dueño) «No podemos ser asimétricos»: POLLA REGALO
 * medía 275 px y POLLAGOL 160, porque el premio en objeto iba a 28 px en tres
 * líneas, y eso además empujaba «Cierra en» a la izquierda. El formato ya no
 * depende de lo que escriba el administrador al crear la polla:
 *
 *   1. Nombre       una línea; si no cabe, se corta con «…».
 *   2. Torneos      una fila; más de seis se resumen en «+N».
 *   3. Premio | Dato  dos columnas. El premio en objeto va en letra de texto
 *                   y máximo dos líneas, en la MISMA caja que la cifra. El
 *                   dato (cierre, inscritos) vive siempre a la derecha.
 *
 * El nombre y el premio completos se leen dentro de la polla. Los altos son
 * mínimos y no fijos: con el texto ampliado del teléfono la tarjeta crece en
 * vez de recortar letras. Lo que cambie entre tarjetas va en `topRight` o en
 * el dato, nunca en una fila nueva.
 */
export function PollaCardBody({ name, nameDecoration, prizeVisual, tournaments, kind, muted = false, topRight, premioLabel, premio, objeto = false, dato, children }: {
  name: string;
  nameDecoration?: ReactNode;
  prizeVisual?: ReactNode;
  tournaments: readonly string[];
  kind: CasaPollaKind;
  /** Polla terminada: texto en gris. */
  muted?: boolean;
  /** Estado, aviso o flecha, a la derecha del nombre. */
  topRight?: ReactNode;
  premioLabel: ReactNode;
  /** `null` = no se pudo leer: raya, nunca un cero inventado. */
  premio: string | null;
  /** El premio es un objeto (texto), no una cifra. */
  objeto?: boolean;
  dato?: PollaCardDato;
  /** Pie de la sección (botón «Entrar»). Igual en todas las tarjetas de una misma lista. */
  children?: ReactNode;
}) {
  const tono = muted ? "text-text-secondary" : "text-text-primary";
  return (
    <>
      {/* Una sola línea siempre. Solo con el texto ampliado del teléfono, cuando
          el aviso ya no le deja al nombre cuatro letras de ancho (`4em`), el
          aviso baja a su propia línea: el nombre nunca desaparece. */}
      <div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1">
        <h3 title={name} className={`min-w-[4em] flex-1 truncate font-display text-[22px] leading-[1.25] tracking-[0.04em] ${nameDecoration ? "-mt-2 pt-2" : ""} ${tono}`}>{nameDecoration ?? name}</h3>
        {topRight && <div className="ml-auto flex shrink-0 items-center gap-3">{topRight}</div>}
      </div>

      <div className="mt-2 flex min-h-8 items-center">
        <TournamentIdentity tournaments={tournaments} kind={kind} limit={MAX_LOGOS} />
      </div>

      {/* Dos columnas en una fila. El premio se queda con lo que sobra y parte
          su texto; el dato no se encoge. Solo si el texto ampliado del teléfono
          ya no le deja al premio su ancho mínimo, el dato baja — y `ml-auto` lo
          mantiene a la derecha (antes caía a la izquierda). */}
      <div className="mt-3 flex flex-wrap items-end gap-x-3 gap-y-2">
        <div className={`flex-1 basis-0 ${objeto ? "min-w-[8rem]" : "min-w-fit"}`}>
          <span className="lp-label block truncate">{premioLabel}</span>
          <div className="mt-1 flex min-h-9 items-end gap-2">
            {prizeVisual}
            {premio === null
              ? <span className="text-[15px] leading-none text-text-secondary">—</span>
              : objeto
                ? <span title={premio} className={`line-clamp-2 text-[15px] font-semibold leading-[1.2] max-[359px]:text-[13px] ${tono} [overflow-wrap:anywhere]`}>{premio}</span>
                : <span className={`lp-money text-[24px] leading-none ${tono}`}>{premio}</span>}
          </div>
        </div>
        {dato && (dato.label || dato.value) && (
          <div className="ml-auto max-w-full shrink-0 text-right">
            <span className="lp-label block min-h-[1.5em] whitespace-nowrap">{dato.label}</span>
            {/* Misma caja que el premio: las dos etiquetas quedan a la misma altura y los dos valores sobre la misma base. */}
            <div className="mt-1 flex min-h-9 items-end justify-end">
              {dato.value && <span className={`whitespace-nowrap text-[15px] font-semibold leading-[1.2] ${TONOS[dato.tone ?? "secondary"]}`}>{dato.value}</span>}
            </div>
          </div>
        )}
      </div>

      {children}
    </>
  );
}
