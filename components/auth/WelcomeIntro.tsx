// components/auth/WelcomeIntro.tsx — First-ever-visit welcome
//
// Shown one time, ever, before the login form. Plays the stadium video
// loop full-screen with a typewriter pitch and a credit link to the
// builder's Instagram. Persisted via localStorage (not sessionStorage)
// so returning users land straight on the login form.
//
// Reduced-motion users get the full text immediately and skip the
// typewriter cadence — the dismiss CTA still respects localStorage.

"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

const SEEN_KEY = "lp_welcome_seen_v1";
const TYPE_MS = 26;
const FULL_TEXT =
  "La Polla Colombiana es para que juegues con tus amigos los principales torneos del mundo — Mundial, Champions, La Liga y más. Llevá la tabla, definí cuánto gana cada uno, marcá quién pagó. Todo gratis.";

export function WelcomeIntro() {
  const [shouldShow, setShouldShow] = useState(false);
  const [typed, setTyped] = useState("");
  const [done, setDone] = useState(false);
  const [exiting, setExiting] = useState(false);

  // Gate visibility on the localStorage flag. Runs once on mount; the
  // initial render returns null so SSR doesn't flash the overlay for
  // returning users.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let seen = false;
    try {
      seen = window.localStorage.getItem(SEEN_KEY) === "1";
    } catch {
      /* storage unavailable — fall through and show the intro */
    }
    if (!seen) {
      const reduce = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      if (reduce) {
        // Skip the cadence entirely; show the full pitch + CTA at once.
        setTyped(FULL_TEXT);
        setDone(true);
      }
      setShouldShow(true);
    }
  }, []);

  // Typewriter cadence. One char per TYPE_MS until the full text is on
  // screen, then flip `done` to reveal the CTA + credit.
  useEffect(() => {
    if (!shouldShow || done) return;
    if (typed.length >= FULL_TEXT.length) {
      setDone(true);
      return;
    }
    const t = window.setTimeout(() => {
      setTyped(FULL_TEXT.slice(0, typed.length + 1));
    }, TYPE_MS);
    return () => window.clearTimeout(t);
  }, [typed, shouldShow, done]);

  function skipTyping() {
    if (done) return;
    setTyped(FULL_TEXT);
    setDone(true);
  }

  function dismiss() {
    try {
      window.localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* ignore — at worst the intro plays again */
    }
    setExiting(true);
    window.setTimeout(() => setShouldShow(false), 420);
  }

  if (!shouldShow) return null;

  return (
    <AnimatePresence>
      {!exiting && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          className="fixed inset-0 z-[10000] overflow-hidden bg-bg-base"
        >
          {/* Stadium video — same source as AppBackground for visual
              continuity into the rest of the app. Hidden under
              prefers-reduced-motion; the poster carries the still. */}
          <video
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            poster="/videos/nuevo-background-poster.webp"
            className="absolute inset-0 w-full h-full object-cover motion-reduce:hidden"
            style={{ transform: "scale(1.18) translateY(-7%)" }}
          >
            <source src="/videos/nuevo-background.webm" type="video/webm" />
            <source src="/videos/nuevo-background-lite.mp4" type="video/mp4" />
          </video>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/videos/nuevo-background-poster.webp"
            alt=""
            className="absolute inset-0 w-full h-full object-cover hidden motion-reduce:block"
            style={{ transform: "scale(1.18) translateY(-7%)" }}
          />

          {/* Darken overlay so the typewriter copy stays readable over
              the moving footage. Heavier than AppBackground (0.78) since
              we're holding text longer here. */}
          <div className="absolute inset-0 bg-bg-base/75" />

          {/* Soft radial vignette pulling focus to the center column. */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(70% 70% at 50% 45%, transparent 45%, rgba(8,12,16,0.7) 100%)",
            }}
          />

          {/* Skip-typing chip — only useful while the cadence is
              running. Disappears once the user lands on the CTA. */}
          {!done && (
            <button
              type="button"
              onClick={skipTyping}
              className="absolute top-4 right-4 z-10 text-[11px] uppercase tracking-wider text-text-secondary hover:text-gold transition-colors px-3 py-1.5 rounded-full border border-border-subtle bg-bg-card/50 backdrop-blur-sm"
            >
              Saltar
            </button>
          )}

          {/* Centered column — wordmark, typewriter, then the CTA + credit. */}
          <div
            className="relative z-10 h-full flex flex-col items-center justify-center px-6 max-w-md mx-auto text-center"
            onClick={skipTyping}
          >
            <div className="flex items-center gap-3 mb-8">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/pollitos/pollito_pibe_lider.webp"
                alt=""
                width={52}
                height={52}
                className="object-contain"
              />
              <span
                className="font-display leading-none tracking-[0.04em] flex items-baseline gap-[5px]"
                style={{
                  fontSize: 26,
                  textShadow: "0 2px 6px rgba(0,0,0,0.55)",
                }}
              >
                <span style={{ color: "#FFD700" }}>LA</span>
                <span style={{ color: "#2F6DF4" }}>POLLA</span>
                <span style={{ color: "#E4463A" }}>COLOMBIANA</span>
              </span>
            </div>

            <p
              className="text-text-primary text-[15px] leading-relaxed font-medium min-h-[180px] max-w-[28ch] sm:max-w-[34ch]"
              style={{ textShadow: "0 1px 4px rgba(0,0,0,0.7)" }}
            >
              {typed}
              {!done && (
                <span
                  className="inline-block w-[2px] h-[1.05em] bg-gold ml-0.5 align-[-0.15em] animate-pulse"
                  aria-hidden="true"
                />
              )}
            </p>

            <AnimatePresence>
              {done && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45, ease: "easeOut" }}
                  className="mt-10 flex flex-col items-center gap-5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={dismiss}
                    className="bg-gold text-bg-base font-bold px-10 py-3 rounded-full text-base hover:brightness-110 transition-all"
                  >
                    Empezar
                  </button>
                  <a
                    href="https://instagram.com/santiagotrujilloz"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-text-muted hover:text-gold transition-colors inline-flex items-center gap-1.5"
                  >
                    <span>hecho por santiago</span>
                    <span className="text-gold/80 underline underline-offset-2">
                      @santiagotrujilloz
                    </span>
                  </a>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default WelcomeIntro;
