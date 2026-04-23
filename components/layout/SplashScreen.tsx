// components/layout/SplashScreen.tsx — First-visit splash
//
// Plays the stadium loop once per session over a fullscreen black layer,
// then cross-fades into the app after ~3 seconds. Session-scoped via
// sessionStorage so internal navigations do not replay it. Respects
// prefers-reduced-motion by bailing instantly (no splash, no fade).
//
// Mounts inside the root <body> so it paints above every layout. While
// visible it blocks pointer events on the underlying app so taps during
// the splash do not register on buttons below.

"use client";

import { useEffect, useState } from "react";

const SEEN_KEY = "lp_splash_seen_v1";
const TOTAL_MS = 3200; // total on-screen time
const FADE_MS = 500;   // fade-out duration at the tail

export function SplashScreen() {
  const [phase, setPhase] = useState<"pending" | "playing" | "fading" | "done">(
    "pending",
  );

  useEffect(() => {
    // Respect reduced-motion preferences first.
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const alreadySeen =
      typeof window !== "undefined" && sessionStorage.getItem(SEEN_KEY) === "1";

    if (reduce || alreadySeen) {
      setPhase("done");
      return;
    }

    setPhase("playing");
    const fadeTimer = window.setTimeout(
      () => setPhase("fading"),
      TOTAL_MS - FADE_MS,
    );
    const doneTimer = window.setTimeout(() => {
      setPhase("done");
      try {
        sessionStorage.setItem(SEEN_KEY, "1");
      } catch {
        /* storage unavailable; splash will replay on next mount */
      }
    }, TOTAL_MS);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(doneTimer);
    };
  }, []);

  if (phase === "done" || phase === "pending") return null;

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
        poster="/la-polla-background-poster.webp"
        className="absolute inset-0 w-full h-full object-cover"
      >
        <source src="/la-polla-background.webm" type="video/webm" />
        <source src="/la-polla-background-lite.mp4" type="video/mp4" />
      </video>
      {/* Wordmark centred on top of the looping footage */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div
          className="font-display text-gold"
          style={{
            fontSize: 52,
            letterSpacing: "0.14em",
            textShadow: "0 0 30px rgba(255,215,0,0.45)",
          }}
        >
          LA POLLA
        </div>
        <div className="mt-2 text-[11px] uppercase tracking-[0.24em] text-text-secondary">
          La polla deportiva de tus amigos
        </div>
      </div>
      {/* Subtle vignette so edges feel intentional, not raw video */}
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
