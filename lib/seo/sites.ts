// lib/seo/sites.ts — Configuración de sitios públicos por host.
//
// La app sirve dos dominios desde el mismo Next.js: lapollacolombiana.com
// (es-CO) y chickenpicks.app (en). El locale se resuelve en el middleware
// por host. Para SEO, cada dominio expone su propio sitemap, robots,
// llms.txt, OG y JSON-LD localizados.
//
// Este módulo centraliza la metadata estática del dominio para que el
// resto del código (sitemap.ts, robots.ts, layout.tsx, landings) lea
// un solo lugar.

import { headers } from "next/headers";

export type SiteLocale = "es" | "en";

export interface SiteConfig {
  locale: SiteLocale;
  /** Dominio canónico sin protocolo. */
  host: string;
  /** Origin completo con https. */
  origin: string;
  /** Lang attribute para <html>. */
  lang: string;
  /** Nombre de marca corto. */
  name: string;
  /** Tagline / claim. */
  tagline: string;
  /** Descripción corta para meta description / OG. */
  description: string;
  /** Sitio alterno (otro idioma) para hreflang. */
  alternate: { hrefLang: string; origin: string };
}

const ES: SiteConfig = {
  locale: "es",
  host: "lapollacolombiana.com",
  origin: "https://lapollacolombiana.com",
  lang: "es-CO",
  name: "La Polla Colombiana",
  tagline: "La polla deportiva de tus parceros",
  description:
    "Crea tu polla del Mundial 2026, Champions League, Copa Libertadores, Sudamericana o Liga BetPlay. Invita a tus amigos, predice resultados y gana. Gratis y en español.",
  alternate: { hrefLang: "en", origin: "https://chickenpicks.app" },
};

const EN: SiteConfig = {
  locale: "en",
  host: "chickenpicks.app",
  origin: "https://chickenpicks.app",
  lang: "en",
  name: "Chicken Picks",
  tagline: "The football pool app for friends",
  description:
    "Create your World Cup 2026, Champions League, Copa Libertadores, Sudamericana or Liga BetPlay pool. Invite your friends, predict scores and win. Free.",
  alternate: { hrefLang: "es-CO", origin: "https://lapollacolombiana.com" },
};

const HOST_TO_SITE: Record<string, SiteConfig> = {
  "lapollacolombiana.com": ES,
  "www.lapollacolombiana.com": ES,
  "chickenpicks.app": EN,
  "www.chickenpicks.app": EN,
};

/**
 * Resuelve el SiteConfig leyendo el header `host` del request actual.
 * En localhost / preview, decide por el header `x-locale` que setea el
 * middleware (resolveLocale → 'es' | 'en'). Default: ES (mercado primario).
 */
export function getSiteFromHeaders(): SiteConfig {
  const h = headers();
  const host = (h.get("host") ?? "").toLowerCase().split(":")[0];
  const exact = HOST_TO_SITE[host];
  if (exact) return exact;
  const localeHeader = (h.get("x-locale") ?? "").toLowerCase();
  if (localeHeader === "en") return EN;
  return ES;
}

export const SITES = { ES, EN };

/**
 * Devuelve el path locale-correcto para el tipo de landing dado.
 * En ES usamos /torneos y /partidos (palabras en español).
 * En EN usamos /tournaments y /matches.
 *
 * Las rutas EN son alias que renderean el mismo componente que las ES.
 * El sitemap, canonical y hreflang usan esta función para emitir el
 * path apropiado por dominio. Ambos paths existen en ambos dominios
 * para que un user que llegue al "wrong" path no vea 404 — pero el
 * canonical lo redirige (lógicamente) al path locale-correcto.
 */
export function pathForLocale(
  locale: SiteLocale,
  kind: "torneos-index" | "torneo" | "partidos-index" | "partido",
  slug?: string,
): string {
  const isEs = locale === "es";
  switch (kind) {
    case "torneos-index":
      return isEs ? "/torneos" : "/tournaments";
    case "torneo":
      return `${isEs ? "/torneos" : "/tournaments"}/${slug ?? ""}`;
    case "partidos-index":
      return isEs ? "/partidos" : "/matches";
    case "partido":
      return `${isEs ? "/partidos" : "/matches"}/${slug ?? ""}`;
  }
}
