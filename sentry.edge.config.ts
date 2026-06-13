// sentry.edge.config.ts — Init de Sentry en el runtime Edge (middleware y
// cualquier route con `runtime = "edge"`, ej. los opengraph-image).
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
