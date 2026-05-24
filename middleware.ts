// middleware.ts — Resolución de locale por dominio (host-pinned).
//
// Diseño:
//   - lapollacolombiana.com → siempre 'es'. Punto.
//   - chickenpicks.app → siempre 'en'. Punto.
//   - Sin auto-redirect por geo. Si el user tipea chickenpicks.app, ve EN
//     aunque esté en Colombia. Lo opuesto también.
//   - Sin set-cookie en redirects. La cookie quedó en producción solo
//     para localhost/preview/Capacitor (donde no hay un dominio "natural"
//     que dicte el locale).
//   - El toggle en /perfil es el ÚNICO mecanismo de cambio de locale en
//     producción: redirige al otro dominio. Cero magia con cookies en prod.
//
// Razón: el diseño previo (geo-redirect + set-cookie en chickenpicks.app)
// envenenaba el dominio EN con una cookie 'es' para visitantes desde CO,
// haciendo que próximas visitas a chickenpicks.app vieran ES en vez de EN.
import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

type Locale = "es" | "en";

const HOST_ES = "lapollacolombiana.com";
const HOST_EN = "chickenpicks.app";

// Países hispanoparlantes — usado solo en non-prod (localhost/preview)
// como fallback cuando no hay cookie ni Accept-Language.
const ES_COUNTRIES = new Set([
  "CO", "MX", "AR", "CL", "PE", "VE", "EC", "GT", "CU", "DO",
  "BO", "HN", "PY", "SV", "NI", "CR", "PR", "UY", "PA", "ES", "GQ",
]);

function isLocale(value: string | undefined | null): value is Locale {
  return value === "es" || value === "en";
}

function resolveLocale(request: NextRequest, host: string): Locale {
  // 1. Producción: dominio dicta el locale, sin excepciones. La cookie
  //    NO override en prod porque el user tipeó la URL — su intención
  //    está clara.
  if (host === HOST_EN) return "en";
  if (host === HOST_ES) return "es";

  // 2. Non-prod (localhost / Vercel preview / Capacitor WebView con host
  //    no estándar): cookie → geo → Accept-Language → 'en'.
  const cookie = request.cookies.get("NEXT_LOCALE")?.value;
  if (isLocale(cookie)) return cookie;

  const country = (request.headers.get("x-vercel-ip-country") ?? "").toUpperCase();
  if (country && ES_COUNTRIES.has(country)) return "es";

  const accept = request.headers.get("accept-language") ?? "";
  if (/^\s*es\b/i.test(accept)) return "es";

  return "en";
}

export async function middleware(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").toLowerCase();
  const locale = resolveLocale(request, host);

  // Stamp del locale en headers del request para que i18n/request.ts lo
  // lea al render de RSC. Mutamos request.headers in-place — updateSession
  // pasa el mismo request a NextResponse.next({ request }) y la mutación
  // se propaga al downstream RSC.
  request.headers.set("x-locale", locale);

  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Se aplica a todas las rutas excepto:
     * - _next/static, _next/image (Next.js built-in)
     * - favicon, manifest, sw.js, workbox-*.js (PWA shell)
     * - icons/, sounds/, fonts/ (carpetas estáticas en /public)
     * - .well-known/ (assetlinks.json, apple-app-site-association)
     * - apple-touch-icon*, android-chrome*, mstile* (PWA icon variants)
     * - reset.html (página utilitaria sin auth)
     * - Archivos estáticos por extensión: imágenes, fonts, audio,
     *   css/js/maps, ico, html
     *
     * IMPORTANTE: sitemap.xml, robots.txt, llms.txt NO se excluyen acá
     * porque el outer middleware setea x-locale en headers, que esos
     * route handlers leen en localhost/preview (en prod usan Host).
     * Igualmente son baratos: updateSession() hace early-return para
     * ellos antes de tocar Supabase.
     *
     * Verificado: ninguna ruta /api/* termina en .json — todos los
     * route.ts viven en directorios, no en archivos con extensión.
     * Por eso excluimos .json sin riesgo (cubre manifest.json y assets).
     */
    "/((?!_next/static|_next/image|favicon\\.ico|icons/|sounds/|fonts/|manifest\\.json|sw\\.js|workbox-.*\\.js|reset\\.html|\\.well-known/|apple-touch-icon.*|android-chrome.*|mstile.*|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|html|woff|woff2|ttf|otf|mp3|wav|ogg|css|js|map|json)$).*)",
  ],
};
