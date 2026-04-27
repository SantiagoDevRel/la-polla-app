// components/auth/WelcomeIntro.tsx — First-ever-visit welcome
//
// Shown one time, ever, before the login form. Plays the stadium video
// loop full-screen with a phased pitch reveal:
//   1. Typewriter intro line.
//   2. Tournament logo row fades in.
//   3. Numbered steps cascade.
//   4. "Todo esto es gratis." closes with the gold word emphasised.
//   5. CTA + credit line settle.
//
// Persisted via localStorage so returning users land straight on the
// login form. Reduced-motion users skip the cadence and see the full
// composition in one frame.

"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { TOURNAMENT_ICONS } from "@/lib/tournaments";

const SEEN_KEY = "lp_welcome_seen_v1";
const TYPE_MS = 28;

const INTRO =
  "La Polla Colombiana es para que juegues con tus amigos los principales torneos del mundo:";

// Order curated for visual recognition: World Cup first (most universal),
// then the three biggest club competitions, Serie A closes.
const TOURNAMENT_ORDER: Array<{ slug: keyof typeof TOURNAMENT_ICONS; name: string }> = [
  { slug: "worldcup_2026", name: "Mundial" },
  { slug: "champions_2025", name: "Champions" },
  { slug: "laliga_2025", name: "La Liga" },
  { slug: "premier_2025", name: "Premier" },
  { slug: "seriea_2025", name: "Serie A" },
];

const STEPS = [
  "Creas una polla",
  "Invitas a tus amigos",
  "Defines la distribución de premios",
  "Marcas quién ha pagado y quién no",
  "Y a pronosticar",
];

// Stage gates — each phase unlocks ~Δ ms after the previous one.
type Stage = "intro" | "tournaments" | "steps" | "gratis" | "ready";
const STAGE_DELAYS: Record<Exclude<Stage, "intro">, number> = {
  tournaments: 350,
  steps: 1100,
  gratis: 2000,
  ready: 700,
};

