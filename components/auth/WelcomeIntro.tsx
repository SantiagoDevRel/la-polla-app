// components/auth/WelcomeIntro.tsx — la bienvenida, una sola vez en la vida.
//
// (2026-11-08) Rehecha a pedido del dueño: la anterior (frase que se escribía
// sola, nueve escudos, cinco pasos y remate del pozo) tardaba ~8 s y contaba
// demasiado. La nueva es la "opción B" aprobada en Claude Design: el pollito,
// el wordmark tricolor y UNA palabra grande que rota rápido (Pollas → Rifas →
// Causas sociales → Sin ánimo de lucro → Y mucho más), con barras de progreso
// tipo historia arriba. Abajo: a quién va dirigida, el resaltado verde de las
// iniciativas sin ánimo de lucro con Los Del Sur (solo mencionados: sin su
// escudo ni sus fotos, decisión del dueño) y el botón de entrar, que aparece
// al segundo para que nadie tenga que esperar la rotación completa.
//
// Se recuerda en localStorage (`lp_welcome_seen_v1`): quien vuelve cae directo
// en el login. Con movimiento reducido se pinta el estado final de una vez.
// No pinta fondo opaco: el AppBackground del layout de auth se ve detrás, con
// un velo encima para el contraste, así que no descarga nada nuevo.

"use client";

/* eslint-disable @next/next/no-img-element -- pre-sized public assets avoid Vercel image-optimization quota */

