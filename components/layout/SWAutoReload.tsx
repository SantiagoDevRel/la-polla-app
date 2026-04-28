// components/layout/SWAutoReload.tsx — Recarga la página cuando un
// nuevo Service Worker toma control. Sin esto, después de un deploy
// el cliente sigue corriendo el JS viejo hasta que el user haga un
// hard-reload manual — y como nuestros chunks /_next/static/* están
// cacheados por el SW, los fixes no se ven en uso real hasta entonces.
//
// `clientsClaim: true` en sw.ts hace que el nuevo SW tome control
// inmediatamente del cliente actual. El evento `controllerchange`
// se dispara en ese instante, y nosotros recargamos para que se
// refresquen todos los chunks. Una sola recarga, sin loop, gracias al
// flag de sesión.
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

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  return null;
}
