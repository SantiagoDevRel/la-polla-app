// sentry.client.config.ts — Init de Sentry en el navegador / WebView Capacitor.
// (Next 14 todavía usa este archivo; instrumentation-client.ts es 15.3+.)
import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/lib/sentry-scrub";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Tag por app: un solo proyecto Sentry ("santi-apps") agrupa varias apps;
  // este tag las separa adentro. Cuando sumes otra app, le ponés su tag.
  initialScope: { tags: { app: "la-polla" } },

  // dev | preview | production (Vercel setea NEXT_PUBLIC_VERCEL_ENV en build).
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV,

  // Solo manda en prod. Para probar local: NEXT_PUBLIC_SENTRY_FORCE=1.
  enabled:
    process.env.NODE_ENV === "production" ||
    process.env.NEXT_PUBLIC_SENTRY_FORCE === "1",

  // Free tier: muestreo bajo de performance. Los ERRORES van al 100%.
  tracesSampleRate: 0.1,

  // Session Replay APAGADO a propósito (devora la cuota gratis). No se agrega
  // replayIntegration. Si más adelante querés replay, se prende acá con sample bajo.

  // No mandar IP / cookies por default. El scrub de abajo es la 2da capa.
  sendDefaultPii: false,
  beforeSend: scrubEvent,
});
