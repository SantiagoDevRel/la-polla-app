"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Camera, Pause, Play, RotateCw, X } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/cn";

export type PrizeMedia = { front: string; back: string; poster?: string; video: string; animation: string };
export type PrizePhoto = { src: string; label: string; alt: string };

/** Asset URLs are supplied by the caller's private media boundary. No reads or writes. */
export function PrizeMotion({ media, label, view = "turn", paused = false, className }: {
  media: PrizeMedia; label: string; view?: "turn" | "front" | "back"; paused?: boolean; className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"still" | "video" | "animation">("still");
  const [failed, setFailed] = useState<string | null>(null);
  const [animationFailed, setAnimationFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!box.current || paused || view !== "turn") return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const connection = (navigator as Navigator & { connection?: EventTarget & { saveData?: boolean } }).connection;
    const webkit = /AppleWebKit/.test(navigator.userAgent) && !/(Chrome|Chromium|Edg|OPR)\//.test(navigator.userAgent);
    let visible = false;
    const sync = () => setMode(visible && !document.hidden && !reduced.matches && !connection?.saveData ? webkit ? "animation" : "video" : "still");
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
    observer.observe(box.current);
    reduced.addEventListener("change", sync);
    connection?.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => { observer.disconnect(); reduced.removeEventListener("change", sync); connection?.removeEventListener("change", sync); document.removeEventListener("visibilitychange", sync); };
  }, [paused, view, media.video]);
  const active = paused || view !== "turn" || animationFailed === media.animation ? "still" : mode === "video" && failed === media.video ? "animation" : mode;
  return <div ref={box} className={cn("relative", className)}>
    {active === "video" ? <video src={media.video} poster={media.poster ?? media.front} aria-label={label} autoPlay muted loop playsInline preload="none"
      className="h-full w-full object-contain" onError={() => setFailed(media.video)} /> :
      // eslint-disable-next-line @next/next/no-img-element
      <img src={active === "animation" ? media.animation : view === "back" ? media.back : view === "turn" ? media.poster ?? media.front : media.front} alt={label} width={512} height={512}
        className="h-full w-full object-contain" onError={active === "animation" ? () => setAnimationFailed(media.animation) : undefined} />}
  </div>;
}

const BILL_POSITIONS = [
  "-rotate-[36deg] -translate-x-[26%] translate-y-[12%]", "-rotate-[28deg] -translate-x-[20%] translate-y-[7%]",
  "-rotate-[20deg] -translate-x-[14%] translate-y-[3%]", "-rotate-[12deg] -translate-x-[8%] translate-y-[1%]",
  "-rotate-[4deg] -translate-x-[2%]", "rotate-[4deg] translate-x-[2%]",
  "rotate-[12deg] translate-x-[8%] translate-y-[1%]", "rotate-[20deg] translate-x-[14%] translate-y-[3%]",
  "rotate-[28deg] translate-x-[20%] translate-y-[7%]", "rotate-[36deg] translate-x-[26%] translate-y-[12%]",
];

/** Ten real banknote images; the monetary label remains supplied by SQL/caller. */
export function CashPrizeVisual({ banknote, compact = false }: { banknote: string; compact?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    if (!box.current) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false;
    const sync = () => setAnimate(visible && !document.hidden && !reduced.matches);
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
    observer.observe(box.current); reduced.addEventListener("change", sync); document.addEventListener("visibilitychange", sync);
    return () => { observer.disconnect(); reduced.removeEventListener("change", sync); document.removeEventListener("visibilitychange", sync); };
  }, []);
  return <div ref={box} role="img" aria-label="Diez billetes colombianos de cien mil pesos" className={cn("relative mx-auto w-full max-w-[360px]", compact ? "aspect-[360/240]" : "aspect-[360/260]")}>
    <motion.div className="absolute inset-0 [perspective:800px]" animate={animate ? { y: [0, -7, 0], rotate: [-2, 2, -2] } : { y: 0, rotate: 0 }} transition={animate ? { duration: 6, repeat: Infinity, ease: "easeInOut" } : { duration: 0 }}>
      {BILL_POSITIONS.map((position, index) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={position} data-banknote={index + 1} src={banknote} alt="" aria-hidden="true" width={862} height={373}
          className={cn("absolute left-[18%] top-[10%] w-[64%] max-w-none origin-bottom rounded-[2px] border border-border-strong shadow-[0_8px_24px_-8px_rgba(0,0,0,0.5)]", position)} />
      ))}
    </motion.div>
  </div>;
}

