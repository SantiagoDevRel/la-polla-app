// components/layout/SplashScreen.tsx — First-visit splash
//
// Plays the stadium loop once per session with the LA POLLA wordmark,
// then cross-fades into the app. Session-scoped via sessionStorage so
// internal navigations (Inicio → Perfil → Pollas) never replay it —
// the app should feel fast after the first entry. Reduced-motion users
// skip it entirely. During actual page loading the per-route
// loading.tsx takes over and paints the pollito loader over the
// ambient video instead.

"use client";

import Image from "next/image";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

const SEEN_KEY = "lp_splash_seen_v2";
const TOTAL_MS = 3200;
const FADE_MS = 500;

type Phase = "idle" | "playing" | "fading";

export function SplashScreen() {
  const t = useTranslations("Brand");
  const [phase, setPhase] = useState<Phase>("idle");

  useEffect(() => {
    if (typeof window === "undefined") return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const alreadySeen = sessionStorage.getItem(SEEN_KEY) === "1";
    if (reduce || alreadySeen) return;

    setPhase("playing");
    const fadeTimer = window.setTimeout(
      () => setPhase("fading"),
      TOTAL_MS - FADE_MS,
    );
    const doneTimer = window.setTimeout(() => {
      setPhase("idle");
      try {
        sessionStorage.setItem(SEEN_KEY, "1");
      } catch {
        /* storage unavailable; splash plays again next mount */
      }
    }, TOTAL_MS);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(doneTimer);
    };
  }, []);

  if (phase === "idle") return null;

  const part1 = t("wordmarkPart1");
  const part2 = t("wordmarkPart2");
  const part3 = t("wordmarkPart3");

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-[9999] bg-bg-base transition-opacity"
      style={{
        opacity: phase === "fading" ? 0 : 1,
        transitionDuration: `${FADE_MS}ms`,
      }}
    >
      {/* (2026-09-03) SE FUE EL VIDEO DE ACA, y es el cambio de rendimiento
          mas grande de esta pantalla.
          El splash cubre los primeros ~3 segundos de la primerisima visita, o
          sea el momento EXACTO en que el browser deberia estar bajando el JS
          y los datos. En vez de eso montaba un <video preload="auto"> con dos
          <source>, que se llevaba el ancho de banda y ademas duplicaba lo que
          ya estaba pidiendo AppBackground: en la medicion en frio se veian
          CUATRO requests de video y DOS posters para una sola pantalla.
          Queda el mismo humo en CSS del fondo — cero bytes, pinta al
          instante, y visualmente es continuo con lo que hay debajo. */}
      <div className="lp-humo absolute inset-0">
        <span className="lp-humo-a" />
        <span className="lp-humo-b" />
        <span className="lp-humo-c" />
      </div>
      <div className="absolute inset-0 bg-bg-base/60" />
      <div className="absolute top-4 left-0 right-0 flex items-center justify-center gap-3 px-4">
        {/* next/image y no <img>: el archivo original pesa 116 KB y aca se
            dibuja a 52 px. Sin optimizar, el browser bajaba los 116 KB
            enteros para escalarlos hacia abajo. */}
        <Image
          src="/pollitos/pollito_pibe_lider.webp"
          alt=""
          width={52}
          height={52}
          priority
          className="h-[52px] w-[52px] max-w-none object-contain"
        />
        <span
          className="font-display leading-none tracking-[0.04em] flex items-baseline gap-[5px]"
          style={{
            fontSize: 22,
            WebkitTextStroke: "1px #000",
            textShadow: "0 2px 6px rgba(0,0,0,0.55)",
            paintOrder: "stroke fill",
          }}
        >
          {part3 ? (
            <>
              <span style={{ color: "#FFD700" }}>{part1}</span>
              <span style={{ color: "#2F6DF4" }}>{part2}</span>
              <span style={{ color: "#E4463A" }}>{part3}</span>
            </>
          ) : (
            <>
              <span style={{ color: "#FFD700" }}>{part1}</span>
              <span style={{ color: "#FFD700" }}>{part2}</span>
            </>
          )}
        </span>
      </div>
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(80% 80% at 50% 50%, transparent 60%, rgba(8,12,16,0.6) 100%)",
        }}
      />
    </div>
  );
}

export default SplashScreen;
