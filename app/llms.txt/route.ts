// app/llms.txt/route.ts — Markdown-style index para LLMs/agentes (ChatGPT
// search, Perplexity, Claude search, etc.) según el draft "llms.txt".
//
// Host-aware: lapollacolombiana.com sirve la versión ES, chickenpicks.app
// la versión EN. Mismo sitemap pero contenido localizado.
//
// Spec: https://llmstxt.org/

import { getSiteFromHeaders, pathForLocale } from "@/lib/seo/sites";
import { TOURNAMENTS_SEO } from "@/lib/seo/tournaments";

export const dynamic = "force-dynamic";

export function GET() {
  const site = getSiteFromHeaders();
  const isEs = site.locale === "es";

  const tournamentLines = TOURNAMENTS_SEO.map(
    (t) =>
      `- [${t.name[site.locale]}](${site.origin}${pathForLocale(site.locale, "torneo", t.publicSlug)}): ${t.description[site.locale]}`,
  ).join("\n");
  const partidosUrl = `${site.origin}${pathForLocale(site.locale, "partidos-index")}`;

  const body = isEs
    ? `# ${site.name}

> ${site.description}

${site.name} es una app web (PWA) y móvil (Android/iOS) gratuita para crear pollas deportivas (quinielas) entre amigos. Soporta los principales torneos de fútbol mundial, sudamericano y colombiano. Cada participante predice resultados; el sistema calcula puntos automáticamente y muestra el ranking en tiempo real.

## Cómo funciona
- [Crear una polla](${site.origin}/login): elige torneo, fija nombre y costo de entrada, comparte el código con tus parceros.
- [Unirme con código](${site.origin}/login): pegá el código que te pasó tu amigo y entrá a su polla.
- [Privacidad](${site.origin}/privacy)
- [Soporte](${site.origin}/soporte)

## Torneos disponibles
${tournamentLines}

## Próximos partidos
- [Listado de partidos próximos con preview, hora y dónde verlos](${partidosUrl})

## Versión en inglés
- [Chicken Picks (English)](https://chickenpicks.app)
`
    : `# ${site.name}

> ${site.description}

${site.name} is a free web (PWA) and mobile (Android/iOS) app to create football pools with friends. It supports major international, South American, and Colombian football tournaments. Each player predicts match results; the system computes points automatically and shows the ranking in real time.

## How it works
- [Create a pool](${site.origin}/login): pick a tournament, set name and entry cost, share the code with your friends.
- [Join with a code](${site.origin}/login): paste the code your friend sent you and enter their pool.
- [Privacy](${site.origin}/privacy)
- [Support](${site.origin}/soporte)

## Available tournaments
${tournamentLines}

## Upcoming matches
- [List of upcoming matches with preview, kickoff time, and where to watch](${partidosUrl})

## Spanish version
- [La Polla Colombiana (Español)](https://lapollacolombiana.com)
`;

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