export function JerseyPrizeShowcase({ media, photos }: { media: PrizeMedia; photos: readonly PrizePhoto[] }) {
  const [view, setView] = useState<"turn" | "front" | "back">("turn");
  const [paused, setPaused] = useState(false);
  const [photo, setPhoto] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  return <section aria-label="Camiseta de James Rodríguez" className="overflow-hidden rounded-xl border border-border-default bg-bg-card/80 backdrop-blur-sm">
    <div className="relative bg-gradient-to-b from-turf/10 via-bg-card/40 to-bg-card/80 px-4 pt-5">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-[20%] top-[15%] h-[180px] rounded-full bg-turf/10 blur-3xl" />
      <PrizeMotion media={media} label={view === "back" ? "Espalda de la camiseta: James, número 23" : "Camiseta de Nacional de James Rodríguez"} view={view} paused={paused} className="mx-auto h-[300px] w-full max-w-[360px]" />
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2 pb-5">
        {([['turn', 'Giro', RotateCw], ['front', 'Frente', null], ['back', 'Espalda', null]] as const).map(([key, label, Icon]) =>
          <button key={key} type="button" aria-pressed={view === key} onClick={() => setView(key)} className={cn("flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-[15px] font-medium transition-colors hover:bg-bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold", view === key ? "border-border-strong bg-bg-elevated text-text-primary" : "border-border-subtle text-text-secondary")}>
            {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}{label}
          </button>)}
        {view === "turn" && <button type="button" onClick={() => setPaused(!paused)} aria-label={paused ? "Reanudar giro" : "Pausar giro"} className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-border-subtle text-text-secondary transition-colors hover:bg-bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold">
          {paused ? <Play className="h-4 w-4" aria-hidden="true" /> : <Pause className="h-4 w-4" aria-hidden="true" />}
        </button>}
      </div>
    </div>
    <div className="border-t border-border-subtle p-4">
      <h2 className="font-display text-[20px] font-normal leading-none tracking-[0.04em]">Fotos del premio real</h2>
      <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,12ch),1fr))] gap-3">
        {photos.map((item, index) => <button key={item.src} type="button" onClick={() => { setPhoto(index); dialog.current?.showModal(); }} className="group cursor-pointer overflow-hidden rounded-md border border-border-default text-left transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.src} alt={item.alt} width={1368} height={1824} loading="lazy" className="aspect-[4/3] w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]" />
          <span className="flex min-h-11 items-center gap-2 px-3 py-2 text-[13px] leading-[1.5] text-text-primary"><Camera className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="min-w-0 [overflow-wrap:anywhere]">{item.label}</span></span>
        </button>)}
      </div>
    </div>
    <dialog ref={dialog} aria-labelledby={id} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }} className="fixed inset-0 m-auto max-h-[94dvh] w-[calc(100%-24px)] max-w-[720px] overflow-y-auto rounded-xl border border-border-strong bg-bg-card p-0 text-text-primary backdrop:bg-bg-base/85 backdrop:backdrop-blur-sm">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border-default bg-bg-card px-4 py-2">
        <h2 id={id} className="text-[15px] font-semibold leading-[1.45]">{photos[photo]?.label} · Foto original</h2>
        <button type="button" autoFocus onClick={() => dialog.current?.close()} aria-label="Cerrar foto" className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"><X className="h-5 w-5" aria-hidden="true" /></button>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photos[photo]?.src} alt={photos[photo]?.alt} width={1368} height={1824} className="h-auto w-full object-contain" />
    </dialog>
  </section>;
}
