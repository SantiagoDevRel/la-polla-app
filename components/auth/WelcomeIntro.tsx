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
const TYPE_MS = 26; // ms between chars — fast, energetic typewriter
const CHAR_FADE_MS = 160; // each char's fade-in; multiple chars overlap mid-fade
// Single eased curve reused everywhere so phases share the same
// "physics". Acts close to easeOutExpo — soft landing, no overshoot.
const SMOOTH: [number, number, number, number] = [0.22, 1, 0.36, 1];

// Two long lines, hardcoded \n between them. Each line is ~44 chars
// and fits comfortably in the 360px container on every modern phone
// (iPhone 12+, all Android). On the rare iPhone SE-class device the
// browser wraps a line in two, which still reads cleanly because
// per-char spans keep every char at its final coordinate — the
// reveal is identical regardless of how many visual lines the wrap
// produces.
const INTRO =
  "La Polla Colombiana es para que juegues con\ntus amigos los principales torneos del mundo";
// Pre-split once at module load so every render reuses the same
// character array (and React keys stay stable across re-renders).
const INTRO_CHARS = INTRO.split("");

// Order curated for visual recognition: World Cup first (most universal),
// then the three biggest club competitions. Premier removed — its white
// background renders inconsistently inside Capacitor WebView (Android),
// breaking the row alignment vs the dark-on-dark logos of the others.
const TOURNAMENT_ORDER: Array<{ slug: keyof typeof TOURNAMENT_ICONS; name: string }> = [
  { slug: "worldcup_2026", name: "Mundial" },
  { slug: "champions_2025", name: "Champions" },
  { slug: "laliga_2025", name: "La Liga" },
  { slug: "seriea_2025", name: "Serie A" },
];

const STEPS = [
  "Creas una polla",
  "Invitas a tus amigos",
  "Defines la distribución de premios",
  "Marcas quién ha pagado y quién no",
  "Y a pronosticar",
];

