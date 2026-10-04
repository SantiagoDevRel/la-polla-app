"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { X } from "lucide-react";
import { animate as animateValue, motion, useMotionValue } from "framer-motion";
import { cn } from "@/lib/cn";
import { HorizontalPrize } from "./HorizontalPrize";
import { PrizeTurntable, type TurntableMedia } from "./PrizeTurntable";

export type PrizeMedia = { front: string; back: string; poster?: string; video: string; animation: string; turntable?: TurntableMedia };
export type PrizePhoto = { src: string; label: string; alt: string };

function useAutomaticPrizeMotion(box: RefObject<HTMLDivElement | null>) {
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!box.current) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const connection = (navigator as Navigator & { connection?: EventTarget & { saveData?: boolean } }).connection;
    let visible = false;
    const sync = () => setActive(visible && !document.hidden && !reduced.matches && !connection?.saveData);
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
    observer.observe(box.current);
    reduced.addEventListener("change", sync);
    connection?.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => { observer.disconnect(); reduced.removeEventListener("change", sync); connection?.removeEventListener("change", sync); document.removeEventListener("visibilitychange", sync); };
  }, [box]);
  return active;
}

/** Asset URLs are supplied by the caller's private media boundary. No reads or writes. */
export function PrizeMotion({ media, label, view = "turn", paused = false, interactive = false, onPausedChange, onTurnStart, className }: {
  media: PrizeMedia; label: string; view?: "turn" | "front" | "back"; paused?: boolean;
  interactive?: boolean; onPausedChange?: (paused: boolean) => void; onTurnStart?: () => void; className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const angle = useMotionValue(0);
  const automatic = useAutomaticPrizeMotion(box);
  const [mode, setMode] = useState<"still" | "video" | "animation">("still");
  const [failed, setFailed] = useState<string | null>(null);
  const [animationFailed, setAnimationFailed] = useState<string | null>(null);
  const [interactionPaused, setInteractionPaused] = useState(false);
  const [holding, setHolding] = useState(false);
  const isPaused = paused || interactionPaused;
  const playing = automatic && !isPaused && !holding && view === "turn";
  const active = view !== "turn" || animationFailed === media.animation ? "still" : mode === "video" && failed === media.video ? "animation" : mode;

  useEffect(() => {
    if (view === "front") angle.set(0);
    if (view === "back") angle.set(180);
  }, [angle, view]);
  useEffect(() => {
    if (!media.turntable || !playing) return;
    const start = angle.get();
    const spin = animateValue(angle, [start, start + 360], { duration: 6, repeat: Infinity, ease: "linear" });
    return () => spin.stop();
  }, [angle, media.turntable, playing]);

  useEffect(() => {
    if (!automatic || media.turntable) return;
    const webkit = /AppleWebKit/.test(navigator.userAgent) && !/(Chrome|Chromium|Edg|OPR)\//.test(navigator.userAgent);
    setMode(webkit ? "animation" : "video");
  }, [automatic, media.turntable]);
  useEffect(() => {
    const element = video.current;
    if (!element || active !== "video") return;
    if (playing) void element.play().catch(() => {});
    else element.pause();
  }, [active, playing, media.video]);

  const setPaused = (next: boolean) => { if (onPausedChange) onPausedChange(next); else setInteractionPaused(next); };
  const visual = media.turntable ? <PrizeTurntable media={media.turntable} angle={angle} label={label} poster={view === "back" ? media.back : media.front} /> : <>
    {active === "video" ? <video ref={video} src={media.video} poster={media.poster ?? media.front} aria-label={label} autoPlay={playing} muted loop playsInline preload="none"
      draggable={false} className="h-full w-full select-none object-contain" onError={() => setFailed(media.video)} /> :
      // eslint-disable-next-line @next/next/no-img-element
      <img src={active === "animation" && playing ? media.animation : view === "back" ? media.back : view === "turn" ? media.poster ?? media.front : media.front} alt={label} width={512} height={512} draggable={false}
        className="h-full w-full select-none object-contain"
        onError={active === "animation" ? () => setAnimationFailed(media.animation) : undefined} />}
  </>;
  return <div ref={box} className={cn("relative", className)}>
    {interactive && media.turntable ? <HorizontalPrize label={`Girar ${label}`} angle={angle} paused={isPaused} onPausedChange={setPaused} onHoldingChange={next => { setHolding(next); if (next) onTurnStart?.(); }} className="h-full w-full">
      {visual}
    </HorizontalPrize> : visual}
  </div>;
}

const BILL_POSITIONS = [
  "-rotate-[36deg] -translate-x-[26%] translate-y-[12%]", "-rotate-[28deg] -translate-x-[20%] translate-y-[7%]",
  "-rotate-[20deg] -translate-x-[14%] translate-y-[3%]", "-rotate-[12deg] -translate-x-[8%] translate-y-[1%]",
  "-rotate-[4deg] -translate-x-[2%]", "rotate-[4deg] translate-x-[2%]",
  "rotate-[12deg] translate-x-[8%] translate-y-[1%]", "rotate-[20deg] translate-x-[14%] translate-y-[3%]",
  "rotate-[28deg] translate-x-[20%] translate-y-[7%]", "rotate-[36deg] translate-x-[26%] translate-y-[12%]",
];
const FIVE_BILL_POSITIONS = [
  "-rotate-[20deg] -translate-x-[14%] translate-y-[3%]",
  "-rotate-[10deg] -translate-x-[7%] translate-y-[1%]", "rotate-0",
  "rotate-[10deg] translate-x-[7%] translate-y-[1%]",
  "rotate-[20deg] translate-x-[14%] translate-y-[3%]",
];

/** Ten real banknote images; the monetary label remains supplied by SQL/caller. */
export function CashPrizeVisual({ banknote, back, turntable, poster, compact = false, interactive = false }: {
  banknote: string; back?: string; turntable?: TurntableMedia; poster?: string; compact?: boolean; interactive?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const automatic = useAutomaticPrizeMotion(box);
  const [paused, setPaused] = useState(false);
  const [holding, setHolding] = useState(false);
  const y = useMotionValue(0);
  const rotate = useMotionValue(0);
  const angle = useMotionValue(0);
  useEffect(() => {
    if (!automatic || paused || holding) return;
    const options = { duration: 6, repeat: Infinity, ease: "easeInOut" as const };
    const bounce = animateValue(y, [y.get(), compact ? -1 : -7, y.get()], options);
    const tilt = animateValue(rotate, [rotate.get(), compact ? 1 : 2, rotate.get()], options);
    const start = angle.get();
    const spin = back || turntable ? animateValue(angle, [start, start + 360], { duration: 8, repeat: Infinity, ease: "linear" }) : null;
    return () => { bounce.stop(); tilt.stop(); spin?.stop(); };
  }, [angle, automatic, back, compact, holding, paused, rotate, turntable, y]);
  const visual = turntable ? <motion.div className="absolute inset-0" style={{ y, rotate }}>
    <PrizeTurntable media={turntable} angle={angle} label="Diez billetes colombianos de cien mil pesos" poster={poster ?? banknote} />
  </motion.div> : <motion.div className="absolute inset-0 [transform-style:preserve-3d]" style={{ y, rotate, rotateY: angle }}>
      {BILL_POSITIONS.map((position, index) => (
        <span key={position} data-banknote={index + 1} data-bill-group={compact ? index < 5 ? "upper" : "lower" : undefined} aria-hidden="true"
          className={cn("absolute left-[18%] aspect-[720/312] w-[64%] max-w-none origin-bottom [transform-style:preserve-3d]", compact ? index < 5 ? "top-[24%]" : "top-[61%]" : "top-[10%]", compact ? FIVE_BILL_POSITIONS[index % 5] : position)}>
          <motion.span className="absolute inset-0 [transform-style:preserve-3d]" style={{ z: index * 0.2 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img data-bill-face="front" src={banknote} alt="" width={720} height={312} draggable={false}
            className="absolute inset-0 h-full w-full max-w-none select-none rounded-[2px] border border-border-strong shadow-[0_8px_24px_-8px_rgba(0,0,0,0.5)] [backface-visibility:hidden] [transform:translateZ(0.1px)]" />
          {back && <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img data-bill-face="back" src={back} alt="" width={720} height={310} draggable={false}
              className="absolute inset-0 h-full w-full max-w-none select-none rounded-[2px] border border-border-strong shadow-[0_8px_24px_-8px_rgba(0,0,0,0.5)] [backface-visibility:hidden] [transform:rotateY(180deg)_translateZ(0.1px)]" />
          </>}
          </motion.span>
        </span>
      ))}
    </motion.div>;
  return <div ref={box} role={interactive && (back || turntable) ? undefined : "img"} aria-label={interactive && (back || turntable) ? undefined : "Diez billetes colombianos de cien mil pesos"} className={cn("relative mx-auto w-full max-w-[360px] [perspective:800px]", compact ? "aspect-[7/8]" : "aspect-[360/260]")}>
    {interactive && (back || turntable) ? <HorizontalPrize label="Girar el millón: diez billetes de cien mil pesos" angle={angle} paused={paused} onPausedChange={setPaused} onHoldingChange={setHolding} className="absolute inset-0 [transform-style:preserve-3d]">
      {visual}
    </HorizontalPrize> : visual}
  </div>;
}

export function JerseyPrizeShowcase({ media, photos }: { media: PrizeMedia; photos: readonly PrizePhoto[] }) {
  const [photo, setPhoto] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  return <section aria-label="Camiseta de James Rodríguez" className="overflow-hidden rounded-xl border border-border-default bg-bg-card/80 backdrop-blur-sm">
    <div className="relative bg-gradient-to-b from-turf/10 via-bg-card/40 to-bg-card/80 px-4 py-5">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-[20%] top-[15%] h-[180px] rounded-full bg-turf/10 blur-3xl" />
      <PrizeMotion media={media} label="Camiseta de Nacional de James Rodríguez" interactive className="mx-auto h-[300px] w-full max-w-[360px]" />
    </div>
    <div aria-label="Fotos originales de la camiseta" tabIndex={0} className="flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain border-t border-border-subtle p-4 [scrollbar-width:thin] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold">
        {photos.map((item, index) => <button key={item.src} type="button" aria-label={`Ampliar: ${item.alt}`} onClick={() => { setPhoto(index); dialog.current?.showModal(); }} className="group w-[calc(100%-1rem)] shrink-0 snap-start cursor-pointer overflow-hidden rounded-md border border-border-default transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.src} alt={item.alt} width={1536} height={2048} loading="lazy" draggable={false} className="aspect-[3/4] w-full select-none object-contain transition-transform duration-200 group-hover:scale-[1.01]" />
        </button>)}
    </div>
    <dialog ref={dialog} aria-labelledby={id} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }} className="fixed inset-0 m-auto max-h-[94dvh] w-[calc(100%-24px)] max-w-[720px] overflow-y-auto rounded-xl border border-border-strong bg-bg-card p-0 text-text-primary backdrop:bg-bg-base/85 backdrop:backdrop-blur-sm">
      <div className="sticky top-0 z-10 flex items-center justify-end gap-3 border-b border-border-default bg-bg-card px-4 py-2">
        <h2 id={id} className="sr-only">{photos[photo]?.alt}</h2>
        <button type="button" autoFocus onClick={() => dialog.current?.close()} aria-label="Cerrar foto" className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"><X className="h-5 w-5" aria-hidden="true" /></button>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photos[photo]?.src} alt={photos[photo]?.alt} width={1536} height={2048} className="h-auto w-full object-contain" />
    </dialog>
  </section>;
}
