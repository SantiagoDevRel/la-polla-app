// app/partidos/[slug]/page.tsx — Landing pública por partido.
//
// El slug encodea "<home>-vs-<away>-YYYY-MM-DD-<6hex>". Buscamos el match
// por sufijo del UUID (extractIdSuffix). Si no lo encontramos, 404.
//
// Server component, dynamic. JSON-LD SportsEvent con teams, fecha, sede.
// Pensado para que Google y agentes (ChatGPT/Perplexity) puedan citar
// "Real Madrid vs Barcelona — pronostico" con datos reales.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSiteFromHeaders, pathForLocale, SITES } from "@/lib/seo/sites";
import { findByInternalSlug } from "@/lib/seo/tournaments";
import { buildMatchSlug, extractDate } from "@/lib/seo/match-slug";
import { createAdminClient } from "@/lib/supabase/admin";

export const revalidate = 600;

interface PageProps {
  params: { slug: string };
}

interface MatchRow {
  id: string;
  home_team: string;
  away_team: string;
  scheduled_at: string;
  venue: string | null;
  tournament: string;
  phase: string | null;
  home_team_flag: string | null;
  away_team_flag: string | null;
  home_score: number | null;
  away_score: number | null;
  status: string;
}

async function fetchMatch(slug: string): Promise<MatchRow | null> {
  const date = extractDate(slug);
  if (!date) return null;
  try {
    const supabase = createAdminClient();
    // El slug incluye la fecha YYYY-MM-DD del partido. Consultamos los
    // matches en una ventana ±36h (cubre TZ shift) y filtramos por slug
    // reconstruido en JS — evita ILIKE sobre uuid (no funciona) y nos
    // protege de colisiones sin tener que hacer LIKE indexado.
    const start = new Date(`${date}T00:00:00Z`);
    start.setHours(start.getHours() - 36);
    const end = new Date(`${date}T23:59:59Z`);
    end.setHours(end.getHours() + 36);
    const { data, error } = await supabase
      .from("matches")
      .select(
        "id,home_team,away_team,scheduled_at,venue,tournament,phase,home_team_flag,away_team_flag,home_score,away_score,status",
      )
      .gte("scheduled_at", start.toISOString())
      .lte("scheduled_at", end.toISOString())
      .neq("home_team", "TBD")
      .neq("away_team", "TBD")
      .limit(200);
    if (error || !data || data.length === 0) return null;
    for (const candidate of data) {
      const c = candidate as MatchRow;
      const expected = buildMatchSlug({
        id: c.id,
        home_team: c.home_team,
        away_team: c.away_team,
        scheduled_at: c.scheduled_at,
      });
      if (expected === slug) return c;
    }
    return null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const m = await fetchMatch(params.slug);
  if (!m) return { robots: { index: false, follow: false } };
  const site = getSiteFromHeaders();
  const isEs = site.locale === "es";
  const seoT = findByInternalSlug(m.tournament);
  const tournamentName = seoT ? seoT.name[site.locale] : m.tournament;
  const date = new Date(m.scheduled_at);
  const dateLabel = new Intl.DateTimeFormat(isEs ? "es-CO" : "en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
  const title = isEs
    ? `${m.home_team} vs ${m.away_team} — ${tournamentName}`
    : `${m.home_team} vs ${m.away_team} — ${tournamentName}`;
  const description = isEs
    ? `${m.home_team} contra ${m.away_team} el ${dateLabel}${m.venue ? ` en ${m.venue}` : ""}. Pronóstico, hora y cómo armar tu polla para predecir el resultado.`
    : `${m.home_team} vs ${m.away_team} on ${dateLabel}${m.venue ? ` at ${m.venue}` : ""}. Preview, kickoff time and how to set up your pool to predict the result.`;
  const canonical = pathForLocale(site.locale, "partido", params.slug);
  return {
    title,
    description,
    alternates: {
      canonical,
      languages: {
        "es-CO": `${SITES.ES.origin}${pathForLocale("es", "partido", params.slug)}`,
        en: `${SITES.EN.origin}${pathForLocale("en", "partido", params.slug)}`,
      },
    },
    openGraph: { title, description, url: canonical, type: "website" },
  };
}

export default async function PartidoPage({ params }: PageProps) {
  const m = await fetchMatch(params.slug);
  if (!m) notFound();

  const site = getSiteFromHeaders();
  const isEs = site.locale === "es";
  const seoT = findByInternalSlug(m.tournament);
  const date = new Date(m.scheduled_at);
  const dateLabel = new Intl.DateTimeFormat(isEs ? "es-CO" : "en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);

  const sportsEventJsonLd = {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    name: `${m.home_team} vs ${m.away_team}`,
    sport: "Football",
    startDate: m.scheduled_at,
    eventStatus:
      m.status === "cancelled"
        ? "https://schema.org/EventCancelled"
        : m.status === "live"
          ? "https://schema.org/EventScheduled"
          : "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: m.venue
      ? { "@type": "Place", name: m.venue }
      : { "@type": "VirtualLocation", url: site.origin },
    competitor: [
      { "@type": "SportsTeam", name: m.home_team },
      { "@type": "SportsTeam", name: m.away_team },
    ],
    organizer: seoT
      ? { "@type": "SportsOrganization", name: seoT.name[site.locale] }
      : undefined,
  };

  return (
    <main className="min-h-screen bg-[#0d0d0d] text-white px-5 py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(sportsEventJsonLd) }}
      />
      <div className="max-w-[720px] mx-auto">
        <p className="text-xs tracking-[0.2em] uppercase text-[#FCD116] mb-3">
          <Link href={pathForLocale(site.locale, "partidos-index")} className="hover:underline">
            {isEs ? "← Todos los partidos" : "← All matches"}
          </Link>
          {seoT && (
            <>
              {" · "}
              <Link href={pathForLocale(site.locale, "torneo", seoT.publicSlug)} className="hover:underline">
                {seoT.name[site.locale]}
              </Link>
            </>
          )}
        </p>

        <h1 className="text-4xl md:text-5xl font-bold leading-tight mb-3">
          {m.home_team} <span className="text-white/40">vs</span> {m.away_team}
        </h1>
        <p className="text-white/70 text-lg mb-2">
          <time dateTime={m.scheduled_at}>{dateLabel}</time>
          {m.venue ? ` · ${m.venue}` : ""}
        </p>
        {seoT && (
          <p className="text-white/60 text-sm mb-8">{seoT.name[site.locale]}</p>
        )}

        <div className="grid grid-cols-2 gap-3 mb-10">
          <article className="rounded-xl border border-white/10 bg-white/[0.03] p-5 text-center">
            {m.home_team_flag && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={m.home_team_flag}
                alt=""
                className="h-12 w-12 mx-auto mb-3 object-contain"
              />
            )}
            <p className="text-xs text-white/40 mb-1">{isEs ? "Local" : "Home"}</p>
            <p className="font-semibold text-lg">{m.home_team}</p>
          </article>
          <article className="rounded-xl border border-white/10 bg-white/[0.03] p-5 text-center">
            {m.away_team_flag && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={m.away_team_flag}
                alt=""
                className="h-12 w-12 mx-auto mb-3 object-contain"
              />
            )}
            <p className="text-xs text-white/40 mb-1">{isEs ? "Visitante" : "Away"}</p>
            <p className="font-semibold text-lg">{m.away_team}</p>
          </article>
        </div>

        {m.status === "finished" && m.home_score !== null && m.away_score !== null && (
          <section className="mb-10 rounded-xl border border-white/10 p-5">
            <h2 className="text-xs uppercase tracking-wider text-white/50 mb-2">
              {isEs ? "Resultado final" : "Final score"}
            </h2>
            <p className="text-3xl font-bold">
              {m.home_score} <span className="text-white/40">—</span> {m.away_score}
            </p>
          </section>
        )}

        <section className="rounded-xl bg-[#FCD116] text-black p-6 text-center mb-10">
          <h2 className="font-bold text-xl mb-2">
            {isEs
              ? `Predice ${m.home_team} vs ${m.away_team} en tu polla`
              : `Predict ${m.home_team} vs ${m.away_team} in your pool`}
          </h2>
          <p className="text-sm mb-4 opacity-80">
            {isEs
              ? "Crea una polla con tus parceros, predice el marcador y compitan por puntos."
              : "Create a pool with friends, predict the score and compete for points."}
          </p>
          <Link
            href="/login"
            className="inline-block bg-black text-white font-semibold px-6 py-3 rounded-full"
          >
            {isEs ? "Crear polla gratis" : "Create pool — free"}
          </Link>
        </section>

        <section className="text-white/60 text-sm space-y-3">
          <h2 className="text-white text-lg font-semibold">
            {isEs ? "Sobre este partido" : "About this match"}
          </h2>
          <p>
            {isEs
              ? `${m.home_team} se enfrenta a ${m.away_team} ${seoT ? `por ${seoT.name.es}` : ""} el ${dateLabel}${m.venue ? ` en ${m.venue}` : ""}.`
              : `${m.home_team} face ${m.away_team} ${seoT ? `in ${seoT.name.en}` : ""} on ${dateLabel}${m.venue ? ` at ${m.venue}` : ""}.`}
          </p>
          <p>
            {isEs
              ? "Si querés pronosticar este partido con tus amigos, podés crear una polla en minutos."
              : "If you want to predict this match with friends, you can create a pool in minutes."}
          </p>
        </section>
      </div>
    </main>
  );
}