export function WelcomeIntro() {
  const [shouldShow, setShouldShow] = useState(false);
  const [typed, setTyped] = useState("");
  const [stage, setStage] = useState<Stage>("intro");
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
    if (seen) return;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduce) {
      setTyped(INTRO);
      setStage("ready");
    }
    setShouldShow(true);
  }, []);

  // Typewriter cadence for the intro line.
  useEffect(() => {
    if (!shouldShow || stage !== "intro") return;
    if (typed.length >= INTRO.length) {
      const t = window.setTimeout(
        () => setStage("tournaments"),
        STAGE_DELAYS.tournaments,
      );
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => {
      setTyped(INTRO.slice(0, typed.length + 1));
    }, TYPE_MS);
    return () => window.clearTimeout(t);
  }, [typed, shouldShow, stage]);

  // Stage progression past the typewriter.
  useEffect(() => {
    if (stage === "tournaments") {
      const t = window.setTimeout(() => setStage("steps"), STAGE_DELAYS.steps);
      return () => window.clearTimeout(t);
    }
    if (stage === "steps") {
      const t = window.setTimeout(
        () => setStage("gratis"),
        STAGE_DELAYS.gratis,
      );
      return () => window.clearTimeout(t);
    }
    if (stage === "gratis") {
      const t = window.setTimeout(() => setStage("ready"), STAGE_DELAYS.ready);
      return () => window.clearTimeout(t);
    }
  }, [stage]);

  function fastForward() {
    if (stage === "ready") return;
    setTyped(INTRO);
    setStage("ready");
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

  const showTournaments =
    stage === "tournaments" ||
    stage === "steps" ||
    stage === "gratis" ||
    stage === "ready";
  const showSteps = stage === "steps" || stage === "gratis" || stage === "ready";
  const showGratis = stage === "gratis" || stage === "ready";
  const showReady = stage === "ready";

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

          {/* Darken overlay so the copy stays readable over the moving
              footage. Heavier than AppBackground (0.78) since we're
              holding text longer here. */}
          <div className="absolute inset-0 bg-bg-base/75" />

          {/* Soft radial vignette pulling focus to the center column. */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(70% 70% at 50% 45%, transparent 45%, rgba(8,12,16,0.7) 100%)",
            }}
          />

          {/* Skip chip — visible until the CTA arrives. */}
          {!showReady && (
            <button
              type="button"
              onClick={fastForward}
              className="absolute top-4 right-4 z-10 text-[11px] uppercase tracking-wider text-text-secondary hover:text-gold transition-colors px-3 py-1.5 rounded-full border border-border-subtle bg-bg-card/50 backdrop-blur-sm"
            >
              Saltar
            </button>
          )}

          {/* Centered column. */}
          <div
            className="relative z-10 min-h-full flex flex-col items-center justify-center px-6 py-10 max-w-lg mx-auto text-center"
            onClick={fastForward}
          >
            {/* Wordmark */}
            <div className="flex items-center gap-3 mb-7">
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

            {/* Intro line — typewriter */}
            <p
              className="text-text-primary text-[15px] leading-relaxed font-medium max-w-[34ch] min-h-[72px]"
              style={{ textShadow: "0 1px 4px rgba(0,0,0,0.7)" }}
            >
              {typed}
              {stage === "intro" && (
                <span
                  className="inline-block w-[2px] h-[1.05em] bg-gold ml-0.5 align-[-0.15em] animate-pulse"
                  aria-hidden="true"
                />
              )}
            </p>

            {/* Tournament logos */}
            <AnimatePresence>
              {showTournaments && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.4 }}
                  className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-3"
                >
                  {TOURNAMENT_ORDER.map((t, i) => (
                    <motion.div
                      key={t.slug}
                      initial={{ opacity: 0, y: 8, scale: 0.85 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{
                        duration: 0.4,
                        delay: i * 0.12,
                        ease: "easeOut",
                      }}
                      className="flex flex-col items-center gap-1.5"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={TOURNAMENT_ICONS[t.slug]}
                        alt={t.name}
                        width={36}
                        height={36}
                        className="object-contain drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]"
                      />
                      <span className="text-[10px] uppercase tracking-wider text-text-secondary">
                        {t.name}
                      </span>
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Steps */}
            <AnimatePresence>
              {showSteps && (
                <motion.ol
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.3 }}
                  className="mt-8 flex flex-col items-start gap-2.5 text-left"
                >
                  {STEPS.map((s, i) => (
                    <motion.li
                      key={s}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{
                        duration: 0.35,
                        delay: i * 0.18,
                        ease: "easeOut",
                      }}
                      className="flex items-center gap-3 text-text-primary text-[14px] font-medium"
                      style={{ textShadow: "0 1px 4px rgba(0,0,0,0.7)" }}
                    >
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gold/15 border border-gold/40 text-gold text-[11px] font-bold inline-flex items-center justify-center">
                        {i + 1}
                      </span>
                      <span>{s}</span>
                    </motion.li>
                  ))}
                </motion.ol>
              )}
            </AnimatePresence>

            {/* Gratis punchline */}
            <AnimatePresence>
              {showGratis && (
                <motion.p
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45, ease: "easeOut" }}
                  className="mt-8 text-text-primary text-[16px] font-semibold"
                  style={{ textShadow: "0 1px 4px rgba(0,0,0,0.7)" }}
                >
                  Todo esto es{" "}
                  <motion.span
                    initial={{ scale: 0.85 }}
                    animate={{ scale: 1 }}
                    transition={{
                      duration: 0.5,
                      delay: 0.15,
                      ease: [0.34, 1.56, 0.64, 1], // gentle overshoot
                    }}
                    className="inline-block font-display text-gold text-[26px] tracking-wide align-[-0.05em]"
                    style={{ textShadow: "0 2px 8px rgba(255,215,0,0.35)" }}
                  >
                    GRATIS
                  </motion.span>
                  .
                </motion.p>
              )}
            </AnimatePresence>

            {/* CTA + credit */}
            <AnimatePresence>
              {showReady && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45, ease: "easeOut" }}
                  className="mt-10 flex flex-col items-center gap-4"
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
