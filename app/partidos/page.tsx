// app/partidos/page.tsx — Landing pública: listado de próximos partidos.
//
// Muestra todos los partidos programados en los próximos 14 días con link a
// la landing por partido. Sin auth, server component.

import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, ChevronRight } from "lucide-react";
import { getSiteFromHeaders, pathForLocale, SITES } from "@/lib/seo/sites";
import { TOURNAMENTS_SEO, findByInternalSlug } from "@/lib/seo/tournaments";
import { buildMatchSlug } from "@/lib/seo/match-slug";
import { createAdminClient } from "@/lib/supabase/admin";

export const revalidate = 600;

export async function generateMetadata(): Promise<Metadata> {
  const site = getSiteFromHeaders();
  const isEs = site.locale === "es";
  const title = isEs ? "Próximos partidos de fútbol" : "Upcoming football matches";
  const description = isEs
    ? "Calendario de partidos próximos del Mundial, Champions, Libertadores, Sudamericana, Liga BetPlay y ligas europeas. Hora, sede y dónde verlos."
    : "Upcoming match calendar for World Cup, Champions, Libertadores, Sudamericana, Liga BetPlay and European leagues. Kickoff time, venue, where to watch.";
  const canonical = pathForLocale(site.locale, "partidos-index");
  return {
    title,
    description,
    alternates: {
      canonical,
      languages: {
        "es-CO": `${SITES.ES.origin}${pathForLocale("es", "partidos-index")}`,
        en: `${SITES.EN.origin}${pathForLocale("en", "partidos-index")}`,
      },
    },
    openGraph: { title, description, url: canonical, type: "website" },
  };
}

interface MatchRow {
  id: string;
  home_team: string;
  away_team: string;
  scheduled_at: string;
  venue: string | null;
  tournament: string;
}

async function fetchUpcoming(): Promise<MatchRow[]> {
  try {
    const supabase = createAdminClient();
    const start = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("matches")
      .select("id,home_team,away_team,scheduled_at,venue,tournament")
      .neq("home_team", "TBD")
      .neq("away_team", "TBD")
      .gte("scheduled_at", start)
      .lte("scheduled_at", end)
      .order("scheduled_at", { ascending: true })
      .limit(100);
    if (error || !data) return [];
    return data as MatchRow[];
  } catch {
    return [];
  }
}

export default async function PartidosIndexPage() {
  const site = getSiteFromHeaders();
  const isEs = site.locale === "es";
  const matches = await fetchUpcoming();

  const dateFmt = new Intl.DateTimeFormat(isEs ? "es-CO" : "en-US", {
    timeZone: "America/Bogota",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const dayKeyFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dayHeadingFmt = new Intl.DateTimeFormat(isEs ? "es-CO" : "en-US", {
    timeZone: "America/Bogota",
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  // Agrupa por fecha (YYYY-MM-DD).
  const groups = new Map<string, MatchRow[]>();
  for (const m of matches) {
    const day = dayKeyFmt.format(new Date(m.scheduled_at));
    const arr = groups.get(day) ?? [];
    arr.push(m);
    groups.set(day, arr);
  }

  return (
    <main className="min-h-screen bg-bg-base px-4 py-10 text-text-primary sm:px-6">
      <div className="max-w-[720px] mx-auto">
        <p className="lp-label mb-3 text-gold">
          {isEs ? "Calendario" : "Calendar"}
        </p>
        <h1 className="lp-display mb-3 text-[42px] leading-none tracking-[0.03em] md:text-[54px]">
          {isEs ? "Próximos partidos" : "Upcoming matches"}
        </h1>
        <p className="mb-8 text-lg leading-relaxed text-text-secondary">
          {isEs
            ? "Todos los partidos confirmados de los próximos 14 días. Predice cualquiera de ellos en tu polla."
            : "All confirmed matches in the next 14 days. Predict any of them in your pool."}
        </p>

        {matches.length === 0 ? (
          <div className="lp-card flex flex-col items-center p-6 text-center">
            <CalendarDays className="mb-3 h-8 w-8 text-gold" aria-hidden="true" />
            <h2 className="lp-display text-[24px] tracking-[0.04em]">
              {isEs ? "Aún no hay partidos confirmados" : "No confirmed matches yet"}
            </h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-text-secondary">
              {isEs
                ? "Vuelve pronto para ver el calendario actualizado de los próximos 14 días."
                : "Check back soon for the updated 14-day match calendar."}
            </p>
            <Link
              href="/login"
              className="mt-5 inline-flex min-h-11 items-center justify-center rounded-full bg-gold px-6 font-semibold text-bg-base transition-all hover:brightness-110"
            >
              {isEs ? "Entrar a La Polla" : "Open Chicken Picks"}
            </Link>
          </div>
        ) : (
          <div className="space-y-8">
            {Array.from(groups.entries()).map(([day, ms]) => (
              <section key={day}>
                <h2 className="mb-3 text-sm uppercase tracking-wider text-text-secondary">
                  {dayHeadingFmt.format(new Date(`${day}T12:00:00-05:00`))}
                </h2>
                <ul className="space-y-2">
                  {ms.map((m) => {
                    const slug = buildMatchSlug({
                      id: m.id,
                      home_team: m.home_team,
                      away_team: m.away_team,
                      scheduled_at: m.scheduled_at,
                    });
                    const seoT = findByInternalSlug(m.tournament);
                    return (
                      <li key={m.id}>
                        <Link
                          href={pathForLocale(site.locale, "partido", slug)}
                          className="group lp-card flex min-h-[76px] items-center justify-between gap-3 p-3 transition-all hover:border-gold/30"
                        >
                          <div className="min-w-0">
                            <p className="font-medium leading-snug text-text-primary">
                              {m.home_team} <span className="text-text-secondary">vs</span> {m.away_team}
                            </p>
                            <p className="mt-1 text-xs leading-snug text-text-secondary">
                              {dateFmt.format(new Date(m.scheduled_at))}
                              {seoT ? ` · ${seoT.name[site.locale]}` : ""}
                            </p>
                          </div>
                          <ChevronRight
                            className="h-5 w-5 shrink-0 text-text-muted transition-colors group-hover:text-gold"
                            aria-hidden="true"
                          />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}

        {matches.length > 0 ? (
          <div className="lp-card-hero mt-10 p-6 text-center">
            <p className="text-xl font-bold text-text-primary">
              {isEs ? "Crea tu polla y empieza a predecir" : "Create your pool and start predicting"}
            </p>
            <Link
              href="/login"
              className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-gold px-6 font-semibold text-bg-base transition-all hover:brightness-110"
            >
              {isEs ? "Empezar gratis" : "Start free"}
            </Link>
          </div>
        ) : null}

        <nav
          className="mt-8"
          aria-label={isEs ? "Partidos por torneo" : "Matches by tournament"}
        >
          <p className="mb-3 text-xs uppercase tracking-wider text-text-muted">
            {isEs ? "También por torneo" : "Browse by tournament"}
          </p>
          <div className="flex flex-wrap gap-2">
            {TOURNAMENTS_SEO.map((t) => (
              <Link
                key={t.publicSlug}
                href={pathForLocale(site.locale, "torneo", t.publicSlug)}
                className="inline-flex min-h-11 items-center rounded-full border border-border-subtle bg-bg-elevated px-3 text-xs font-medium text-text-secondary transition-colors hover:border-gold/30 hover:text-gold"
              >
                {t.name[site.locale]}
              </Link>
            ))}
          </div>
        </nav>
      </div>
    </main>
  );
}
