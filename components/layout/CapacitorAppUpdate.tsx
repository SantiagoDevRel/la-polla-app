// components/layout/CapacitorAppUpdate.tsx
//
// Detects when a newer version of the app is available on Google Play
// and shows an in-app modal asking the user to update. Tapping
// "Actualizar" hands off to Google's native immediate-update flow
// (fullscreen dialog + auto-restart). Tapping "Después" suppresses the
// modal for the rest of the session.
//
// Only runs inside the Capacitor native shell. On web (PWA in browser)
// this is a no-op — browsers handle their own update mechanism via the
// Service Worker.
//
// Requires the app to have been installed from the Play Store. For
// sideloaded APKs, getAppUpdateInfo returns updateAvailability=0
// (UNKNOWN) and we silently skip.

"use client";

import { useEffect, useState } from "react";

const DISMISS_KEY = "lp_app_update_dismissed_v1";

// AppUpdateAvailability enum values from the plugin (Play Core spec):
//   0 = UNKNOWN, 1 = NOT_AVAILABLE, 2 = AVAILABLE, 3 = IN_PROGRESS
const AVAILABILITY_AVAILABLE = 2;

export function CapacitorAppUpdate() {
  const [show, setShow] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
      .Capacitor;
    if (!cap || typeof cap.isNativePlatform !== "function" || !cap.isNativePlatform()) {
      return;
    }

    // User already said "Después" this session — don't pester.
    if (window.sessionStorage.getItem(DISMISS_KEY) === "1") return;

    import("@capawesome/capacitor-app-update")
      .then(({ AppUpdate }) =>
        AppUpdate.getAppUpdateInfo().then((info) => {
          if (
            info.updateAvailability === AVAILABILITY_AVAILABLE &&
            info.immediateUpdateAllowed
          ) {
            setShow(true);
          }
        }),
      )
      .catch(() => {
        /* sideloaded APK or plugin missing — no-op */
      });
  }, []);

  async function handleUpdate() {
    setUpdating(true);
    try {
      const { AppUpdate } = await import("@capawesome/capacitor-app-update");
      // Hand off to Google's native fullscreen update flow. The UI is
      // theirs from here — download progress, install, app restart.
      await AppUpdate.performImmediateUpdate();
    } catch {
      // User cancelled the native dialog OR network error. Close our
      // modal so the app stays usable; don't loop the prompt.
      setShow(false);
    } finally {
      setUpdating(false);
    }
  }

  function handleDismiss() {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(DISMISS_KEY, "1");
    }
    setShow(false);
  }

  if (!show) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-update-title"
      className="fixed inset-0 z-[10000] grid place-items-center p-4"
      style={{ background: "rgba(8,12,16,0.78)", backdropFilter: "blur(6px)" }}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-6"
        style={{
          background: "#0e1420",
          border: "1px solid rgba(255,215,0,0.3)",
          boxShadow: "0 0 48px rgba(255,215,0,0.15)",
        }}
      >
        <h2
          id="app-update-title"
          className="font-display text-3xl tracking-wide mb-3"
          style={{ color: "#FFD700" }}
        >
          NUEVA VERSIÓN
        </h2>
        <p className="text-sm leading-relaxed mb-6" style={{ color: "#AEB7C7" }}>
          Hay una versión más nueva de La Polla Colombiana en Play Store. Actualizá
          para tener las últimas mejoras y correcciones.
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleDismiss}
            disabled={updating}
            className="flex-1 py-2.5 px-4 rounded-xl text-sm font-medium transition-colors disabled:opacity-40"
            style={{ color: "#AEB7C7", border: "1px solid rgba(174,183,199,0.2)" }}
          >
            Después
          </button>
          <button
            type="button"
            onClick={handleUpdate}
            disabled={updating}
            className="flex-1 py-2.5 px-4 rounded-xl text-sm font-bold transition-all disabled:opacity-60"
            style={{
              background: "#FFD700",
              color: "#080c10",
              boxShadow: "0 0 20px rgba(255,215,0,0.25)",
            }}
          >
            {updating ? "Abriendo..." : "Actualizar"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CapacitorAppUpdate;
