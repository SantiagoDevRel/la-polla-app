// components/layout/AppBackgroundClient.tsx — el fondo ambiente.
//
// ─── POR QUE SE REESCRIBIO (2026-09-03) ───────────────────────────────────
// Medido en frio contra produccion, /login tardaba 8,1 s en llegar a `load`
// cuando el DOM ya estaba listo a los 631 ms. Siete segundos y medio gastados
// en decoracion. El desglose fue:
//   · CUATRO requests de video (300 KB). El splash y el fondo montaban un
//     <video> cada uno, y cada <video> con dos <source> hace que el browser
//     tantee webm Y mp4.
//   · DOS posters (161 KB) por la misma razon.
//   · El server elegia la variante AL AZAR en cada request, asi que el cache
//     del browser no servia de nada: cada navegacion bajaba un video distinto
//     de entre 0,8 y 2,4 MB.
//
// ─── COMO FUNCIONA AHORA ──────────────────────────────────────────────────
// 1. HUMO EN CSS, cero bytes. Pinta en el primer frame, no espera red, y es
//    lo que se ve mientras la app carga.
// 2. El video NO se pide hasta DESPUES del evento `load` y de un hueco de
//    idle. Antes competia por ancho de banda con el JS y los datos.
// 3. UNA sola fuente: se le pregunta al browser que sabe reproducir y se pide
//    ese archivo. Nunca los dos.
// 4. Sin `poster`: el humo YA es el placeholder. 93 KB menos.
// 5. La rotacion es del CLIENTE. Ademas de que el primer video siempre es el
//    mismo (y por lo tanto cacheable), esto permitio sacar el `headers()` de
//    AppBackground, que obligaba a render dinamico del layout en cada request.

"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import type { BackgroundVariant } from "./background-variants";
import { BACKGROUND_SOURCES, BACKGROUND_VARIANTS } from "./background-variants";

/** Cada cuanto cambia de video, una vez que ya cargo todo. */
const ROTAR_MS = 22_000;

export interface AppBackgroundClientProps {
  className?: string;
  /** Opacidad del velo oscuro sobre el video (0-1). */
  overlayOpacity?: number;
  /** Forzar una variante (testing / pantallas tematicas). No rota. */
  variant?: BackgroundVariant;
}

/** ¿Vale la pena pedir 1-2 MB de video en esta conexion? */
function conexionAguanta(): boolean {
  if (typeof navigator === "undefined") return false;
  const c = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  // `connection` no existe en Safari, y ahi el default correcto es dejar
  // pasar: el iPhone ya tiene Low Power Mode, que hace fallar el play() solo
  // y nos deja igual con el humo.
  if (!c) return true;
  if (c.saveData) return false;
  return !(c.effectiveType && /(^|-)2g$|^3g$/.test(c.effectiveType));
}

export function AppBackgroundClient({
  className,
  overlayOpacity = 0.78,
  variant,
}: AppBackgroundClientProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // `null` = todavia no se pidio nada. Solo humo.
  const [actual, setActual] = useState<BackgroundVariant | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!conexionAguanta()) return;

    let cancelado = false;
    let rotarId: number | undefined;
    let cambioId: number | undefined;
    let i = 0;

    function arrancar() {
      if (cancelado) return;
      // El primero es SIEMPRE el indice 0, no uno al azar: asi la segunda
      // visita lo saca del cache en vez de bajar otro de 2 MB.
      setActual(variant ?? BACKGROUND_VARIANTS[0]);
      if (variant) return;
      rotarId = window.setInterval(() => {
        i = (i + 1) % BACKGROUND_VARIANTS.length;
        setVisible(false);
        // Se espera el fade-out antes de cambiar el src para que el corte no
        // se vea como un parpadeo.
        cambioId = window.setTimeout(() => {
          if (!cancelado) setActual(BACKGROUND_VARIANTS[i]);
        }, 400);
      }, ROTAR_MS);
    }

    // Despues de `load` Y en un hueco de idle: son dos guardas distintas
    // porque `load` puede dispararse con el hilo principal todavia ocupado
    // hidratando.
    function cuandoHayaAire() {
      const w = window as Window & {
        requestIdleCallback?: (cb: () => void) => number;
      };
      if (w.requestIdleCallback) w.requestIdleCallback(arrancar);
      else window.setTimeout(arrancar, 900);
    }

    if (document.readyState === "complete") cuandoHayaAire();
    else window.addEventListener("load", cuandoHayaAire, { once: true });

    return () => {
      cancelado = true;
      window.removeEventListener("load", cuandoHayaAire);
      if (rotarId) window.clearInterval(rotarId);
      if (cambioId) window.clearTimeout(cambioId);
    };
  }, [variant]);

  // Una sola fuente. Preguntar antes evita que el browser tantee los dos
  // archivos, que era la mitad de los requests de video.
  useEffect(() => {
    if (!actual) {
      setSrc(null);
      return;
    }
    const s = BACKGROUND_SOURCES[actual];
    const probe = document.createElement("video");
    setSrc(probe.canPlayType("video/webm") ? s.webm : s.mp4);
  }, [actual]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !src) return;
    v.muted = true;
    const p = v.play();
    if (p && typeof p.then === "function") p.catch(() => setVisible(false));
  }, [src]);

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-bg-base",
        className,
      )}
    >
      {/* ── El humo. Cero bytes, primer frame. ─────────────────────────────
          Amarillo, azul y rojo — los colores de la bandera, de donde sale la
          identidad de la marca. Muy difuminado para que se lea como humo de
          bengala y no como tres circulos de colores. */}
      <div className="lp-humo absolute inset-0">
        <span className="lp-humo-a" />
        <span className="lp-humo-b" />
        <span className="lp-humo-c" />
      </div>

      {src && (
        <video
          key={src}
          ref={videoRef}
          muted
          loop
          playsInline
          controls={false}
          disablePictureInPicture
          preload="auto"
          onCanPlay={() => setVisible(true)}
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-700 motion-reduce:hidden",
            visible ? "opacity-100" : "opacity-0",
          )}
          style={{ transform: "scale(1.18) translateY(-7%)" }}
          src={src}
        />
      )}

      {/* Velo oscuro: garantiza el contraste del texto sobre lo que haya
          detras, humo o video. */}
      <div
        className="absolute inset-0 bg-bg-base"
        style={{ opacity: overlayOpacity }}
      />

      {/* Piso: refuerza el negro abajo para que el nav despegue. */}
      <div
        className="absolute inset-x-0 bottom-0 h-[160px]"
        style={{
          background:
            "linear-gradient(180deg, transparent 0%, rgba(8, 12, 16, 0.55) 60%, rgba(8, 12, 16, 0.85) 100%)",
        }}
      />
    </div>
  );
}

export default AppBackgroundClient;