// Stage gates — ms between the previous beat finishing and the next
// one starting. Tight enough to keep momentum, loose enough that
// nothing animates over the previous block.
type Stage = "intro" | "tournaments" | "steps" | "gratis" | "ready";
const STAGE_DELAYS: Record<Exclude<Stage, "intro">, number> = {
  tournaments: 350, // intro typing finishes → logos start almost immediately
  steps: 900, // logos cascade ~1.1s, then steps kick in
  gratis: 2200, // 5 steps land + a beat of read time
  ready: 1300, // savor the gold "GRATIS" before the CTA
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
          transition={{ duration: 0.7, ease: SMOOTH }}
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

          {/* Bottom fade — masks the small gap iOS Safari leaves under
              the video (its translateY(-7%) shifts the bottom edge up).
              Without this the gap reads as a visible black bar between
              the footage and the CTA. The gradient lands at solid bg-
              base at 100% so any gap blends in cleanly. */}
          <div
            className="absolute bottom-0 left-0 right-0 h-[200px] pointer-events-none"
            style={{
              background:
                "linear-gradient(180deg, transparent 0%, rgba(8,12,16,0.7) 50%, rgba(8,12,16,1) 100%)",
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

          {/* Layout strategy: every block is rendered from the very first
              frame with its final size and position. Stages only flip the
              opacity/blur/transform of each block — never the DOM tree —
              so the column's height is constant and nothing ever shifts
              up or down as content reveals. overflow-y-auto is the
              fallback for short viewports where the full stack still
              wouldn't fit (older iPhones in landscape, etc.). */}
          <div
            className="relative z-10 w-full h-full overflow-y-auto flex flex-col items-center justify-start px-6 pt-10 pb-12 max-w-lg mx-auto"
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

            {/* Intro typewriter — per-character technique.
                ─────────────────────────────────────────────────────────
                Every character of INTRO is rendered as its own <span>
                from the very first frame, in its exact final position.
                The browser computes the layout once at mount and never
                touches it again — the spans take their natural width
                even when `opacity:0`, so the line wrap, line count,
                vertical spacing and column height are LOCKED from
                frame 0.
                Reveal happens by toggling each span's opacity based on
                `typed.length > i`. A 240ms CSS transition turns the
                hard binary flip into a gentle fade, and because typed
                grows one char per 50ms, multiple chars are mid-fade at
                any moment — that overlap is what makes the reveal feel
                fluid instead of stuttering.
                There is literally NO mechanism by which a char could
                move: the DOM never reorders, no width changes, no
                container resizes. Whatever is on screen stays exactly
                where it is for the entire intro. */}
            <div className="w-full max-w-[360px] mx-auto">
              <p
                className="text-text-primary text-[15px] leading-relaxed font-medium text-center whitespace-pre-line"
                style={{ textShadow: "0 1px 4px rgba(0,0,0,0.7)" }}
              >
                {INTRO_CHARS.map((ch, i) => {
                  if (ch === "\n") return <br key={`br-${i}`} />;
                  const visible = typed.length > i;
                  return (
                    <span
                      key={i}
                      style={{
                        opacity: visible ? 1 : 0,
                        transition: `opacity ${CHAR_FADE_MS}ms ease-out`,
                      }}
                    >
                      {ch}
                    </span>
                  );
                })}
              </p>
            </div>

            {/* Tournament logos — slot reserved (min-h) from the start so
                the rest of the column doesn't move when the row reveals. */}
            <div className="mt-6 w-full flex flex-wrap items-center justify-center gap-x-5 gap-y-3 min-h-[68px]">
              {TOURNAMENT_ORDER.map((t, i) => (
                <motion.div
                  key={t.slug}
                  initial={{
                    opacity: 0,
                    scale: 0.92,
                    filter: "blur(6px)",
                  }}
                  animate={
                    showTournaments
                      ? { opacity: 1, scale: 1, filter: "blur(0px)" }
                      : { opacity: 0, scale: 0.92, filter: "blur(6px)" }
                  }
                  transition={{
                    duration: 0.45,
                    delay: showTournaments ? i * 0.13 : 0,
                    ease: SMOOTH,
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
            </div>

            {/* Steps — list always mounted; per-item opacity flips on the
                stage gate with a stagger so each line lands one after the
                next without any vertical reflow. */}
            <ol className="mt-8 w-full max-w-[34ch] mx-auto flex flex-col items-start gap-3 text-left">
              {STEPS.map((s, i) => (
                <motion.li
                  key={s}
                  initial={{ opacity: 0, filter: "blur(4px)" }}
                  animate={
                    showSteps
                      ? { opacity: 1, filter: "blur(0px)" }
                      : { opacity: 0, filter: "blur(4px)" }
                  }
                  transition={{
                    duration: 0.7,
                    delay: showSteps ? i * 0.32 : 0,
                    ease: SMOOTH,
                  }}
                  className="flex items-center gap-3 text-text-primary text-[14px] font-medium w-full"
                  style={{ textShadow: "0 1px 4px rgba(0,0,0,0.7)" }}
                >
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gold/15 border border-gold/40 text-gold text-[11px] font-bold inline-flex items-center justify-center">
                    {i + 1}
                  </span>
                  <span>{s}</span>
                </motion.li>
              ))}
            </ol>

            {/* Gratis punchline — always rendered with its slot reserved. */}
            <motion.p
              initial={{ opacity: 0, filter: "blur(4px)" }}
              animate={
                showGratis
                  ? { opacity: 1, filter: "blur(0px)" }
                  : { opacity: 0, filter: "blur(4px)" }
              }
              transition={{ duration: 0.85, ease: SMOOTH }}
              className="mt-8 text-text-primary text-[16px] font-semibold text-center"
              style={{ textShadow: "0 1px 4px rgba(0,0,0,0.7)" }}
            >
              Todo esto es{" "}
              <motion.span
                initial={{ scale: 0.7, opacity: 0 }}
                animate={
                  showGratis
                    ? { scale: 1, opacity: 1 }
                    : { scale: 0.7, opacity: 0 }
                }
                transition={{
                  duration: 1.1,
                  delay: showGratis ? 0.45 : 0,
                  ease: [0.34, 1.4, 0.64, 1],
                }}
                className="inline-block font-display text-gold text-[26px] tracking-wide align-[-0.05em]"
                style={{ textShadow: "0 2px 8px rgba(255,215,0,0.35)" }}
              >
                GRATIS
              </motion.span>
              .
            </motion.p>

            {/* CTA + credit — always rendered, pointer-events disabled
                until showReady so users can't tap an invisible button. */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: showReady ? 1 : 0 }}
              transition={{ duration: 0.8, ease: SMOOTH }}
              className="mt-10 flex flex-col items-center gap-4"
              style={{ pointerEvents: showReady ? "auto" : "none" }}
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
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default WelcomeIntro;
