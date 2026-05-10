// app/sitemap.ts — Sitemap dinámico host-aware.
//
// Incluye:
//   - Home + páginas públicas estáticas (privacy, soporte, login, delete-account)
//   - Index de torneos (/torneos) y un page por torneo conocido (/torneos/[slug])
//   - Index de partidos (/partidos) y un page por match programado en los
//     próximos 60 días — fuente de URLs long-tail "[equipo A] vs [equipo B]"
//   - Hreflang alternates entre lapollacolombiana.com y chickenpicks.app
//
// Lee directo de Supabase admin para no depender de RLS. Read-only.
// Si la query falla, devolvemos solo las URLs estáticas (no rompemos build).

import type { MetadataRoute } from "next";
import { getSiteFromHeaders, pathForLocale, SITES } from "@/lib/seo/sites";
import { TOURNAMENTS_SEO } from "@/lib/seo/tournaments";
import { buildMatchSlug } from "@/lib/seo/match-slug";
import { createAdminClient } from "@/lib/supabase/admin";

export const revalidate = 3600; // sitemap se regenera cada hora

type SitemapEntry = MetadataRoute.Sitemap[number];

/**
 * Para un path "ya localizado" (ej. /torneos/mundial-2026 si estamos
 * en ES, o /tournaments/mundial-2026 en EN), arma el grupo de hreflang
 * con el path equivalente del otro idioma.
 */
function alternatesForLocaleAware(
  esPath: string,
  enPath: string,
): SitemapEntry["alternates"] {
  return {
    languages: {
      "es-CO": `${SITES.ES.origin}${esPath}`,
      en: `${SITES.EN.origin}${enPath}`,
    },
  };
}

/** Para paths que no cambian por locale (login, privacy, etc). */
function alternatesFor(path: string): SitemapEntry["alternates"] {
  return alternatesForLocaleAware(path, path);
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = getSiteFromHeaders();
  const now = new Date();

  // Paths estables (mismos en ambos idiomas).
  const staticPaths: Array<{ path: string; priority: number; changeFreq: SitemapEntry["changeFrequency"] }> = [
    { path: "/", priority: 1.0, changeFreq: "daily" },
    { path: "/login", priority: 0.5, changeFreq: "monthly" },
    { path: "/privacy", priority: 0.3, changeFreq: "yearly" },
    { path: "/soporte", priority: 0.4, changeFreq: "monthly" },
    { path: "/delete-account", priority: 0.2, changeFreq: "yearly" },
  ];

  const entries: MetadataRoute.Sitemap = staticPaths.map(({ path, priority, changeFreq }) => ({
    url: `${site.origin}${path}`,
    lastModified: now,
    changeFrequency: changeFreq,
    priority,
    alternates: alternatesFor(path),
  }));

  // Indexes (locale-aware path).
  const torneosIndex = pathForLocale(site.locale, "torneos-index");
  const partidosIndex = pathForLocale(site.locale, "partidos-index");
  entries.push({
    url: `${site.origin}${torneosIndex}`,
    lastModified: now,
    changeFrequency: "daily",
    priority: 0.9,
    alternates: alternatesForLocaleAware(
      pathForLocale("es", "torneos-index"),
      pathForLocale("en", "torneos-index"),
    ),
  });
  entries.push({
    url: `${site.origin}${partidosIndex}`,
    lastModified: now,
    changeFrequency: "hourly",
    priority: 0.9,
    alternates: alternatesForLocaleAware(
      pathForLocale("es", "partidos-index"),
      pathForLocale("en", "partidos-index"),
    ),
  });

  for (const t of TOURNAMENTS_SEO) {
    const localPath = pathForLocale(site.locale, "torneo", t.publicSlug);
    entries.push({
      url: `${site.origin}${localPath}`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.85,
      alternates: alternatesForLocaleAware(
        pathForLocale("es", "torneo", t.publicSlug),
        pathForLocale("en", "torneo", t.publicSlug),
      ),
    });
  }

  // Próximos 60 días de partidos programados.
  try {
    const supabase = createAdminClient();
    const cutoffEnd = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
    const cutoffStart = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("matches")
      .select("id,home_team,away_team,scheduled_at,status")
      .neq("home_team", "TBD")
      .neq("away_team", "TBD")
      .gte("scheduled_at", cutoffStart)
      .lte("scheduled_at", cutoffEnd)
      .order("scheduled_at", { ascending: true })
      .limit(500);

    if (!error && data) {
      for (const m of data) {
        const slug = buildMatchSlug({
          id: m.id as string,
          home_team: m.home_team as string,
          away_team: m.away_team as string,
          scheduled_at: m.scheduled_at as string,
        });
        const localPath = pathForLocale(site.locale, "partido", slug);
        entries.push({
          url: `${site.origin}${localPath}`,
          lastModified: new Date(m.scheduled_at as string),
          changeFrequency: "hourly",
          priority: 0.7,
          alternates: alternatesForLocaleAware(
            pathForLocale("es", "partido", slug),
            pathForLocale("en", "partido", slug),
          ),
        });
      }
    }
  } catch {
    // Si falla la conexión a Supabase (build sin env vars, etc.), seguimos
    // con las URLs estáticas. Mejor un sitemap parcial que un 500.
  }

  return entries;
}
