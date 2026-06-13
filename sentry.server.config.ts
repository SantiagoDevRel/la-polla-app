// sentry.server.config.ts — Init de Sentry en el runtime Node (route handlers,
// server components, server actions, crons). Acá caen los errores críticos:
// pagos, settlement, scoring, webhooks de WhatsApp.
import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/lib/sentry-scrub";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  initialScope: { tags: { app: "la-polla" } },
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  enabled:
    process.env.NODE_ENV === "production" || process.env.SENTRY_FORCE === "1",
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  beforeSend: scrubEvent,
});
