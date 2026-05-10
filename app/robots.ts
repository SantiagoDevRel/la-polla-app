// app/robots.ts — robots.txt dinámico, host-aware.
//
// El sitemap apunta al host actual (lapollacolombiana.com o
// chickenpicks.app) leído del request via getSiteFromHeaders.
//
// Bloqueamos /api/, /admin/ y rutas auth-gated cuyo contenido no aporta
// nada al crawler. /pollas/ está auth-gated y los slugs de pollas
// privadas no deben aparecer en SERPs.

import type { MetadataRoute } from "next";
import { getSiteFromHeaders } from "@/lib/seo/sites";

export default function robots(): MetadataRoute.Robots {
  const site = getSiteFromHeaders();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/admin/",
          "/inicio",
          "/avisos",
          "/perfil",
          "/dashboard",
          "/preview",
          "/invites/",
          "/unirse/",
          "/onboarding",
          "/delete-account",
          "/pollas/",
        ],
      },
    ],
    sitemap: `${site.origin}/sitemap.xml`,
    host: site.origin,
  };
}
