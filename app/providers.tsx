// app/providers.tsx — PostHog (product analytics) en el navegador / WebView Capacitor.
// PostHog carga después de `load` + idle para no competir con la pantalla.
// La captura manual de $pageview sigue cada navegación del App Router.
"use client";

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { PostHog } from "posthog-js";

let postHogPromise: Promise<PostHog | null> | undefined;

function afterLoadAndIdle(): Promise<void> {
  return new Promise((resolve) => {
    const queueIdle = () => {
      const idleWindow = window as Window & {
        requestIdleCallback?: (
          callback: () => void,
          options?: { timeout: number },
        ) => number;
      };
      if (idleWindow.requestIdleCallback) {
        idleWindow.requestIdleCallback(resolve, { timeout: 3_000 });
      } else {
        window.setTimeout(resolve, 1_200);
      }
    };

    if (document.readyState === "complete") queueIdle();
    else window.addEventListener("load", queueIdle, { once: true });
  });
}

function getPostHog(): Promise<PostHog | null> {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key || typeof window === "undefined") return Promise.resolve(null);
  if (postHogPromise) return postHogPromise;

  postHogPromise = afterLoadAndIdle()
    .then(async () => {
      const { default: posthog } = await import("posthog-js");
      posthog.init(key, {
        api_host:
          process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
        person_profiles: "identified_only",
        capture_pageview: false,
        capture_pageleave: true,
        // Analytics-only: clicks + pageviews, without remote add-ons.
        autocapture: true,
        advanced_disable_flags: true,
        capture_dead_clicks: false,
        capture_heatmaps: false,
        capture_performance: false,
        disable_external_dependency_loading: true,
        disable_session_recording: true,
        disable_surveys: true,
        debug: process.env.NODE_ENV === "development",
      });
      return posthog;
    })
    .catch(() => {
      // A chunk/network failure should not disable analytics for the whole
      // document. The next real route transition can retry after the page is
      // already interactive.
      postHogPromise = undefined;
      return null;
    });

  return postHogPromise;
}

function PostHogPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const scheduledUrl = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname) return;
    let url = window.origin + pathname;
    const qs = searchParams?.toString();
    if (qs) url += `?${qs}`;
    // Keep every real route transition that occurs while the deferred import
    // is pending. The ref only removes React's repeated effect for the same URL.
    if (scheduledUrl.current === url) return;
    scheduledUrl.current = url;
    void getPostHog().then((posthog) => {
      posthog?.capture("$pageview", { $current_url: url });
    });
  }, [pathname, searchParams]);

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
    <>
      <SuspendedPostHogPageView />
      {children}
    </>
  );
}
