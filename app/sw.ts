// app/sw.ts — Service worker source for the La Polla PWA, compiled by
// @serwist/next into public/sw.js at build time.
//
// Goals:
//   1) Allow PWA install + offline fallback for static assets.
//   2) NEVER cache authenticated routes — auth pages, OTP delivery, and
//      the admin endpoints have to hit the network every time so a stale
//      SW cannot serve an expired or impersonated response.
//   3) Keep the runtime cache strategy conservative since we ship to
//      mid-range phones where extra fetch work hurts.
import { defaultCache } from "@serwist/next/worker";
import {
  type PrecacheEntry,
  type SerwistGlobalConfig,
  Serwist,
  CacheFirst,
  ExpirationPlugin,
  NetworkOnly,
  StaleWhileRevalidate,
} from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    // Precache manifest injected at build time by @serwist/next.
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// Paths that must always hit the network. The SW must never serve a
// stale response on the auth flow or any API surface, so we register a
// single NetworkOnly handler that matches any of these patterns and
// runs BEFORE the defaultCache rules below it.
//
// /api/ — ALL API endpoints. Antes solo cacheábamos auth/admin/webhook
// pero /api/pollas/[slug] estaba cayendo al defaultCache, lo que hacía
// que los scores de matches live se vieran stale (cliente refrescaba y
// veía la respuesta cacheada en vez del DB fresh). Bloqueamos toda /api/
// y el cache del cliente ya queda en headers HTTP de cada endpoint.
const NEVER_CACHE_PATHS: RegExp[] = [
  /^\/api\//,
  // El panel administra acceso y muestra datos personales del directorio.
  /^\/admin(\/|$)/,
  /\/login/,
  /\/invites\/polla\//,
  /\/onboarding/,
  // Kill-switch: si un user queda atrapado con un SW corrupto/viejo,
  // visitar /reset.html ejecuta JS que desuscribe TODOS los SWs y
  // limpia caches. Tiene que pegar al network siempre.
  /^\/reset\.html$/,
  // HTML de pollas/inicio cambia con cada deploy (refs nuevas a chunks
  // JS). Si lo cachea el SW, el cliente carga JS viejo con data API
  // fresca → bug visual (minute calculado en lugar de elapsed). Forzar
  // network garantiza chunks correctos.
  /^\/pollas(\/|$)/,
  /^\/inicio(\/|$)/,
  /^\/avisos(\/|$)/,
  /^\/perfil(\/|$)/,
  // La casa (2026-08-25). Acá el riesgo de cachear no es solo cargar un
  // chunk JS viejo: estas pantallas muestran PLATA y un contador de cierre.
  // Un pozo cacheado de hace media hora le miente a alguien que está por
  // pagar, y un contador congelado lo deja creyendo que todavía alcanza a
  // entrar. Siempre a la red.
  /^\/casa(\/|$)/,
  /^\/futbol(\/|$)/,
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      matcher: ({ url }: { url: URL }) =>
        url.origin === self.location.origin &&
        NEVER_CACHE_PATHS.some((re) => re.test(url.pathname)),
      handler: new NetworkOnly(),
    },
    // Un worker anterior pudo guardar HTML bajo una URL de video después de
    // seguir un redirect a login. Esta regla evita leer ese cache heredado;
    // el cache HTTP del navegador sigue reutilizando los rangos según headers.
    {
      matcher: ({ url }: { url: URL }) =>
        url.origin === self.location.origin &&
        url.pathname.startsWith("/videos/") &&
        /\.(?:mp4|webm)$/i.test(url.pathname),
      handler: new NetworkOnly(),
    },
    // Los escudos WebP tienen hash de contenido. Mantener el catálogo entero
    // evita que el límite genérico de 64 imágenes lo expulse constantemente.
    {
      matcher: ({ url }: { url: URL }) =>
        url.origin === self.location.origin &&
        /^\/team-crests\/[0-9a-f]{16}-96\.webp$/i.test(url.pathname),
      handler: new CacheFirst({
        cacheName: "lp-team-crests",
        plugins: [
          new ExpirationPlugin({
            maxEntries: 800,
            maxAgeSeconds: 365 * 24 * 60 * 60,
            maxAgeFrom: "last-used",
          }),
        ],
      }),
    },
    // Pollitos, banderas y logos pueden reemplazarse conservando el nombre.
    // SWR entrega el cache al instante y actualiza la copia en segundo plano.
    {
      matcher: ({ url }: { url: URL }) =>
        url.origin === self.location.origin &&
        /^\/(?:pollitos|tournaments|flags)\//.test(url.pathname),
      handler: new StaleWhileRevalidate({
        cacheName: "lp-art",
        plugins: [
          new ExpirationPlugin({
            maxEntries: 320,
            maxAgeSeconds: 30 * 24 * 60 * 60,
            maxAgeFrom: "last-used",
          }),
        ],
      }),
    },
    // defaultCache provides sensible runtime caching for static assets,
    // images, fonts, and JS chunks. Anything not matched by the
    // NetworkOnly rule above falls through to these defaults.
    ...defaultCache,
  ],
});

serwist.addEventListeners();

// Skip-waiting on demand: el cliente puede mandar
// postMessage({type:'SKIP_WAITING'}) cuando detecta un SW waiting (ver
// components/layout/SWAutoReload.tsx). Activamos de inmediato — sin
// esperar al próximo reload natural. Combinado con clientsClaim:true,
// el cliente recibe controllerchange y recarga.
self.addEventListener("message", (event: ExtendableMessageEvent) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});
