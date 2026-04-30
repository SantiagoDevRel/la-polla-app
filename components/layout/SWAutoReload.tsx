// components/layout/SWAutoReload.tsx — Recarga la página cuando un
// nuevo Service Worker toma control. Sin esto, después de un deploy
// el cliente sigue corriendo el JS viejo hasta que el user haga un
// hard-reload manual — y como nuestros chunks /_next/static/* están
// cacheados por el SW, los fixes no se ven en uso real hasta entonces.
//
// Flujo:
//  1) Mount: pedirle al browser que CHEQUEE /sw.js ahora mismo
//     (registration.update()). Sin esto, el browser solo chequea cada
//     ~24h o en navegación, así que el deploy puede tardar mucho en
//     verse.
//  2) Si hay un SW nuevo install-eado y waiting, le mandamos
//     SKIP_WAITING para que active de una.
//  3) clientsClaim: true en sw.ts hace que el nuevo SW tome control
//     inmediatamente del cliente actual → controllerchange dispara →
//     recargamos una sola vez (flag previene loop).
//  4) Cuando el tab vuelve a foco (visibilitychange visible),
//     re-check — agarra deploys hechos mientras el user tenía la
//     PWA en background.
"use client";

import { useEffect } from "react";

export default function SWAutoReload() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    let didReload = false;

    const onControllerChange = () => {
      if (didReload) return;
      didReload = true;
      // Una sola recarga por session — si el SW se reemplaza más de
      // una vez (raro) el flag previene el loop.
      window.location.reload();
    };

    const checkForUpdate = async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg) return;
        await reg.update();
        if (reg.waiting) {
          // Hay un SW nuevo install-eado y waiting. Decile que active
          // ya — no esperar al próximo reload natural.
          reg.waiting.postMessage({ type: "SKIP_WAITING" });
        }
      } catch {
        // Browser viejo o registration cancelado. No-op.
      }
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    // Chequeo inicial al montar.
    void checkForUpdate();

    // Re-chequeo cuando el tab vuelve a foco (típico en PWAs móviles
    // donde el user vuelve a la app después de varias horas).
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void checkForUpdate();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
}
