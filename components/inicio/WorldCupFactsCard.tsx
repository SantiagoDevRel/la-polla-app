// components/inicio/WorldCupFactsCard.tsx
//
// "Datos curiosos del Mundial" — server component que muestra 2 datos
// curiosos por día en /inicio, entre el strip "En vivo" y el de "Próximos".
//
// Selección determinística por fecha (zona horaria America/Bogota): todos
// los usuarios ven los MISMOS 2 datos durante un mismo día calendario y
// rotan al día siguiente. Sin estado, sin API externa, sin llamadas en
// runtime — el dataset es estático y bilingüe (free-tier intacto). Cubre
// ~100 días únicos antes de repetir (2 × ~halfLen).
//
// /inicio es Server Component y force-dynamic, así que la fecha se evalúa
// fresca en cada request — el día de Bogotá manda y no hay HTML cacheado.

import { getLocale, getTranslations } from "next-intl/server";
import { Sparkles } from "lucide-react";
import { WORLD_CUP_FACTS } from "@/lib/inicio/world-cup-facts";
import { TypingText } from "@/components/inicio/TypingText";

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
  // Dos índices contiguos que avanzan de a 2 por día; el módulo cierra el
  // ciclo. (((x % n) + n) % n) protege ante cualquier negativo teórico.
  const i1 = (((day * 2) % n) + n) % n;
  const i2 = (i1 + 1) % n;
  const picked = i1 === i2 ? [facts[i1]] : [facts[i1], facts[i2]];

  // Typing secuencial: cada bullet arranca SOLO cuando el anterior terminó
  // de tipear (+ una pausa). delay[i] = delay[i-1] + (chars previos × speed)
  // + pausa. SPEED un poco lento a propósito (más estético que el tecleo
  // veloz). El cómputo es server-side; TypingText anima en el cliente.
  const SPEED = 30; // ms por caracter (más lento que el tecleo veloz original)
  const PAUSE = 400; // ms entre bullets
  const factTexts = picked.map((f) => (locale === "en" ? f.en : f.es));
  const factDelays = factTexts.reduce<number[]>((acc, _t, i) => {
    acc.push(i === 0 ? 0 : acc[i - 1] + factTexts[i - 1].length * SPEED + PAUSE);
    return acc;
  }, []);

  return (
    <section className="px-4">
      <h2 className="lp-section-title mb-3 flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-gold" aria-hidden="true" />
        {t("funFactsTitle")}
      </h2>
      <div className="lp-card p-4 space-y-3">
        {picked.map((f, idx) => (
          <div key={idx} className="flex gap-3">
            {/* Viñeta sutil — no es gold (la regla de oro reserva el dorado
                para señales de recompensa; el ícono del header ya lo usa). */}
            <span
              aria-hidden="true"
              className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-text-primary/40"
            />
            <p className="text-sm leading-snug text-text-primary [overflow-wrap:anywhere]">
              <TypingText
                text={factTexts[idx]}
                speed={SPEED}
                startDelay={factDelays[idx]}
              />
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
