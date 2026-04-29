// next.config.mjs — Configuración de Next.js + PWA via @serwist/next.
// Reemplaza next-pwa (abandonado desde 2023). Serwist es el sucesor
// mantenido del mismo modelo Workbox; las reglas de cache viven en
// app/sw.ts en lugar de inferirse del config.
import withSerwistInit from "@serwist/next";

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
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
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
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: blob: https://api.dicebear.com https://avatars.dicebear.com https://crests.football-data.org https://a.espncdn.com",
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://graph.facebook.com",
              "frame-src https://challenges.cloudflare.com",
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

export default withSerwist(nextConfig);
