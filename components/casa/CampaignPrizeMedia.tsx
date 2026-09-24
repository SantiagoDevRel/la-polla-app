"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

/** Same private media gate for stills, video and the transparent WebKit animation. */
export function CampaignPrizeMedia({ id, label, animated = false, className }: {
  id: string; label: string; animated?: boolean; className?: string;
}) {
  const box = useRef<HTMLSpanElement>(null);
  const [mode, setMode] = useState<"poster" | "video" | "animation">("poster");
  const [failures, setFailures] = useState<{ id: string; video?: boolean; animation?: boolean }>({ id });
  const videoFailed = failures.id === id && failures.video;
  const animationFailed = failures.id === id && failures.animation;
  const activeMode = !animated || animationFailed ? "poster" : mode === "video" && videoFailed ? "animation" : mode;
  const source = `/api/casa/admin/pollas/${id}/draft-image`;

  useEffect(() => {
    if (!animated || !box.current) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const connection = (navigator as Navigator & { connection?: EventTarget & { saveData?: boolean } }).connection;
    const webkit = /AppleWebKit/.test(navigator.userAgent) && !/(Chrome|Chromium|Edg|OPR)\//.test(navigator.userAgent);
    let visible = false;
    const sync = () => setMode(visible && !document.hidden && !reducedMotion.matches && !connection?.saveData
      ? webkit ? "animation" : "video" : "poster");
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
    observer.observe(box.current);
    reducedMotion.addEventListener("change", sync);
    connection?.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      observer.disconnect();
      reducedMotion.removeEventListener("change", sync);
      connection?.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [animated, id]);

  return <span ref={box} className={cn("relative block h-16 w-14 max-w-none shrink-0", className)}>
    {activeMode === "video" ? (
      <video src={`${source}?asset=video`} autoPlay muted loop playsInline preload="none" poster={source}
        aria-label={label} className="h-full w-full object-contain"
        onError={() => setFailures({ id, video: true })} />
    ) : (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={activeMode === "animation" ? `${source}?asset=animation` : source}
        onError={activeMode === "animation" ? () => setFailures({ id, video: true, animation: true }) : undefined}
        alt={label} width={112} height={128} className="h-full w-full object-contain" />
    )}
  </span>;
}
