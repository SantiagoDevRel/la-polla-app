// components/layout/SeasonClosedBanner.tsx — Banner FIJO de cierre de
// temporada, debajo del BrandHeader en todas las páginas de (app)/.
//
// Reemplaza a la cinta AnnouncementTicker mientras SEASON_CLOSED (ver
// lib/closure.ts): las advertencias de "los pronósticos cierran 10 min
// antes" y "los puntos van por los 90 minutos" no aplican si no hay
// partidos. Cuando se reabra la temporada, el layout vuelve a montar la
// cinta solo — no hay que tocar nada acá.
//
// NO es cerrable a propósito (decisión del owner 2026-07-26): esto no es
// un nag, es el estado actual de la app. Quien entre en tres meses tiene
// que entender de una por qué no puede armar polla.
//
// Server Component: cero JS al cliente (no tiene interacción). Va montado
// en TODAS las páginas, así que el costo de bundle importa.
//
// Text-zoom (regla del repo): la ilustración es el único elemento de ancho
// fijo y va `shrink-0` + `max-w-none` (next/image y el preflight de
// Tailwind la encogerían dentro de un flex apretado); el texto vive en un
// `min-w-0` con `[overflow-wrap:anywhere]` y sin line-clamp, así que con
// boost 2-3x hace wrap en vez de desaparecer.
import { getTranslations } from "next-intl/server";
import { SEASON_CLOSED } from "@/lib/closure";

export default async function SeasonClosedBanner() {
  if (!SEASON_CLOSED) return null;
  const t = await getTranslations("Closure");

  return (
    <section
      role="status"
      aria-label={t("bannerTitle")}
      className="mx-3 mt-1 rounded-lg border border-gold/25 bg-bg-elevated/90 backdrop-blur-sm px-3.5 py-3 flex items-start gap-3"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/pollitos/Pollito_esperando-256.webp"
        alt=""
        width={40}
        height={40}
        className="h-10 w-10 max-w-none shrink-0"
        style={{ objectFit: "contain" }}
      />
      <div className="min-w-0">
        <h2 className="font-display text-gold leading-none tracking-[0.04em] text-[17px] [overflow-wrap:anywhere]">
          {t("bannerTitle")}
        </h2>
        <p className="mt-1.5 text-[13px] leading-snug text-text-secondary [overflow-wrap:anywhere]">
          {t("bannerBody")}
        </p>
      </div>
    </section>
  );
}
