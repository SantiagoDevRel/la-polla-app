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
import type { PluginListenerHandle } from "@capacitor/core";

export function CapacitorBackButton() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } })
      .Capacitor;
    if (!cap?.isNativePlatform?.() || cap.getPlatform?.() !== "android") {
      return;
    }

    let disposed = false;
    let handle: PluginListenerHandle | undefined;
    const remove = (listener: PluginListenerHandle) => { void listener.remove().catch(() => {}); };

    import("@capacitor/app")
      .then(async ({ App }) => {
        if (disposed) return;
        const listener = await App.addListener("backButton", ({ canGoBack }) => {
          if (disposed) return;
          const dialog = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'))
            .reverse().find((element) => element.getClientRects().length > 0);
          if (dialog) {
            // Reuse the existing dialogs' Escape handlers. A modal that cannot
            // dismiss must also prevent Back from exiting the whole screen.
            dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
            return;
          }
          // Native canGoBack is authoritative; history.length also counts
          // forward entries and can trap Back on the first WebView page.
          if (canGoBack) {
            window.history.back();
          } else {
            void App.exitApp().catch(() => {});
          }
        });
        if (disposed) remove(listener);
        else handle = listener;
      })
      .catch(() => {
        /* plugin missing on this build — fall back to Capacitor default */
      });

    return () => {
      disposed = true;
      if (handle) remove(handle);
    };
  }, []);

  return null;
}

export default CapacitorBackButton;
