// components/layout/CapacitorReady.tsx
//
// Hides the native Capacitor splash screen when the React app first
// mounts. Without this, native splash auto-hides at 1.5s leaving the
// WebView blank during cold start + bundle download (10-30s on first
// launch). With this, native splash stays visible until React paints,
// then transitions smoothly into the React <SplashScreen /> video.
//
// Web (non-Capacitor) is a no-op — the dynamic import fails silently
// and we early-return.

"use client";

import { useEffect } from "react";

export function CapacitorReady() {
  useEffect(() => {
    // Skip on SSR.
    if (typeof window === "undefined") return;

    // Detect Capacitor at runtime. Window.Capacitor is injected by the
    // native bridge — absent on the regular web build.
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
      .Capacitor;
    if (!cap || typeof cap.isNativePlatform !== "function" || !cap.isNativePlatform()) {
      return;
    }

    // Lazy-load the plugin so the package doesn't bloat the web bundle.
    import("@capacitor/splash-screen")
      .then(({ SplashScreen }) => SplashScreen.hide())
      .catch(() => {
        /* plugin missing on this build — fine, splash auto-hides at launchShowDuration */
      });
  }, []);

  return null;
}

export default CapacitorReady;
