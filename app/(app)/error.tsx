"use client";

// app/(app)/error.tsx — Boundary recuperable para TODO el árbol autenticado.
//
// Por qué existe: sin un error.tsx de segmento, un error de render en
// cualquier página de (app) (p.ej. /inicio) burbujea hasta las internals del
// App Router de Next y revienta con "Cannot read parallelRoutes of null" →
// pantalla blanca. Este boundary lo atrapa, reporta a Sentry y muestra una UI
// branded con un botón para reintentar el segmento sin recargar toda la app.
// (global-error.tsx solo cubre errores del root layout, no de las páginas.)
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { RotateCw } from "lucide-react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main className="min-h-[60vh] px-6 flex flex-col items-center justify-center text-center gap-4">
      <div className="w-16 h-16 rounded-full bg-bg-elevated border border-border-subtle flex items-center justify-center">
        <RotateCw className="w-7 h-7 text-gold" aria-hidden="true" />
      </div>
      <h1 className="font-display text-[28px] tracking-[0.04em] text-text-primary leading-none">
        Se nos enredó la cancha
      </h1>
      <p className="font-body text-[14px] text-text-secondary max-w-[320px] leading-snug">
        Tuvimos un problema cargando esta pantalla. Ya quedó registrado y lo
        estamos revisando. Probá de nuevo.
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="mt-1 inline-flex items-center gap-2 rounded-full bg-gold text-bg-base font-semibold px-5 py-3 hover:brightness-110 active:scale-[0.98] transition-all cursor-pointer"
      >
        <RotateCw className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
        Reintentar
      </button>
    </main>
  );
}
