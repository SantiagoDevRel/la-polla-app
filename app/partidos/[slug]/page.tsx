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
import { ArrowLeft } from "lucide-react";
import { getSiteFromHeaders, pathForLocale, SITES } from "@/lib/seo/sites";
import { findByInternalSlug } from "@/lib/seo/tournaments";
import { buildMatchSlug, extractDate } from "@/lib/seo/match-slug";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTournamentName } from "@/lib/tournaments";
import { TeamMark } from "@/components/match/TeamMark";

export const revalidate = 600;

interface PageProps {
  params: Promise<{ slug: string }>;
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
  const m = await fetchMatch((await params).slug);
  if (!m) return { robots: { index: false, follow: false } };
  const site = await getSiteFromHeaders();
  const isEs = site.locale === "es";
  const seoT = findByInternalSlug(m.tournament);
  const tournamentName = seoT
    ? seoT.name[site.locale]
    : getTournamentName(m.tournament, site.locale);
  const date = new Date(m.scheduled_at);
  const dateLabel = new Intl.DateTimeFormat(isEs ? "es-CO" : "en-US", {
    timeZone: "America/Bogota",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
  const title = isEs
    ? `${m.home_team} vs ${m.away_team} — ${tournamentName}`
    : `${m.home_team} vs ${m.away_team} — ${tournamentName}`;
  const description = isEs
    ? `${m.home_team} contra ${m.away_team} el ${dateLabel}${m.venue ? ` en ${m.venue}` : ""}. Consulta la hora. Si la casa publica una polla, paga la entrada y pronostica el marcador.`
    : `${m.home_team} vs ${m.away_team} on ${dateLabel}${m.venue ? ` at ${m.venue}` : ""}. Check the kickoff time. If the house publishes a pool, pay the entry fee and predict the score.`;
  const canonical = pathForLocale(site.locale, "partido", (await params).slug);
  return {
    title,
    description,
    alternates: {
      canonical,
      languages: {
        "es-CO": `${SITES.ES.origin}${pathForLocale("es", "partido", (await params).slug)}`,
        en: `${SITES.EN.origin}${pathForLocale("en", "partido", (await params).slug)}`,
      },
    },
    openGraph: { title, description, url: canonical, type: "website" },
  };
}

export default async function PartidoPage({ params }: PageProps) {
  const m = await fetchMatch((await params).slug);
  if (!m) notFound();

  const site = await getSiteFromHeaders();
  const isEs = site.locale === "es";
  const seoT = findByInternalSlug(m.tournament);
  const tournamentName = seoT
    ? seoT.name[site.locale]
    : getTournamentName(m.tournament, site.locale);
  const date = new Date(m.scheduled_at);
  const dateLabel = new Intl.DateTimeFormat(isEs ? "es-CO" : "en-US", {
    timeZone: "America/Bogota",
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
    <main className="min-h-screen bg-bg-base px-4 py-10 text-text-primary sm:px-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(sportsEventJsonLd) }}
      />
      <div className="max-w-[720px] mx-auto">
        <nav className="mb-3 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-gold" aria-label={isEs ? "Ruta del partido" : "Match breadcrumb"}>
          <Link href={pathForLocale(site.locale, "partidos-index")} className="inline-flex min-h-11 items-center gap-2 transition-opacity hover:opacity-80">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {isEs ? "Todos los partidos" : "All matches"}
          </Link>
          {seoT && (
            <>
              {" · "}
              <Link href={pathForLocale(site.locale, "torneo", seoT.publicSlug)} className="inline-flex min-h-11 items-center transition-opacity hover:opacity-80">
                {seoT.name[site.locale]}
              </Link>
            </>
          )}
        </nav>

        <h1 className="lp-display mb-3 text-[42px] leading-none tracking-[0.03em] md:text-[54px]">
          {m.home_team} <span className="text-text-secondary">vs</span> {m.away_team}
        </h1>
        <p className="mb-2 text-lg leading-relaxed text-text-secondary">
          <time dateTime={m.scheduled_at}>{dateLabel}</time>
          {m.venue ? ` · ${m.venue}` : ""}
        </p>
        <p className="mb-8 text-sm text-text-muted">{tournamentName}</p>

        <div className="grid grid-cols-2 gap-3 mb-10">
          <article className="lp-card p-5 text-center transition-all hover:border-gold/20">
            <TeamMark name={m.home_team} src={m.home_team_flag} />
            <p className="mb-1 text-xs text-text-muted">{isEs ? "Local" : "Home"}</p>
            <p className="font-semibold text-lg">{m.home_team}</p>
          </article>
          <article className="lp-card p-5 text-center transition-all hover:border-gold/20">
            <TeamMark name={m.away_team} src={m.away_team_flag} />
            <p className="mb-1 text-xs text-text-muted">{isEs ? "Visitante" : "Away"}</p>
            <p className="font-semibold text-lg">{m.away_team}</p>
          </article>
        </div>

        {m.status === "finished" && m.home_score !== null && m.away_score !== null && (
          <section className="lp-card-hero mb-10 p-5">
            <h2 className="mb-2 text-xs uppercase tracking-wider text-text-secondary">
              {isEs ? "Resultado final" : "Final score"}
            </h2>
            <p className="lp-display text-[40px] tabular-nums tracking-[0.06em]">
              {m.home_score} <span className="text-text-muted">—</span> {m.away_score}
            </p>
          </section>
        )}

        <section className="lp-card-hero mb-10 p-6 text-center">
          <h2 className="text-xl font-bold text-text-primary">
            {isEs
              ? `Pronostica ${m.home_team} vs ${m.away_team} en una polla`
              : `Predict ${m.home_team} vs ${m.away_team} in a pool`}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">
            {isEs
              ? "La casa confirma cada entrada y el pozo se reparte entre quienes más aciertan."
              : "The house confirms each entry and the prize pool goes to whoever gets the most right."}
          </p>
          <Link
            href="/login?returnTo=%2Fcasa"
            className="mt-5 inline-flex min-h-11 items-center justify-center rounded-full bg-gold px-6 font-semibold text-bg-base transition-all hover:brightness-110"
          >
            {isEs ? "Ingresar para participar" : "Sign in to enter"}
          </Link>
        </section>

        <section className="space-y-3 text-sm leading-relaxed text-text-secondary">
          <h2 className="text-lg font-semibold text-text-primary">
            {isEs ? "Sobre este partido" : "About this match"}
          </h2>
          <p>
            {isEs
              ? `${m.home_team} se enfrenta a ${m.away_team} ${seoT ? `por ${seoT.name.es}` : ""} el ${dateLabel}${m.venue ? ` en ${m.venue}` : ""}.`
              : `${m.home_team} face ${m.away_team} ${seoT ? `in ${seoT.name.en}` : ""} on ${dateLabel}${m.venue ? ` at ${m.venue}` : ""}.`}
          </p>
          <p>
            {isEs
              ? "Puedes participar cuando la casa publique una polla que incluya este partido."
              : "You can enter when the house publishes a pool that includes this match."}
          </p>
        </section>
      </div>
    </main>
  );
}
