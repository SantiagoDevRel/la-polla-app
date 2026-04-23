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

import { useEffect, useState } from "react";

const SEEN_KEY = "lp_splash_seen_v2";
const TOTAL_MS = 3200;
const FADE_MS = 500;

type Phase = "idle" | "playing" | "fading";

export function SplashScreen() {
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

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-[9999] bg-bg-base transition-opacity"
      style={{
        opacity: phase === "fading" ? 0 : 1,
        transitionDuration: `${FADE_MS}ms`,
      }}
    >
      <video
        autoPlay
        muted
        playsInline
        preload="auto"
        poster="/videos/la-polla-background-poster.webp"
        className="absolute inset-0 w-full h-full object-cover"
      >
        <source src="/videos/la-polla-background.webm" type="video/webm" />
        <source src="/videos/la-polla-background-lite.mp4" type="video/mp4" />
      </video>
      <div className="absolute top-4 left-0 right-0 flex items-center justify-center gap-3 px-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/pollitos/pollito_pibe_lider.webp"
          alt=""
          width={52}
          height={52}
          style={{ objectFit: "contain" }}
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
          <span style={{ color: "#FFD700" }}>LA</span>
          <span style={{ color: "#2F6DF4" }}>POLLA</span>
          <span style={{ color: "#E4463A" }}>COLOMBIANA</span>
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