import { useEffect, useLayoutEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";

const SEEN_KEY = "lp_welcome_seen_v1";
const WORD_MS = 900; // cada palabra en pantalla
const CTA_DELAY_S = 1.1; // el botón llega antes de que termine la rotación
const SMOOTH: [number, number, number, number] = [0.22, 1, 0.36, 1];

const WORDS = [
  { key: "word1", size: "text-[64px]" },
  { key: "word2", size: "text-[64px]" },
  { key: "word3", size: "text-[48px]" },
  { key: "word4", size: "text-[42px]" },
  { key: "word5", size: "text-[56px]" },
] as const;
const LAST = WORDS.length - 1;

type Stage = "playing" | "ready";

export function WelcomeIntro() {
  const t = useTranslations("Welcome");
  const tBrand = useTranslations("Brand");
  const prefersReducedMotion = useReducedMotion();

  const [shouldShow, setShouldShow] = useState(false);
  const [index, setIndex] = useState(0);
  const [stage, setStage] = useState<Stage>("playing");
  const [exiting, setExiting] = useState(false);

  // Gate visibility on the localStorage flag. The first render returns null
  // so SSR never flashes the overlay for returning users.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let seen = false;
    try {
      seen = window.localStorage.getItem(SEEN_KEY) === "1";
    } catch {
      /* storage unavailable — show the intro */
    }
    if (seen) return;
    if (prefersReducedMotion) {
      setIndex(LAST);
      setStage("ready");
    }
    setShouldShow(true);
  }, [prefersReducedMotion]);

  // Keep the login/onboarding UI out of sight and out of the tab order while
  // the welcome is active.
  useLayoutEffect(() => {
    if (!shouldShow) return;
    const content = document.querySelector<HTMLElement>("[data-auth-content]");
    if (!content) return;

    const wasInvisible = content.classList.contains("invisible");
    const previousAriaHidden = content.getAttribute("aria-hidden");
    const previousInert = content.inert;
    content.classList.add("invisible");
    content.setAttribute("aria-hidden", "true");
    content.inert = true;

    return () => {
      if (!wasInvisible) content.classList.remove("invisible");
      if (previousAriaHidden === null) content.removeAttribute("aria-hidden");
      else content.setAttribute("aria-hidden", previousAriaHidden);
      content.inert = previousInert;
    };
  }, [shouldShow]);

  // Word rotation: one pass, then rest on the last word.
  useEffect(() => {
    if (!shouldShow || stage === "ready") return;
    const tm = window.setTimeout(() => {
      if (index >= LAST) setStage("ready");
      else setIndex(index + 1);
    }, index >= LAST ? 450 : WORD_MS);
    return () => window.clearTimeout(tm);
  }, [shouldShow, stage, index]);

  function fastForward() {
    if (stage === "ready") return;
    setIndex(LAST);
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

  const part1 = tBrand("wordmarkPart1");
  const part2 = tBrand("wordmarkPart2");
  const part3 = tBrand("wordmarkPart3");
  const word = WORDS[index];
  const reveal = (delay: number) =>
    prefersReducedMotion
      ? { initial: false as const, animate: { opacity: 1, y: 0 } }
      : {
          initial: { opacity: 0, y: 16, filter: "blur(6px)" },
          animate: { opacity: 1, y: 0, filter: "blur(0px)" },
          transition: { duration: 0.5, delay, ease: SMOOTH },
        };

  return (
    <AnimatePresence>
      {!exiting && (
        <motion.div
          initial={prefersReducedMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.5, ease: SMOOTH }}
          className="fixed inset-0 z-[10000] overflow-hidden bg-bg-base/90"
          data-testid="welcome-intro"
          data-welcome-stage={stage}
        >
          {/* Humo tricolor: tres manchas difuminadas, cero bytes. */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -left-28 top-10 h-80 w-80 rounded-full bg-gold/30 blur-[80px]" />
            <div className="absolute -right-36 top-64 h-[340px] w-[340px] rounded-full bg-[#2F6DF4]/30 blur-[90px]" />
            <div className="absolute -left-14 bottom-28 h-72 w-72 rounded-full bg-[#E4463A]/25 blur-[90px]" />
          </div>

          <div
            className="relative z-10 mx-auto flex h-full w-full max-w-md flex-col items-center overflow-y-auto px-4 pb-8 pt-4"
            onClick={fastForward}
          >
            {/* Barras de progreso tipo historia. */}
            <div aria-hidden="true" className="grid w-full grid-cols-5 gap-[5px]">
              {WORDS.map((w, i) => (
                <div key={w.key} className="h-1 overflow-hidden rounded-sm bg-white/20">
                  <motion.div
                    className="h-full origin-left rounded-sm bg-text-primary"
                    initial={false}
                    animate={{ scaleX: i <= index ? 1 : 0 }}
                    transition={{
                      duration: prefersReducedMotion || i < index || stage === "ready" ? 0 : WORD_MS / 1000,
                      ease: "linear",
                    }}
                  />
                </div>
              ))}
            </div>

            <motion.div {...reveal(0.05)} className="relative mt-[clamp(12px,3.5dvh,32px)] flex justify-center">
              <div aria-hidden="true" className="absolute inset-4 rounded-full bg-gold/20 blur-[28px]" />
              <img
                src="/pollitos/pollito_pibe_lider-256.webp"
                alt=""
                width={140}
                height={140}
                className="relative h-[clamp(88px,17dvh,140px)] w-[clamp(88px,17dvh,140px)] max-w-none object-contain"
              />
            </motion.div>

            <motion.p
              {...reveal(0.2)}
              className="mt-2 text-center font-display text-[clamp(44px,7.4dvh,62px)] leading-[0.95] tracking-[0.05em] [-webkit-text-size-adjust:none] [text-size-adjust:none]"
            >
              {part3 ? (
                <>
                  <span className="text-gold">{part1}</span>{" "}
                  <span className="text-[#2F6DF4]">{part2}</span>
                  <br />
                  <span className="text-[#E4463A]">{part3}</span>
                </>
              ) : (
                <>
                  <span className="text-gold">{part1}</span>{" "}
                  <span className="text-gold">{part2}</span>
                </>
              )}
            </motion.p>

            <motion.p {...reveal(0.35)} className="mt-[clamp(8px,2.4dvh,20px)] text-center text-[15px] font-medium text-text-secondary">
              {t("lead")}
            </motion.p>

            <h1 className="relative mt-1 flex h-[clamp(84px,12.5dvh,104px)] w-full [-webkit-text-size-adjust:none] [text-size-adjust:none] items-center justify-center text-center font-display font-normal leading-none tracking-[0.03em] text-text-primary">
              <span className="sr-only">{t("screenReader")}</span>
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={word.key}
                  aria-hidden="true"
                  className={`${word.size} block max-w-full [overflow-wrap:anywhere] [text-wrap:balance]`}
                  initial={prefersReducedMotion ? false : { opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -24 }}
                  transition={{ duration: prefersReducedMotion ? 0 : 0.18, ease: SMOOTH }}
                >
                  {t(word.key)}
                </motion.span>
              </AnimatePresence>
            </h1>

            <motion.p
              {...reveal(0.9)}
              aria-hidden="true"
              className="mt-2 text-center text-[14px] font-medium leading-normal text-text-secondary"
            >
              {t("summary")}
            </motion.p>

            <div className="min-h-6 flex-1" />

            <motion.p
              {...reveal(0.9)}
              className="max-w-[300px] text-center text-[17px] font-semibold leading-snug text-text-primary"
            >
              {t("fans")}
            </motion.p>

            <motion.p
              {...reveal(1.05)}
              className="mt-4 rounded-[28px] bg-turf px-7 py-3 text-center text-[15px] font-medium leading-snug text-bg-base shadow-[0_0_24px_rgba(31,216,127,0.35)]"
            >
              <svg
                aria-hidden="true"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="currentColor"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mr-1.5 inline-block align-[-3px]"
              >
                <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
              </svg>
              {t("partnerLead")}
              <br />
              <strong className="font-bold">{t("partnerName")}</strong>
            </motion.p>

            {/* El botón llega al segundo: nadie espera la rotación completa. */}
            <motion.div
              {...reveal(CTA_DELAY_S)}
              className="mt-5 w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={dismiss}
                className="min-h-[52px] w-full rounded-full bg-gold px-10 py-3 text-[17px] font-bold text-bg-base transition-all hover:brightness-110 active:scale-[0.98]"
              >
                {t("start")}
              </button>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default WelcomeIntro;
