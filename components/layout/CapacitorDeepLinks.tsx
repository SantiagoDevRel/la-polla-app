// components/layout/CapacitorDeepLinks.tsx
//
// When the app is opened via an external URL (Android App Link, magic
// login link from WhatsApp, polla invite share, etc.), Capacitor fires
// 'appUrlOpen'. We intercept it and navigate the WebView to the path
// of the URL — without this, the app just sits on whatever route was
// previously loaded and the user wonders why nothing happened.
//
// Web (browser PWA) is a no-op — the browser navigates natively.

"use client";

import { useEffect } from "react";
import { listenForNativeLinks } from "@/lib/platform/native-links";

export function CapacitorDeepLinks() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
      .Capacitor;
    if (!cap || typeof cap.isNativePlatform !== "function" || !cap.isNativePlatform()) {
      return;
    }

    let disposed = false;
    let removeHandler: (() => void) | undefined;

    import("@capacitor/app")
      .then(({ App }) => {
        if (disposed) return;
        removeHandler = listenForNativeLinks(App, {
          currentUrl: () => window.location.href,
          navigate: (target) => window.location.assign(target),
          storage: () => window.sessionStorage,
        });
      })
      .catch(() => {
        /* @capacitor/app missing — fall back to default Capacitor behavior */
      });

    return () => {
      disposed = true;
      removeHandler?.();
    };
  }, []);

  return null;
}

export default CapacitorDeepLinks;
