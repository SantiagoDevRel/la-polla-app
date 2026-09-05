// app/torneos/[slug]/page.tsx — Landing pública por torneo.
//
// Server component puro. Lee próximos partidos del torneo desde Supabase
// admin (read-only) para mostrar "Próximos partidos" y link a cada uno.
// Si la query falla, la página renderiza igual con solo la info estática.
//
// JSON-LD: SportsOrganization (el torneo) + ItemList de partidos próximos.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { getSiteFromHeaders, pathForLocale, SITES } from "@/lib/seo/sites";
import { TOURNAMENTS_SEO, findByPublicSlug } from "@/lib/seo/tournaments";
import { buildMatchSlug } from "@/lib/seo/match-slug";
import { TOURNAMENT_STRUCTURE } from "@/lib/tournaments/structure";
import { createAdminClient } from "@/lib/supabase/admin";

export const revalidate = 1800;

interface PageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return TOURNAMENTS_SEO.map((t) => ({ slug: t.publicSlug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = findByPublicSlug((await params).slug);
  if (!t) return {};
  const site = await getSiteFromHeaders();
  const title = t.heading[site.locale];
  const description = t.description[site.locale];
  const canonical = pathForLocale(site.locale, "torneo", t.publicSlug);
  const esPath = pathForLocale("es", "torneo", t.publicSlug);
  const enPath = pathForLocale("en", "torneo", t.publicSlug);
  return {
    title,
    description,
    keywords: t.keywords[site.locale],
    alternates: {
      canonical,
      languages: {
        "es-CO": `${SITES.ES.origin}${esPath}`,
        en: `${SITES.EN.origin}${enPath}`,
      },
    },
    openGraph: { title, description, url: canonical, type: "website" },
  };
}

interface UpcomingMatchRow {
  id: string;
  home_team: string;
  away_team: string;
  scheduled_at: string;
  venue: string | null;
  phase: string | null;
}

async function fetchUpcoming(internalSlug: string): Promise<UpcomingMatchRow[]> {
  try {
    const supabase = createAdminClient();
    const start = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("matches")
      .select("id,home_team,away_team,scheduled_at,venue,phase")
      .eq("tournament", internalSlug)
      .neq("home_team", "TBD")
      .neq("away_team", "TBD")
      .gte("scheduled_at", start)
      .lte("scheduled_at", end)
      .order("scheduled_at", { ascending: true })
      .limit(30);
    if (error || !data) return [];
    return data as UpcomingMatchRow[];
  } catch {
    return [];
  }
}

export default async function TorneoPage({ params }: PageProps) {
  const t = findByPublicSlug((await params).slug);
  if (!t) notFound();

  const site = await getSiteFromHeaders();
  const isEs = site.locale === "es";
  const upcoming = await fetchUpcoming(t.internalSlug);
  const structure = TOURNAMENT_STRUCTURE[t.internalSlug];
  const phaseGridColumns = !structure || structure.phases.length <= 2
    ? "sm:grid-cols-2"
    : structure.phases.length === 4 || structure.phases.length === 7 || structure.phases.length % 4 === 0
      ? "sm:grid-cols-4"
      : "sm:grid-cols-3";

  const dateFmt = new Intl.DateTimeFormat(isEs ? "es-CO" : "en-US", {
    timeZone: "America/Bogota",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  const itemListJsonLd = upcoming.length > 0
    ? {
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: t.name[site.locale],
        itemListElement: upcoming.slice(0, 20).map((m, idx) => ({
          "@type": "ListItem",
          position: idx + 1,
          url: `${site.origin}/partidos/${buildMatchSlug({
            id: m.id,
            home_team: m.home_team,
            away_team: m.away_team,
            scheduled_at: m.scheduled_at,
          })}`,
          name: `${m.home_team} vs ${m.away_team}`,
        })),
      }
    : null;

  const orgJsonLd = {
    "@context": "https://schema.org",
    "@type": "SportsOrganization",
    name: t.name[site.locale],
    url: `${site.origin}/torneos/${t.publicSlug}`,
    sport: "Football",
  };

  return (
    <main className="min-h-screen bg-bg-base px-4 py-10 text-text-primary sm:px-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
      />
      {itemListJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }}
        />
      )}

      <div className="max-w-[720px] mx-auto">
        <p className="mb-3">
          <Link
            href={pathForLocale(site.locale, "torneos-index")}
            className="inline-flex min-h-11 items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-gold transition-opacity hover:opacity-80"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {isEs ? "Todos los torneos" : "All tournaments"}
          </Link>
        </p>
        <h1 className="lp-display mb-3 text-[42px] leading-none tracking-[0.03em] md:text-[54px]">
          {t.heading[site.locale]}
        </h1>
        <p className="mb-8 text-lg leading-relaxed text-text-secondary">{t.description[site.locale]}</p>

        <Link
          href="/login?returnTo=%2Fcasa"
          className="mb-10 inline-flex min-h-11 items-center justify-center rounded-full bg-gold px-6 font-semibold text-bg-base transition-all hover:brightness-110"
        >
          {isEs ? `Ingresar para participar en ${t.name.es}` : `Sign in to enter a ${t.name.en} pool`}
          <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
        </Link>

        {structure && structure.phases.length > 0 && (
          <section className="mb-10">
            <h2 className="lp-display mb-4 text-[28px] tracking-[0.04em]">
              {isEs ? "Fases del torneo" : "Tournament phases"}
            </h2>
            <ul className={`grid grid-cols-1 gap-2 ${phaseGridColumns}`}>
              {structure.phases.map((p) => (
                <li
                  key={p.phase}
                  className="lp-card p-3"
                >
                  <p className="font-medium">{p.label}</p>
                  {p.estimatedDate && (
                    <p className="mt-1 text-xs text-text-muted">
                      {isEs ? "Desde" : "From"} {p.estimatedDate}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {upcoming.length > 0 && (
          <section className="mb-10">
            <h2 className="lp-display mb-4 text-[28px] tracking-[0.04em]">
              {isEs ? "Próximos partidos" : "Upcoming matches"}
            </h2>
            <ul className="space-y-2">
              {upcoming.slice(0, 20).map((m) => {
                const slug = buildMatchSlug({
                  id: m.id,
                  home_team: m.home_team,
                  away_team: m.away_team,
                  scheduled_at: m.scheduled_at,
                });
                return (
                  <li key={m.id}>
                    <Link
                      href={pathForLocale(site.locale, "partido", slug)}
                      className="group lp-card flex min-h-[72px] items-center justify-between gap-3 p-3 transition-all hover:border-gold/30"
                    >
                      <div>
                        <p className="font-medium text-text-primary">
                          {m.home_team} <span className="text-text-secondary">vs</span> {m.away_team}
                        </p>
                        <p className="mt-1 text-xs text-text-secondary">
                          {dateFmt.format(new Date(m.scheduled_at))}
                          {m.venue ? ` · ${m.venue}` : ""}
                        </p>
                      </div>
                      <ChevronRight className="h-5 w-5 shrink-0 text-text-muted transition-colors group-hover:text-gold" aria-hidden="true" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="lp-card-hero p-6 text-center">
          <h2 className="text-xl font-bold text-text-primary">
            {isEs ? `Cómo participar en ${t.name.es}` : `How to enter a ${t.name.en} pool`}
          </h2>
          <ol className="mx-auto mt-3 max-w-md list-inside list-decimal space-y-1 text-left text-sm text-text-secondary">
            <li>{isEs ? "Entra con tu número de celular." : "Sign in with your phone number."}</li>
            <li>{isEs ? "Elige una polla publicada por la casa." : "Choose a pool published by the house."}</li>
            <li>{isEs ? "Paga la entrada." : "Pay the entry fee."}</li>
            <li>{isEs ? "Envía el comprobante." : "Submit the receipt."}</li>
            <li>{isEs ? "Pronostica y compite por el pozo." : "Make your picks and compete for the prize pool."}</li>
          </ol>
          <Link
            href="/login?returnTo=%2Fcasa"
            className="mt-5 inline-flex min-h-11 items-center justify-center rounded-full bg-gold px-6 font-semibold text-bg-base transition-all hover:brightness-110"
          >
            {isEs ? "Ingresar para participar" : "Sign in to enter"}
          </Link>
        </section>
      </div>
    </main>
  );
}
