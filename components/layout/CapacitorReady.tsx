// components/layout/CapacitorReady.tsx
//
// Runs once on mount inside the Capacitor native shell to:
//   1) Hide the native splash screen (it stays visible until React
//      paints, then we hand off to the React <SplashScreen /> video).
//   2) Style the Android status bar to match the app's dark theme so
//      it does not flash white on launch.
//
// Web (non-Capacitor) is a no-op — every dynamic import is gated by an
// isNativePlatform() check, and plugin failures are swallowed.

"use client";

import { useEffect } from "react";

export function CapacitorReady() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
      .Capacitor;
    if (!cap || typeof cap.isNativePlatform !== "function" || !cap.isNativePlatform()) {
      return;
    }

    // 1) Hide native splash (handoff to React splash).
    import("@capacitor/splash-screen")
      .then(({ SplashScreen }) => SplashScreen.hide())
      .catch(() => {
        /* plugin missing — splash auto-hides at launchShowDuration */
      });

    // 2) Status bar style: dark background (#080c10) + light icons,
    // overlapping disabled so content does not slide under it.
    import("@capacitor/status-bar")
      .then(async ({ StatusBar, Style }) => {
        await StatusBar.setStyle({ style: Style.Dark });
        await StatusBar.setBackgroundColor({ color: "#080c10" });
        await StatusBar.setOverlaysWebView({ overlay: false });
      })
      .catch(() => {
        /* plugin missing or unsupported — no-op */
      });
  }, []);

  return null;
}

export default CapacitorReady;
