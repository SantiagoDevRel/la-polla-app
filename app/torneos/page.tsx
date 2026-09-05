// app/torneos/page.tsx — Landing pública: índice de torneos disponibles.
//
// Ruta SEO. NO está bajo (app)/ ni (auth)/ — usa solo el layout raíz.
// Server component puro: lee TOURNAMENTS_SEO y renderiza una grilla de
// cards con link a cada landing por torneo. Sin dependencias de auth.
//
// JSON-LD: ItemList con cada torneo como ListItem.

import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getSiteFromHeaders, pathForLocale, SITES } from "@/lib/seo/sites";
import { TOURNAMENTS_SEO } from "@/lib/seo/tournaments";

export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSiteFromHeaders();
  const isEs = site.locale === "es";
  const title = isEs ? "Torneos con pollas de fútbol" : "Football pool tournaments";
  const description = isEs
    ? "Explora los torneos incluidos en las pollas de la casa. Paga la entrada, pronostica y compite por el pozo."
    : "Explore the tournaments featured in pools published by the house. Pay the entry fee, make your picks and compete for the prize pool.";
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

export default async function TorneosIndexPage() {
  const site = await getSiteFromHeaders();
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
    <main className="min-h-screen bg-bg-base px-4 py-10 text-text-primary sm:px-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }}
      />
      <div className="max-w-[720px] mx-auto">
        <p className="lp-label mb-3 text-gold">
          {isEs ? "Torneos" : "Tournaments"}
        </p>
        <h1 className="lp-display mb-3 text-[42px] leading-none tracking-[0.03em] md:text-[54px]">
          {isEs ? "Pollas de los principales torneos" : "Pools for the biggest tournaments"}
        </h1>
        <p className="mb-8 text-lg leading-relaxed text-text-secondary">
          {isEs
            ? "La casa publica las pollas del fin de semana. Paga la entrada, pronostica y compite por el pozo."
            : "The house publishes weekend pools. Pay the entry fee, make your picks and compete for the prize pool."}
        </p>

        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {TOURNAMENTS_SEO.map((t) => (
            <li key={t.publicSlug}>
              <Link
                href={pathForLocale(site.locale, "torneo", t.publicSlug)}
                className="group lp-card flex h-full min-h-[172px] flex-col p-5 transition-all hover:border-gold/30"
              >
                <h2 className="lp-display text-[26px] tracking-[0.04em]">{t.name[site.locale]}</h2>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-text-secondary">{t.description[site.locale]}</p>
                <span className="mt-4 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-text-secondary transition-colors group-hover:text-gold">
                  {isEs ? "Ver detalles" : "View details"}
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <div className="lp-card-hero mt-10 p-6 text-center">
          <p className="text-xl font-bold text-text-primary">
            {isEs ? "¿Quieres participar?" : "Ready to enter?"}
          </p>
          <Link
            href="/login?returnTo=%2Fcasa"
            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-gold px-6 font-semibold text-bg-base transition-all hover:brightness-110"
          >
            {isEs ? "Ingresar para participar" : "Sign in to enter"}
          </Link>
        </div>
      </div>
    </main>
  );
}
