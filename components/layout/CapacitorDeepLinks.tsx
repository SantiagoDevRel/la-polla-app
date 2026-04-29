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

export function CapacitorDeepLinks() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
      .Capacitor;
    if (!cap || typeof cap.isNativePlatform !== "function" || !cap.isNativePlatform()) {
      return;
    }

    let removeHandler: (() => void) | undefined;

    import("@capacitor/app")
      .then(({ App }) => {
        const handlePromise = App.addListener("appUrlOpen", (event) => {
          // event.url is the full URL that was tapped to open us, e.g.
          // https://lapollacolombiana.com/api/auth/wa-magic?token=abc
          // or https://lapollacolombiana.com/invites/polla/XYZ.
          // We navigate the WebView to the same path so the existing
          // server routes (auth callback, invite preview, etc.) handle
          // it normally — no app-side routing needed.
          try {
            const url = new URL(event.url);
            const target = `${url.pathname}${url.search}${url.hash}`;
            // hard navigation, not router.push, so any in-flight state
            // (cookies, OTP forms) is reset and the destination route
            // mounts fresh from scratch.
            window.location.href = target || "/";
          } catch {
            /* malformed URL — ignore; we don't want to crash on bad input */
          }
        });
        removeHandler = () => {
          handlePromise.then((handle) => handle.remove()).catch(() => {});
        };
      })
      .catch(() => {
        /* @capacitor/app missing — fall back to default Capacitor behavior */
      });

    return () => {
      removeHandler?.();
    };
  }, []);

  return null;
}

export default CapacitorDeepLinks;
