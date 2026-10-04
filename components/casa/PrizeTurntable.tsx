"use client";

import { useEffect, useRef, useState } from "react";
import type { MotionValue } from "framer-motion";
import { cn } from "@/lib/cn";

export type TurntableMedia = { small: string; large: string };

/** Six rendered poses per page; only three decoded pages stay referenced. */
export function PrizeTurntable({ media, angle, label, poster }: {
  media: TurntableMedia; angle: MotionValue<number>; label: string; poster: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    const cache = new Map<string, Promise<HTMLImageElement>>();
    let alive = true, size = 192, requested = -1;
    const index = () => Math.round((((angle.get() + 15) % 360 + 360) % 360) / 2.5) % 144;
    const url = (page: number) => `${size === 512 ? media.large : media.small}${page.toString().padStart(2, "0")}.webp`;
    const load = (source: string) => {
      let pending = cache.get(source);
      if (pending) cache.delete(source);
      else pending = new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => { cache.delete(source); reject(new Error("Prize frame unavailable")); };
        image.src = source;
      });
      cache.set(source, pending);
      while (cache.size > 3) cache.delete(cache.keys().next().value!);
      return pending;
    };
    const paint = () => {
      const frame = index();
      if (frame === requested) return;
      requested = frame;
      const page = Math.floor(frame / 6), source = url(page), resolution = size;
      void load(source).then(image => {
        const current = index();
        if (!alive || size !== resolution || Math.floor(current / 6) !== page) return;
        if (element.width !== size) { element.width = size; element.height = size; }
        context.clearRect(0, 0, size, size);
        context.drawImage(image, current % 3 * size, Math.floor(current % 6 / 3) * size, size, size, 0, 0, size, size);
        element.dataset.prizeFrame = String(current + 1);
        element.dataset.prizeAngle = String((current * 2.5 - 15 + 360) % 360);
        setReady(true);
      }).catch(() => { if (alive) requested = -1; });
      const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
      if (!connection?.saveData) {
        void load(url((page + 1) % 24)).catch(() => {});
        void load(url((page + 23) % 24)).catch(() => {});
      }
    };
    const resize = new ResizeObserver(() => {
      const next = Math.max(element.clientWidth, element.clientHeight) > 160 ? 512 : 192;
      if (next !== size) { size = next; requested = -1; }
      paint();
    });
    resize.observe(element);
    const unsubscribe = angle.on("change", paint);
    paint();
    return () => { alive = false; unsubscribe(); resize.disconnect(); cache.clear(); };
  }, [angle, media.large, media.small]);

  return <div className="relative h-full w-full">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={poster} alt={label} width={512} height={512} draggable={false}
      className={cn("absolute inset-0 h-full w-full select-none object-contain", ready && "invisible")} />
    <canvas ref={canvas} width={192} height={192} role="img" aria-label={label}
      className={cn("h-full w-full select-none object-contain", !ready && "invisible")} />
  </div>;
}
