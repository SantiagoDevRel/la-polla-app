// proxy.ts — Resolución de locale por dominio (host-pinned).
//
// Diseño:
//   - lapollacolombiana.com → siempre 'es'. Punto.
//   - chickenpicks.app → siempre 'en'. Punto.
//   - Sin auto-redirect por geo. Si el user tipea chickenpicks.app, ve EN
//     aunque esté en Colombia. Lo opuesto también.
//   - La Polla, localhost, preview y Capacitor siempre usan español.
//     Las cookies NEXT_LOCALE anteriores ya no cambian el idioma.
//   - El perfil no ofrece selector de idioma. El dominio inglés conserva
//     su configuración independiente, sin redirects por idioma o cookies.
//
// Razón: el diseño previo (geo-redirect + set-cookie en chickenpicks.app)
// envenenaba el dominio EN con una cookie 'es' para visitantes desde CO,
// haciendo que próximas visitas a chickenpicks.app vieran ES en vez de EN.
import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

type Locale = "es" | "en";

const HOST_EN = "chickenpicks.app";

function resolveLocale(host: string): Locale {
  // Solo el dominio inglés usa sus traducciones. Las preferencias del
  // navegador y las cookies antiguas no cambian el español de La Polla.
  return host === HOST_EN ? "en" : "es";
}

export async function proxy(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").toLowerCase();

  // www → apex, 308 permanente. Las cookies de Supabase son host-only
  // (sin Domain=): un user logueado en lapollacolombiana.com que entra
  // por www.lapollacolombiana.com cae en un cookie jar VACÍO y la app lo
  // manda a /login aunque tenga sesión válida en el apex ("me pide login
  // cada vez", reporte Fede/Lady 2026-06-11). Un solo host canónico
  // elimina la dualidad. Aplica a ambos dominios (www.chickenpicks.app
  // incluido). En localhost/preview no hay www, no-op.
  if (host.startsWith("www.")) {
    const url = new URL(request.nextUrl.pathname + request.nextUrl.search, `https://${host.slice(4)}`);
    return NextResponse.redirect(url, 308);
  }

  // ── Rutas retiradas con el pivote a la casa (2026-08-25) ───────────────
  // El producto pasó de pollas P2P a una casa centralizada. Estas pantallas
  // eran del modelo viejo y ya no forman parte de la app:
  //
  //   /inicio, /dashboard   el tablero P2P (mis pollas, podio, evolución)
  //   /road-to-worldcup     las llaves de un Mundial que terminó en julio
  //
  // Se resuelve acá y no borrando las páginas a propósito: los archivos
  // quedan intactos y revivir cualquiera es sacarla de esta lista. Ojo con
  // lo que NO está acá: /pollas y /pollas/[slug] siguen alcanzables por URL
  // directa —  salieron del nav, pero son la única forma de consultar las
  // 62 pollas y los 15.426 pronósticos del histórico. /pollas/crear no
  // necesita entrada acá: ya lo bloquea P2P_CREATION_RETIRED.
  const RETIRADAS = ["/inicio", "/dashboard", "/road-to-worldcup"];
  const path = request.nextUrl.pathname;
  if (RETIRADAS.some((r) => path === r || path.startsWith(`${r}/`))) {
    const url = request.nextUrl.clone();
    url.pathname = "/casa";
    url.search = "";
    return NextResponse.redirect(url, 307); // temporal: es una decisión de producto, no una URL muerta
  }

  const locale = resolveLocale(host);

  // Stamp del locale en headers del request para que i18n/request.ts lo
  // lea al render de RSC. Mutamos request.headers in-place — updateSession
  // pasa el mismo request a NextResponse.next({ request }) y la mutación
  // se propaga al downstream RSC.
  request.headers.set("x-locale", locale);

  const response = await updateSession(request);

  // Preview de UI iOS desde browser: ?ios=1 setea cookie sticky, ?ios=0
  // la limpia. En producción, el wrapper Capacitor iOS se detecta por
  // User-Agent — el query param es solo para verificar localmente cómo
  // se vería la app antes del rebuild.
  const iosParam = request.nextUrl.searchParams.get("ios");
  if (iosParam === "1") {
    response.cookies.set("lp_ios_preview", "1", {
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 días
      sameSite: "lax",
    });
  } else if (iosParam === "0") {
    response.cookies.delete("lp_ios_preview");
  }

  return response;
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
     * porque el proxy raíz setea x-locale en headers, que esos
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
