// instrumentation.ts — Se ejecuta una vez al iniciar el servidor Next.js.
import * as Sentry from "@sentry/nextjs";

export async function register() {
  // Dev helper existente (no tocar).
  if (process.env.NODE_ENV === "development") {
    const { ensureDevUser } = await import("@/lib/utils/dev-helpers");
    await ensureDevUser();
  }

  // Init de Sentry según runtime.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Captura errores de las requests del server (React Server Components, route
// handlers). Se activa nativamente en Next 15; en Next 14 es inofensivo.
export const onRequestError = Sentry.captureRequestError;
