// components/layout/AppBackgroundClient.tsx — Client renderer del background ambient.
//
// Recibe el `variant` ya elegido por el server (ver AppBackground.tsx) y
// rendea el poster + video correspondiente. El server decide cual de los
// 5 videos toca por request asi el SSR HTML ya trae el poster correcto
// horneado (primer frame visible al instante, sin flash).
//
// Comportamiento:
//   1. Poster <img> SIEMPRE visible (carga ~80kb, jamas falla).
//   2. <video> intentamos play() via JS — si autoplay esta bloqueado
//      (iOS Low Power, datasaver, etc.) quedamos con la imagen. NUNCA
//      aparece el play button gigante del browser nativo.
//   3. controls={false} + disablePictureInPicture para matar todo overlay.

"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import type { BackgroundVariant } from "./background-variants";
import { BACKGROUND_SOURCES } from "./background-variants";

const NOISE_SVG =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' seed='4'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.5 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>";

export interface AppBackgroundClientProps {
  variant: BackgroundVariant;
  className?: string;
  overlayOpacity?: number;
}

export function AppBackgroundClient({
  variant,
  className,
  overlayOpacity = 0.78,
}: AppBackgroundClientProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [canPlay, setCanPlay] = useState(false);
  const sources = BACKGROUND_SOURCES[variant];

  useEffect(() => {
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
          if (!cancelled) setCanPlay(false);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [variant]);

  return (
    <div
      aria-hidden="true"
      className={cn(
        "fixed inset-0 -z-10 overflow-hidden pointer-events-none bg-bg-base",
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={`poster-${variant}`}
        src={sources.poster}
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
        style={{ transform: "scale(1.18) translateY(-7%)" }}
      />

      <video
        key={`video-${variant}`}
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
        <source src={sources.webm} type="video/webm" />
        <source src={sources.mp4} type="video/mp4" />
      </video>

      <div
        className="absolute inset-0 bg-bg-base"
        style={{ opacity: overlayOpacity }}
      />

      <div
        className="absolute inset-0 opacity-[0.04] mix-blend-overlay"
        style={{
          backgroundImage: `url("${NOISE_SVG}")`,
          backgroundSize: "160px 160px",
        }}
      />

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

export default AppBackgroundClient;
