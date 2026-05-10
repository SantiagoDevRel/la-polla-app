// lib/seo/match-slug.ts — Slug helpers para landings públicas /partidos/[slug].
//
// Slug determinístico: "<home>-vs-<away>-YYYY-MM-DD". Reversible vía
// matches.id (UUID) que también incluimos como fallback al final cuando
// hay colisión teórica. Para SEO el slug "human" es el canónico.

const NORMALIZE = /[^a-z0-9]+/g;
const TRIM = /^-+|-+$/g;

function slugifyTeam(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(NORMALIZE, "-")
    .replace(TRIM, "");
}

export interface MatchForSlug {
  id: string;
  home_team: string;
  away_team: string;
  scheduled_at: string;
}

export function buildMatchSlug(m: MatchForSlug): string {
  const home = slugifyTeam(m.home_team);
  const away = slugifyTeam(m.away_team);
  const date = new Date(m.scheduled_at).toISOString().slice(0, 10);
  // Sufijo corto del UUID por si dos partidos coinciden en teams+fecha
  // (ida/vuelta del mismo día por ejemplo). 6 chars bastan.
  const suffix = m.id.replace(/-/g, "").slice(0, 6);
  return `${home}-vs-${away}-${date}-${suffix}`;
}

export function extractIdSuffix(slug: string): string | null {
  // Extrae el sufijo de 6 hex del final del slug.
  const match = slug.match(/-([a-f0-9]{6})$/);
  return match ? match[1] : null;
}

/**
 * Extrae la fecha YYYY-MM-DD que está justo antes del sufijo hex.
 * Slug: "<home>-vs-<away>-YYYY-MM-DD-<6hex>".
 */
export function extractDate(slug: string): string | null {
  const match = slug.match(/-(\d{4}-\d{2}-\d{2})-[a-f0-9]{6}$/);
  return match ? match[1] : null;
}
