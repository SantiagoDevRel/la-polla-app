// components/layout/OfflineBanner.tsx
//
// Slim banner pinned to the top of the viewport that surfaces the
// offline state — the Service Worker keeps cached pages working, but
// new data (matches, predictions, leaderboard) won't sync until back
// online, and the user deserves to know.
//
// Inside Capacitor: uses @capacitor/network. On web: falls back to
// navigator.onLine + 'online'/'offline' window events. Both paths
// converge on the same isOnline state.

"use client";

import { useEffect, useState } from "react";

export function OfflineBanner() {
  const [online, setOnline] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (typeof window === "undefined") return;

    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
      .Capacitor;
    const isNative =
      cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform();

    let cleanup: (() => void) | undefined;

    if (isNative) {
      // Native path — use Capacitor Network plugin.
      import("@capacitor/network")
        .then(async ({ Network }) => {
          const status = await Network.getStatus();
          setOnline(status.connected);
          const handle = await Network.addListener("networkStatusChange", (s) => {
            setOnline(s.connected);
          });
          cleanup = () => {
            handle.remove().catch(() => {});
          };
        })
        .catch(() => {
          /* plugin missing — silently rely on the web fallback below */
        });
    }

    // Web fallback (also runs in Capacitor as a backup signal — costs
    // nothing and catches the case where the plugin is slow to attach).
    setOnline(navigator.onLine);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      cleanup?.();
    };
  }, []);

  if (!mounted || online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 inset-x-0 z-[9998] text-center text-xs font-medium py-2 px-4"
      style={{
        background: "#FF9F1C",
        color: "#080c10",
        boxShadow: "0 2px 12px rgba(0,0,0,0.4)",
      }}
    >
      Sin conexión — algunas cosas pueden no actualizarse
    </div>
  );
}

export default OfflineBanner;
