// components/layout/CapacitorBackButton.tsx
//
// Hooks the Android hardware back button to standard navigation:
//   - If the WebView has history → window.history.back()
//   - Else → exit the app cleanly via App.exitApp()
//
// Without this hook, Capacitor's default behavior is the same on
// modern versions, but on older Android WebView builds the back press
// can close the app even when there is in-app navigation history.
// Pinning the behavior explicitly keeps it predictable.
//
// Web (non-Capacitor) is a no-op — we early-return when the native
// bridge is absent, so this never affects browser back-button UX.

"use client";

import { useEffect } from "react";

export function CapacitorBackButton() {
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
        const handlePromise = App.addListener("backButton", ({ canGoBack }) => {
          if (canGoBack || (typeof window !== "undefined" && window.history.length > 1)) {
            window.history.back();
          } else {
            App.exitApp();
          }
        });
        removeHandler = () => {
          handlePromise.then((handle) => handle.remove()).catch(() => {});
        };
      })
      .catch(() => {
        /* plugin missing on this build — fall back to Capacitor default */
      });

    return () => {
      removeHandler?.();
    };
  }, []);

  return null;
}

export default CapacitorBackButton;
