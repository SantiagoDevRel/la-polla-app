// next.config.mjs — Configuración de Next.js + PWA via @serwist/next.
// Reemplaza next-pwa (abandonado desde 2023). Serwist es el sucesor
// mantenido del mismo modelo Workbox; las reglas de cache viven en
// app/sw.ts en lugar de inferirse del config.
import withSerwistInit from "@serwist/next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

// Isolated integration tests use the local Supabase stack. This is never
// enabled by NODE_ENV alone and cannot add arbitrary origins to production.
const localStorageCsp = process.env.CASA_LOCAL_TEST === "1"
  && process.env.NEXT_PUBLIC_SUPABASE_URL === "http://127.0.0.1:54321"
  ? " http://127.0.0.1:54321" : "";

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  // No SW en development — el rebuild constante deja entradas precache
  // huérfanas y empezás a debuggear cosas que no son tuyas.
  disable: process.env.NODE_ENV === "development",
  // Reload de pestañas que estaban cargadas cuando vuelve la conexión.
  reloadOnOnline: false,
  // Install the shell first. Preloading the whole public directory downloaded
  // 507 assets (including videos) and delayed worker activation for minutes.
  // Club crests, players, backgrounds and league logos use runtime caching.
  globPublicPatterns: [
    'manifest.json',
    'icons/icon-192x192.png',
    'icons/icon-512x512.png',
  ],
  // Los chunks grandes se guardan cuando realmente se usan mediante el cache
  // runtime. Evita que la instalación del worker adelante PostHog y el pack
  // de banderas; los iconos explícitos de arriba se conservan en el shell.
  maximumFileSizeToCacheInBytes: 256 * 1024,
  // Next emite un stub estático por cada Route Handler. El browser nunca
  // solicita esos `app/api/**/route` chunks, pero precachearlos agregaba 98
  // requests a cada instalación del worker.
  manifestTransforms: [
    (entries) => ({
      manifest: entries.filter(
        ({ url }) => !url.includes("/chunks/app/api/"),
      ),
      warnings: [],
    }),
  ],
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_APP_BUILD_ID: process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_URL || process.env.APP_BUILD_ID || 'development',
  },
  reactStrictMode: true,
  generateEtags: false,
  // Playwright serves the app on localhost but opens it through 127.0.0.1.
  // Declare that local origin explicitly for Next's development CSRF guard.
  allowedDevOrigins: ["127.0.0.1"],
  // Keep framework chrome out of visual regression screenshots and prevent
  // the dev-tools badge from covering controls near the bottom-left corner.
  devIndicators: false,
  async redirects() {
    return [{ source: '/pollas/crear', destination: '/casa', permanent: false }];
  },
  images: {
    // Whitelist explícita de los hosts que servimos via next/image.
    // hostname: "**" actuaba como proxy abierto bajo nuestra cuota Vercel
    // Image Optimization — un attacker podía explotarlo para bill-amplification
    // (10MB de imágenes con queries únicas revientan el free-tier en minutos)
    // y para servir contenido phishing bajo nuestro dominio.
    // Si hace falta agregar un host: añadirlo acá Y al CSP img-src abajo.
    remotePatterns: [
      { protocol: "https", hostname: "crests.football-data.org" },
      { protocol: "https", hostname: "a.espncdn.com" },
      { protocol: "https", hostname: "**.supabase.co" },
    ],
    // Permitir SVGs optimizados para los logos de torneos bajo /public/tournaments.
    // Los archivos son estáticos y están bajo nuestro control; el CSP extra y el
    // Content-Disposition: attachment sandbox el render como defensa adicional.
    dangerouslyAllowSVG: true,
    contentDispositionType: "attachment",
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
  async headers() {
    return [
      // iOS Universal Links — el archivo apple-app-site-association NO tiene
      // extensión, así que Next lo serviría como octet-stream. Apple exige
      // Content-Type: application/json y acceso público sin redirect (el
      // matcher del middleware ya excluye /.well-known/). Sin este header,
      // iOS ignora el archivo y los magic-links abren Safari en vez de la app.
      {
        source: "/.well-known/apple-app-site-association",
        headers: [
          { key: "Content-Type", value: "application/json" },
        ],
      },
      // Los escudos WebP llevan hash de contenido en el nombre. Pueden vivir
      // un año en el navegador sin revalidaciones ni riesgo de quedar viejos.
      {
        source: "/team-crests/:file([0-9a-f]{16}-96\\.webp)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      // Estos nombres son estables y pueden reemplazarse en un deploy. Un TTL
      // corto con SWR evita viajes repetidos sin congelar una versión vieja.
      {
        source: "/videos/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
      {
        source: "/flags/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
      {
        source: "/tournaments/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=300, stale-while-revalidate=86400",
          },
        ],
      },
      {
        source: "/pollitos/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=300, stale-while-revalidate=86400",
          },
        ],
      },
      // Security headers — all routes
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // 'unsafe-eval' removido en prod (defense-in-depth contra XSS).
              // Next.js 14 + framer-motion + serwist + Capacitor WebView no
              // requieren eval en build de producción; si una nueva lib lo
              // necesita, evaluar antes de reintroducirlo. 'unsafe-inline'
              // se mantiene porque Next.js App Router todavía emite inline
              // scripts; migrar a nonce-based CSP queda pendiente.
              // En DEV reactivamos 'unsafe-eval' porque Next.js dev HMR
              // (React Refresh) lo necesita — sin eso, la JS se rompe en
              // hidratación, los handlers de React no se atachan, y los
              // forms hacen native-submit (page reload) al primer click.
              // PostHog corre analytics-only desde el bundle: flags, replay,
              // surveys y dependencias externas quedan apagados en providers.
              process.env.NODE_ENV === "development"
                ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com"
                : "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              // i.ytimg.com: thumbnails de los highlights del Mundial (FIFA
              // YouTube) en /inicio. a.espncdn.com: fotos de jugadores/escudos
              // para futuras fichas de equipo. Todo hotlink, sin self-host.
              "img-src 'self' data: blob: https://crests.football-data.org https://a.espncdn.com https://media.api-sports.io https://upload.wikimedia.org https://i.ytimg.com https://*.supabase.co" + localStorageCsp,
              // us.i.posthog.com recibe eventos; no se cargan scripts remotos.
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://graph.facebook.com https://us.i.posthog.com" + localStorageCsp,
              // www.youtube.com + youtube-nocookie: embed inline de highlights
              // del Mundial (canales de broadcasters que permiten embed).
              "frame-src https://challenges.cloudflare.com https://www.youtube.com https://www.youtube-nocookie.com",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default withNextIntl(withSerwist(nextConfig));
