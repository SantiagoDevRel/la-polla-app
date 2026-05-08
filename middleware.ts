// middleware.ts — Resolución de locale (cookie > geo > Accept-Language > default)
// + soft-redirect entre dominios (lapollacolombiana.com ↔ chickenpicks.app)
// + delegación a updateSession() de Supabase para auth/onboarding gates.
import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

type Locale = "es" | "en";

const HOST_ES = "lapollacolombiana.com";
const HOST_EN = "chickenpicks.app";

// Países hispanoparlantes — locale 'es' por geo.
// Resto del mundo (anglos + no-hispanos) → 'en'.
const ES_COUNTRIES = new Set([
  "CO", "MX", "AR", "CL", "PE", "VE", "EC", "GT", "CU", "DO",
  "BO", "HN", "PY", "SV", "NI", "CR", "PR", "UY", "PA", "ES", "GQ",
]);

function isLocale(value: string | undefined | null): value is Locale {
  return value === "es" || value === "en";
}

function resolveLocale(request: NextRequest): Locale {
  // 1. Cookie del usuario (set por /perfil) gana sobre todo.
  const cookie = request.cookies.get("NEXT_LOCALE")?.value;
  if (isLocale(cookie)) return cookie;

  // 2. Geo (Vercel inyecta x-vercel-ip-country en producción).
  const country = (request.headers.get("x-vercel-ip-country") ?? "").toUpperCase();
  if (country && ES_COUNTRIES.has(country)) return "es";

  // 3. Fallback browser. Útil en desarrollo y en países sin geo conocido.
  const accept = request.headers.get("accept-language") ?? "";
  if (/^\s*es\b/i.test(accept)) return "es";

  // 4. Default global → en.
  return "en";
}

function isProductionHost(host: string): boolean {
  if (!host) return false;
  if (host.startsWith("localhost") || host.startsWith("127.0.0.1")) return false;
  if (host.endsWith(".vercel.app")) return false;
  return host === HOST_ES || host === HOST_EN;
}

function targetHostFor(locale: Locale): string {
  return locale === "es" ? HOST_ES : HOST_EN;
}

export async function middleware(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").toLowerCase();
  const locale = resolveLocale(request);
  const hasCookie = !!request.cookies.get("NEXT_LOCALE");

  // Soft-redirect: solo en producción, solo en primera visita (sin cookie),
  // y solo si el host actual no coincide con el locale resuelto.
  if (isProductionHost(host) && !hasCookie) {
    const target = targetHostFor(locale);
    if (host !== target) {
      const url = request.nextUrl.clone();
      url.host = target;
      url.protocol = "https:";
      url.port = "";
      const response = NextResponse.redirect(url);
      // Persistir la elección (también para no entrar en bucle de redirects).
      response.cookies.set("NEXT_LOCALE", locale, {
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
        sameSite: "lax",
        secure: true,
      });
      return response;
    }
  }

  // Stamp del locale en headers del request para que i18n/request.ts lo lea
  // al render de RSC. Mutamos en el sitio porque updateSession() pasa el
  // mismo request a NextResponse.next({ request }).
  request.headers.set("x-locale", locale);

  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Se aplica a todas las rutas excepto:
     * - _next/static (archivos estáticos)
     * - _next/image (optimización de imágenes)
     * - favicon.ico (favicon)
     * - Archivos públicos (svg, png, jpg, etc.)
     */
    "/((?!_next/static|_next/image|favicon.ico|icons/|manifest.json|reset\\.html|\\.well-known/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|html)$).*)",
  ],
};
