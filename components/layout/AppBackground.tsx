// components/layout/AppBackground.tsx — Ambient stadium background
//
// Fixed, pointer-events-none layer rendered once per root layout.
// Default es la imagen estatica (carga 80kb instantanea, nunca falla).
// Si el browser permite autoplay silencioso, swappeamos al video. Si
// el autoplay es rechazado (iOS Low Power Mode, datasaver, etc.) el
// video NUNCA se muestra — quedamos en la imagen, sin "play button"
// overlay nativo en el medio de la pantalla.
//
// Composition, bottom-to-top:
//   1. bg-base flat fill (no first-paint flash).
//   2. Static poster <img> — siempre visible.
//   3. <video> loop solo si autoplay arranco — encima del poster.
//   4. Black overlay at ~78% opacity for text readability.
//   5. Faint noise grain (mix-blend overlay) to kill OLED banding.
//   6. Bottom vignette so BottomNav never merges into the gradient.

"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

const NOISE_SVG =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' seed='4'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.5 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>";

export interface AppBackgroundProps {
  className?: string;
  /** Opacity of the black overlay on top of the video (0–1). Default
   *  0.78 keeps the drifting motion visible while guaranteeing text
   *  contrast. Bump higher for text-heavy screens. */
  overlayOpacity?: number;
}

export function AppBackground({
  className,
  overlayOpacity = 0.78,
}: AppBackgroundProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // canPlay starts false. Solo flippa a true si play() resuelve sin
  // error — entonces mostramos el video. Si rechaza (autoplay bloqueado),
  // se queda en false para siempre y la imagen estatica queda como
  // background. Asi NUNCA aparece el play button gigante del browser.
  const [canPlay, setCanPlay] = useState(false);

  useEffect(() => {
    // Respetar prefers-reduced-motion: no intentamos play.
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) return;

    const v = videoRef.current;
    if (!v) return;

    let cancelled = false;
    v.muted = true;
    const playPromise = v.play();
    if (playPromise && typeof playPromise.then === "function") {
      playPromise
        .then(() => {
          if (!cancelled) setCanPlay(true);
        })
        .catch(() => {
          // Autoplay bloqueado — quedamos con la imagen y listo.
          if (!cancelled) setCanPlay(false);
        });
    }
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className={cn(
        "fixed inset-0 -z-10 overflow-hidden pointer-events-none bg-bg-base",
        className,
      )}
    >
      {/* Imagen estática del primer frame — siempre visible. Si el video
          arranca, el video la cubre (encima en el DOM). Si no, queda
          como background final. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/videos/nuevo-background-poster.webp"
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
        style={{ transform: "scale(1.18) translateY(-7%)" }}
      />

      {/* Loop video. Sin autoPlay attribute — lo disparamos via JS para
          poder catchear si autoplay esta bloqueado. controls={false}
          explicito para que iOS no agregue el play overlay nativo. */}
      <video
        ref={videoRef}
        muted
        loop
        playsInline
        controls={false}
        disablePictureInPicture
        preload="metadata"
        className={cn(
          "absolute inset-0 w-full h-full object-cover transition-opacity duration-300 motion-reduce:hidden",
          canPlay ? "opacity-100" : "opacity-0",
        )}
        style={{ transform: "scale(1.18) translateY(-7%)" }}
      >
        <source src="/videos/nuevo-background.webm" type="video/webm" />
        <source src="/videos/nuevo-background-lite.mp4" type="video/mp4" />
      </video>

      {/* Black overlay — keeps every surface legible over the moving
          footage. Tuned via the overlayOpacity prop per-surface. */}
      <div
        className="absolute inset-0 bg-bg-base"
        style={{ opacity: overlayOpacity }}
      />

      {/* Noise grain — static, non-animated. Kills banding on OLED. */}
      <div
        className="absolute inset-0 opacity-[0.04] mix-blend-overlay"
        style={{
          backgroundImage: `url("${NOISE_SVG}")`,
          backgroundSize: "160px 160px",
        }}
      />

      {/* Bottom vignette so BottomNav floats over something. */}
      <div
        className="absolute bottom-0 left-0 right-0 h-[160px]"
        style={{
          background:
            "linear-gradient(180deg, transparent 0%, rgba(8, 12, 16, 0.55) 60%, rgba(8, 12, 16, 0.85) 100%)",
        }}
      />
    </div>
  );
}

export default AppBackground;
