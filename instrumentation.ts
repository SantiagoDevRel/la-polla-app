// instrumentation.ts — Se ejecuta una vez al iniciar el servidor Next.js.
import * as Sentry from "@sentry/nextjs";

export async function register() {
  // Init de Sentry según runtime.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Captura errores de las requests del server (React Server Components, route
// handlers). Next.js 16 invokes this hook natively.
export const onRequestError = Sentry.captureRequestError;
