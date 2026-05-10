// app/torneos/page.tsx — Landing pública: índice de torneos disponibles.
//
// Ruta SEO. NO está bajo (app)/ ni (auth)/ — usa solo el layout raíz.
// Server component puro: lee TOURNAMENTS_SEO y renderiza una grilla de
// cards con link a cada landing por torneo. Sin dependencias de auth.
//
// JSON-LD: ItemList con cada torneo como ListItem.

import type { Metadata } from "next";
import Link from "next/link";
import { getSiteFromHeaders, pathForLocale, SITES } from "@/lib/seo/sites";
import { TOURNAMENTS_SEO } from "@/lib/seo/tournaments";

export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  const site = getSiteFromHeaders();
  const isEs = site.locale === "es";
  const title = isEs ? "Torneos disponibles para tu polla" : "Tournaments you can pool";
  const description = isEs
    ? "Mundial 2026, Champions League, Copa Libertadores, Sudamericana, Liga BetPlay, LaLiga, Premier League y Serie A. Crea una polla en minutos con tus amigos."
    : "World Cup 2026, Champions League, Copa Libertadores, Sudamericana, Liga BetPlay, LaLiga, Premier League, Serie A. Create a pool with friends in minutes.";
  const canonical = pathForLocale(site.locale, "torneos-index");
  return {
    title,
    description,
    alternates: {
      canonical,
      languages: {
        "es-CO": `${SITES.ES.origin}${pathForLocale("es", "torneos-index")}`,
        en: `${SITES.EN.origin}${pathForLocale("en", "torneos-index")}`,
      },
    },
    openGraph: { title, description, url: canonical, type: "website" },
  };
}

export default function TorneosIndexPage() {
  const site = getSiteFromHeaders();
  const isEs = site.locale === "es";

  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: isEs ? "Torneos disponibles" : "Available tournaments",
    itemListElement: TOURNAMENTS_SEO.map((t, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      url: `${site.origin}/torneos/${t.publicSlug}`,
      name: t.name[site.locale],
    })),
  };

  return (
    <main className="min-h-screen bg-[#0d0d0d] text-white px-5 py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }}
      />
      <div className="max-w-[720px] mx-auto">
        <p className="text-xs tracking-[0.2em] uppercase text-[#FCD116] mb-3">
          {isEs ? "Torneos" : "Tournaments"}
        </p>
        <h1 className="text-4xl md:text-5xl font-bold leading-tight mb-4">
          {isEs ? "Crea tu polla del torneo que más te guste" : "Create a pool for any tournament"}
        </h1>
        <p className="text-white/70 mb-8 text-lg">
          {isEs
            ? "Elige un torneo, invita a tus parceros y compitan prediciendo resultados. Gratis."
            : "Pick a tournament, invite your friends, and compete by predicting results. Free."}
        </p>

        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {TOURNAMENTS_SEO.map((t) => (
            <li key={t.publicSlug}>
              <Link
                href={pathForLocale(site.locale, "torneo", t.publicSlug)}
                className="block rounded-xl border border-white/10 hover:border-[#FCD116] transition p-5 bg-white/[0.03]"
              >
                <h2 className="text-xl font-semibold mb-1">{t.name[site.locale]}</h2>
                <p className="text-white/60 text-sm leading-snug">{t.description[site.locale]}</p>
                <span className="inline-block mt-3 text-[#FCD116] text-sm font-medium">
                  {isEs ? "Ver detalles →" : "View details →"}
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <div className="mt-10 rounded-xl bg-[#FCD116] text-black p-6 text-center">
          <p className="font-bold text-xl mb-2">
            {isEs ? "¿Listo para armar la polla?" : "Ready to build your pool?"}
          </p>
          <Link
            href="/login"
            className="inline-block bg-black text-white font-semibold px-6 py-3 rounded-full"
          >
            {isEs ? "Crear polla gratis" : "Create pool — free"}
          </Link>
        </div>
      </div>
    </main>
  );
}
