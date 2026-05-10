// app/partidos/page.tsx — Landing pública: listado de próximos partidos.
//
// Muestra todos los partidos programados en los próximos 14 días con link a
// la landing por partido. Sin auth, server component.

import type { Metadata } from "next";
import Link from "next/link";
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
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  // Agrupa por fecha (YYYY-MM-DD).
  const groups = new Map<string, MatchRow[]>();
  for (const m of matches) {
    const day = new Date(m.scheduled_at).toISOString().slice(0, 10);
    const arr = groups.get(day) ?? [];
    arr.push(m);
    groups.set(day, arr);
  }

  return (
    <main className="min-h-screen bg-[#0d0d0d] text-white px-5 py-10">
      <div className="max-w-[720px] mx-auto">
        <p className="text-xs tracking-[0.2em] uppercase text-[#FCD116] mb-3">
          {isEs ? "Calendario" : "Calendar"}
        </p>
        <h1 className="text-4xl md:text-5xl font-bold leading-tight mb-3">
          {isEs ? "Próximos partidos" : "Upcoming matches"}
        </h1>
        <p className="text-white/70 mb-8 text-lg">
          {isEs
            ? "Todos los partidos confirmados de los próximos 14 días. Predice cualquiera de ellos en tu polla."
            : "All confirmed matches in the next 14 days. Predict any of them in your pool."}
        </p>

        {matches.length === 0 ? (
          <p className="text-white/50">
            {isEs ? "Sin partidos próximos confirmados todavía." : "No confirmed upcoming matches yet."}
          </p>
        ) : (
          <div className="space-y-8">
            {Array.from(groups.entries()).map(([day, ms]) => (
              <section key={day}>
                <h2 className="text-sm uppercase tracking-wider text-white/50 mb-3">
                  {new Intl.DateTimeFormat(isEs ? "es-CO" : "en-US", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  }).format(new Date(`${day}T12:00:00`))}
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
                          className="flex justify-between items-center rounded-lg border border-white/10 hover:border-[#FCD116] transition p-3 bg-white/[0.03]"
                        >
                          <div>
                            <p className="font-medium">
                              {m.home_team} <span className="text-white/40">vs</span> {m.away_team}
                            </p>
                            <p className="text-white/50 text-xs">
                              {dateFmt.format(new Date(m.scheduled_at))}
                              {seoT ? ` · ${seoT.name[site.locale]}` : ""}
                            </p>
                          </div>
                          <span className="text-[#FCD116] text-sm">→</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}

        <div className="mt-10 rounded-xl bg-[#FCD116] text-black p-6 text-center">
          <p className="font-bold text-xl mb-2">
            {isEs ? "Crea tu polla y empieza a predecir" : "Create your pool and start predicting"}
          </p>
          <Link
            href="/login"
            className="inline-block bg-black text-white font-semibold px-6 py-3 rounded-full"
          >
            {isEs ? "Empezar gratis" : "Start free"}
          </Link>
        </div>

        <p className="text-white/40 text-xs mt-8">
          {isEs ? "También por torneo: " : "Browse by tournament: "}
          {TOURNAMENTS_SEO.map((t, i) => (
            <span key={t.publicSlug}>
              {i > 0 ? " · " : ""}
              <Link href={pathForLocale(site.locale, "torneo", t.publicSlug)} className="underline hover:text-[#FCD116]">
                {t.name[site.locale]}
              </Link>
            </span>
          ))}
        </p>
      </div>
    </main>
  );
}
