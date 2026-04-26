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
  NetworkOnly,
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
const NEVER_CACHE_PATHS: RegExp[] = [
  /\/api\/auth\//,
  /\/api\/whatsapp\/webhook/,
  /\/api\/admin\//,
  /\/login/,
  /\/verify/,
  /\/set-password/,
  /\/invites\/polla\//,
  /\/onboarding/,
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
    // defaultCache provides sensible runtime caching for static assets,
    // images, fonts, and JS chunks. Anything not matched by the
    // NetworkOnly rule above falls through to these defaults.
    ...defaultCache,
  ],
});

serwist.addEventListeners();
