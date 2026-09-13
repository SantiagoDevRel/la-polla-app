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
// 3. UNA sola fuente MP4 lite, elegida por menor peso y mayor fidelidad medida
//    contra el master. Nunca se tantean dos codecs.
// 4. Sin `poster`: el humo YA es el placeholder. 93 KB menos.
// 5. Red lenta o ahorro de datos = humo; las demas conexiones conservan la
//    rotacion existente. Si la conexion empeora, la politica se ajusta sin
//    esperar otra navegacion.

"use client";

import { useEffect, useRef, useState } from "react";
import {
  getBackgroundPlaybackMode,
  getNavigatorConnection,
  type BackgroundPlaybackMode,
} from "@/lib/background-connection";
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
  /** Mantener solo el humo CSS, sin solicitar archivos de video. */
  video?: boolean;
}

export function AppBackgroundClient({
  className,
  overlayOpacity = 0.78,
  variant,
  video = true,
}: AppBackgroundClientProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playableRef = useRef(false);
  // `null` = todavia no se pidio nada. Solo humo.
  const [actual, setActual] = useState<BackgroundVariant | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<BackgroundPlaybackMode>("off");

  useEffect(() => {
    let cancelado = false;
    let arrancado = false;
    let fallbackId: number | undefined;
    let idleId: number | undefined;
    const connection = getNavigatorConnection();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const actualizarModo = () => {
      if (!arrancado || cancelado) return;
      setMode(
        !video || reducedMotion.matches
          ? "off"
          : getBackgroundPlaybackMode(connection),
      );
    };

    const arrancar = () => {
      if (cancelado) return;
      arrancado = true;
      actualizarModo();
    };

    // Despues de `load` Y en un hueco de idle: son dos guardas distintas
    // porque `load` puede dispararse con el hilo principal todavia ocupado
    // hidratando.
    function cuandoHayaAire() {
      const w = window as Window & {
        requestIdleCallback?: (
          cb: () => void,
          options?: { timeout: number },
        ) => number;
      };
      if (w.requestIdleCallback) {
        idleId = w.requestIdleCallback(arrancar, { timeout: 2_000 });
      } else {
        fallbackId = window.setTimeout(arrancar, 900);
      }
    }

    connection?.addEventListener?.("change", actualizarModo);
    reducedMotion.addEventListener("change", actualizarModo);
    if (!video) {
      arrancado = true;
      actualizarModo();
    } else if (document.readyState === "complete") {
      cuandoHayaAire();
    } else {
      window.addEventListener("load", cuandoHayaAire, { once: true });
    }

    return () => {
      cancelado = true;
      window.removeEventListener("load", cuandoHayaAire);
      connection?.removeEventListener?.("change", actualizarModo);
      reducedMotion.removeEventListener("change", actualizarModo);
      if (fallbackId !== undefined) window.clearTimeout(fallbackId);
      if (idleId !== undefined) {
        const w = window as Window & {
          cancelIdleCallback?: (id: number) => void;
        };
        w.cancelIdleCallback?.(idleId);
      }
    };
  }, [video]);

  useEffect(() => {
    if (mode === "off") {
      playableRef.current = false;
      setVisible(false);
      setActual(null);
      return;
    }

    // El primero es SIEMPRE el indice 0, no uno al azar: asi la segunda
    // visita lo saca del cache en vez de bajar otro archivo.
    setActual((current) => variant ?? current ?? BACKGROUND_VARIANTS[0]);
  }, [mode, variant]);

  useEffect(() => {
    if (mode !== "rotate" || variant || !actual) return;

    let cambioId: number | undefined;
    const rotarId = window.setInterval(() => {
      const nextIndex =
        (BACKGROUND_VARIANTS.indexOf(actual) + 1) % BACKGROUND_VARIANTS.length;
      setVisible(false);
      // Se espera el fade-out antes de cambiar el src para que el corte no
      // se vea como un parpadeo.
      cambioId = window.setTimeout(() => {
        cambioId = undefined;
        playableRef.current = false;
        setActual(BACKGROUND_VARIANTS[nextIndex]);
      }, 400);
    }, ROTAR_MS);

    return () => {
      window.clearInterval(rotarId);
      if (cambioId !== undefined) {
        window.clearTimeout(cambioId);
        if (playableRef.current) setVisible(true);
      }
    };
  }, [actual, mode, variant]);

  // Una sola fuente. Los MP4 lite son universales, pesan menos y conservaron
  // mejor fidelidad contra los masters que las versiones WebM medidas.
  useEffect(() => {
    if (!actual) {
      playableRef.current = false;
      setSrc(null);
      return;
    }
    playableRef.current = false;
    setVisible(false);
    setSrc(BACKGROUND_SOURCES[actual].mp4);
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
      <div
        className={cn(
          "lp-humo absolute inset-0",
          visible && "lp-humo-paused",
        )}
      >
        <span className="lp-humo-a" />
        <span className="lp-humo-b" />
        <span className="lp-humo-c" />
      </div>

      {/* El video Y SU VELO viajan juntos en el mismo contenedor, y esto es
          lo que arregla un error de la primera version: el velo estaba
          suelto encima de TODO, asi que tambien tapaba el humo. Con el velo
          a 0.78 sobre un humo que ya es sutil, el fondo se veia negro y la
          idea entera se perdia. Ahora el humo se ve a su intensidad real
          mientras no hay video, y el velo aparece solo cuando aparece el
          video — que si lo necesita, porque el estadio es brillante. */}
      {src && (
        <div
          className={cn(
            "absolute inset-0 transition-opacity duration-700 motion-reduce:hidden",
            visible ? "opacity-100" : "opacity-0",
          )}
        >
          <video
            key={src}
            ref={videoRef}
            muted
            loop
            playsInline
            controls={false}
            disablePictureInPicture
            preload="auto"
            onCanPlay={() => {
              playableRef.current = true;
              setVisible(true);
            }}
            onError={() => {
              playableRef.current = false;
              setVisible(false);
              setSrc(null);
            }}
            className="absolute inset-0 h-full w-full object-cover"
            style={{ transform: "scale(1.18) translateY(-7%)" }}
            src={src}
          />
          <div
            className="absolute inset-0 bg-bg-base"
            style={{ opacity: overlayOpacity }}
          />
        </div>
      )}

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
