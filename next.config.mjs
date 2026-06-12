// next.config.mjs — Configuración de Next.js + PWA via @serwist/next.
// Reemplaza next-pwa (abandonado desde 2023). Serwist es el sucesor
// mantenido del mismo modelo Workbox; las reglas de cache viven en
// app/sw.ts en lugar de inferirse del config.
import withSerwistInit from "@serwist/next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  // No SW en development — el rebuild constante deja entradas precache
  // huérfanas y empezás a debuggear cosas que no son tuyas.
  disable: process.env.NODE_ENV === "development",
  // Reload de pestañas que estaban cargadas cuando vuelve la conexión.
  reloadOnOnline: true,
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  generateEtags: false,
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
      { protocol: "https", hostname: "api.dicebear.com" },
      { protocol: "https", hostname: "avatars.dicebear.com" },
      { protocol: "https", hostname: "cdn.jsdelivr.net" },
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
      // Existing cache headers
      {
        source: "/tournaments/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
      {
        source: "/pollitos/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
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
              process.env.NODE_ENV === "development"
                ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com"
                : "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              // i.ytimg.com: thumbnails de los highlights del Mundial (FIFA
              // YouTube) en /inicio. a.espncdn.com: fotos de jugadores/escudos
              // para futuras fichas de equipo. Todo hotlink, sin self-host.
              "img-src 'self' data: blob: https://api.dicebear.com https://avatars.dicebear.com https://crests.football-data.org https://a.espncdn.com https://i.ytimg.com https://*.supabase.co https://cdn.jsdelivr.net",
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://graph.facebook.com",
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
