// components/inicio/WorldCupFactsCard.tsx
//
// "Datos curiosos del Mundial" — server component que muestra 4 datos
// curiosos por día en /inicio, entre el strip "En vivo" y el de "Próximos".
// Se ven de a UNO: carrusel horizontal (WorldCupFactsCarousel) que se desliza
// a la derecha, y cada dato "sale" (typing) cuando es el visible.
//
// Selección determinística por fecha (zona horaria America/Bogota): todos
// los usuarios ven los MISMOS 4 datos durante un mismo día calendario y
// rotan al día siguiente (avanza de a 4). Sin estado, sin API externa, sin
// llamadas en runtime — el dataset es estático y bilingüe (free-tier intacto).
//
// /inicio es Server Component y force-dynamic, así que la fecha se evalúa
// fresca en cada request — el día de Bogotá manda y no hay HTML cacheado.

import { getLocale, getTranslations } from "next-intl/server";
import { Sparkles } from "lucide-react";
import { WORLD_CUP_FACTS } from "@/lib/inicio/world-cup-facts";
import { WorldCupFactsCarousel } from "@/components/inicio/WorldCupFactsCarousel";

// Cuántos datos por día. Se ven de a uno (scroll horizontal).
const FACTS_PER_DAY = 4;

// Número de día calendario (días desde epoch) en America/Bogota. Estable
// para una misma fecha local de Colombia, independiente de la hora UTC del
// servidor.
function bogotaDayNumber(): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return Math.floor(Date.UTC(get("year"), get("month") - 1, get("day")) / 86_400_000);
}

export default async function WorldCupFactsCard() {
  const locale = await getLocale();
  const t = await getTranslations("Inicio");

  const facts = WORLD_CUP_FACTS;
  const n = facts.length;
  if (n === 0) return null;

  const day = bogotaDayNumber();
  // FACTS_PER_DAY índices contiguos que avanzan de a FACTS_PER_DAY por día;
  // el módulo cierra el ciclo. (((x % n) + n) % n) protege ante negativos.
  const start = (((day * FACTS_PER_DAY) % n) + n) % n;
  const count = Math.min(FACTS_PER_DAY, n);
  const factTexts = Array.from({ length: count }, (_, k) => {
    const f = facts[(start + k) % n];
    return locale === "en" ? f.en : f.es;
  });

  return (
    <section className="px-4">
      <h2 className="lp-section-title mb-3 flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-gold" aria-hidden="true" />
        {t("funFactsTitle")}
      </h2>
      <WorldCupFactsCarousel facts={factTexts} swipeHint={t("funFactsSwipe")} />
    </section>
  );
}
