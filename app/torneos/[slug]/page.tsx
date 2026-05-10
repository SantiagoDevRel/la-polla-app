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
import { getSiteFromHeaders, pathForLocale, SITES } from "@/lib/seo/sites";
import { TOURNAMENTS_SEO, findByPublicSlug } from "@/lib/seo/tournaments";
import { buildMatchSlug } from "@/lib/seo/match-slug";
import { TOURNAMENT_STRUCTURE } from "@/lib/tournaments/structure";
import { createAdminClient } from "@/lib/supabase/admin";

export const revalidate = 1800;

interface PageProps {
  params: { slug: string };
}

export function generateStaticParams() {
  return TOURNAMENTS_SEO.map((t) => ({ slug: t.publicSlug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = findByPublicSlug(params.slug);
  if (!t) return {};
  const site = getSiteFromHeaders();
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
  const t = findByPublicSlug(params.slug);
  if (!t) notFound();

  const site = getSiteFromHeaders();
  const isEs = site.locale === "es";
  const upcoming = await fetchUpcoming(t.internalSlug);
  const structure = TOURNAMENT_STRUCTURE[t.internalSlug];

  const dateFmt = new Intl.DateTimeFormat(isEs ? "es-CO" : "en-US", {
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
    <main className="min-h-screen bg-[#0d0d0d] text-white px-5 py-10">
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
        <p className="text-xs tracking-[0.2em] uppercase text-[#FCD116] mb-3">
          <Link href={pathForLocale(site.locale, "torneos-index")} className="hover:underline">
            {isEs ? "← Todos los torneos" : "← All tournaments"}
          </Link>
        </p>
        <h1 className="text-4xl md:text-5xl font-bold leading-tight mb-3">
          {t.heading[site.locale]}
        </h1>
        <p className="text-white/70 mb-8 text-lg">{t.description[site.locale]}</p>

        <Link
          href="/login"
          className="inline-block bg-[#FCD116] text-black font-semibold px-6 py-3 rounded-full mb-10"
        >
          {isEs ? `Crear polla del ${t.name.es} →` : `Create ${t.name.en} pool →`}
        </Link>

        {structure && structure.phases.length > 0 && (
          <section className="mb-10">
            <h2 className="text-2xl font-bold mb-4">
              {isEs ? "Fases del torneo" : "Tournament phases"}
            </h2>
            <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {structure.phases.map((p) => (
                <li
                  key={p.phase}
                  className="rounded-lg border border-white/10 bg-white/[0.03] p-3"
                >
                  <p className="font-medium">{p.label}</p>
                  {p.estimatedDate && (
                    <p className="text-white/50 text-xs">
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
            <h2 className="text-2xl font-bold mb-4">
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
                      className="flex justify-between items-center rounded-lg border border-white/10 hover:border-[#FCD116] transition p-3 bg-white/[0.03]"
                    >
                      <div>
                        <p className="font-medium">
                          {m.home_team} <span className="text-white/40">vs</span> {m.away_team}
                        </p>
                        <p className="text-white/50 text-xs">
                          {dateFmt.format(new Date(m.scheduled_at))}
                          {m.venue ? ` · ${m.venue}` : ""}
                        </p>
                      </div>
                      <span className="text-[#FCD116] text-sm">→</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="rounded-xl bg-[#FCD116] text-black p-6 text-center">
          <h2 className="font-bold text-xl mb-2">
            {isEs ? `¿Cómo armar tu polla del ${t.name.es}?` : `How to start your ${t.name.en} pool`}
          </h2>
          <ol className="text-left max-w-md mx-auto mb-4 list-decimal list-inside text-sm space-y-1">
            <li>{isEs ? "Entra con tu número de celular." : "Sign in with your phone number."}</li>
            <li>{isEs ? `Elige "${t.name.es}" como torneo.` : `Pick "${t.name.en}" as the tournament.`}</li>
            <li>{isEs ? "Pon nombre y costo de entrada." : "Set name and entry cost."}</li>
            <li>{isEs ? "Comparte el código con tus parceros." : "Share the code with your friends."}</li>
            <li>{isEs ? "Predicen, juegan, ganan." : "Predict, play, win."}</li>
          </ol>
          <Link
            href="/login"
            className="inline-block bg-black text-white font-semibold px-6 py-3 rounded-full"
          >
            {isEs ? "Empezar gratis" : "Start free"}
          </Link>
        </section>
      </div>
    </main>
  );
}
