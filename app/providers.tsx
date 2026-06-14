// app/providers.tsx — PostHog (product analytics) en el navegador / WebView Capacitor.
// Patrón oficial PostHog para Next.js App Router: init a nivel de módulo
// (corre una vez en el cliente) + captura manual de $pageview en cada
// navegación client-side (App Router no dispara pageview nativo confiable).
"use client";

import posthog from "posthog-js";
import { PostHogProvider as PHProvider, usePostHog } from "posthog-js/react";
import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

// Init solo si hay key (en build sin key, PostHog queda inerte — no rompe nada).
// Se captura en dev y prod; en los dashboards de PostHog filtrás el tráfico
// local por `$host = localhost` para mantener limpia la "product truth".
if (typeof window !== "undefined" && process.env.NEXT_PUBLIC_POSTHOG_KEY) {
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
    api_host:
      process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
    // Solo crea perfil de persona para usuarios identificados → ahorra cuota
    // free (eventos anónimos no inflan MAU).
    person_profiles: "identified_only",
    // Pageview lo mandamos manual abajo (App Router). Pageleave sí automático.
    capture_pageview: false,
    capture_pageleave: true,
    // ANALYTICS-ONLY (decisión Santiago 2026-06-13): sin Session Replay ni
    // Surveys. La Polla tiene login por teléfono + reglas duras de Habeas Data,
    // y replay quema la cuota free. Mismo criterio que Sentry (replay OFF).
    // Si más adelante querés grabar sesiones puntuales, se prende acá con
    // masking. Autocapture (clicks) NO graba valores de inputs por default.
    disable_session_recording: true,
    disable_surveys: true,
    debug: process.env.NODE_ENV === "development",
  });
}

function PostHogPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const ph = usePostHog();

  useEffect(() => {
    if (!pathname || !ph) return;
    let url = window.origin + pathname;
    const qs = searchParams?.toString();
    if (qs) url += `?${qs}`;
    ph.capture("$pageview", { $current_url: url });
  }, [pathname, searchParams, ph]);

  return null;
}

// useSearchParams() obliga a un boundary de Suspense para no romper el SSG.
function SuspendedPostHogPageView() {
  return (
    <Suspense fallback={null}>
      <PostHogPageView />
    </Suspense>
  );
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  return (
    <PHProvider client={posthog}>
      <SuspendedPostHogPageView />
      {children}
    </PHProvider>
  );
}
