// components/inicio/PodiumCarousel.tsx
//
// Horizontal swipeable carousel of podium cards, one per active polla.
// Uses CSS scroll-snap for gesture handling (consistent with the live
// match strip) and an IntersectionObserver to sync pagination dots with
// the visible page. Each card renders a PodiumLeaderboard + a "Ver
// polla" CTA so users can jump to the detail screen without leaving the
// home surface.
//
// Server parent supplies pre-sorted top3 for each polla so the carousel
// stays a thin presentation layer.
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  PodiumLeaderboard,
  type PodiumEntry,
} from "@/components/leaderboard/PodiumLeaderboard";
import { cn } from "@/lib/cn";

export interface PodiumCarouselItem {
  pollaSlug: string;
  pollaName: string;
  top3: PodiumEntry[];
}

export interface PodiumCarouselProps {
  items: PodiumCarouselItem[];
  currentUserId: string;
  defaultIndex?: number;
}

export function PodiumCarousel({
  items,
  currentUserId,
  defaultIndex = 0,
}: PodiumCarouselProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Array<HTMLElement | null>>([]);
  const [activeIndex, setActiveIndex] = useState(
    Math.min(Math.max(defaultIndex, 0), Math.max(items.length - 1, 0)),
  );

  // Scroll the default page into view on mount without animating.
  useEffect(() => {
    if (!scrollerRef.current || items.length === 0) return;
    const target = pageRefs.current[activeIndex];
    if (target) {
      scrollerRef.current.scrollLeft = target.offsetLeft;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update activeIndex as the user swipes so the dots stay in sync.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const mostVisible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!mostVisible) return;
        const idx = pageRefs.current.findIndex((el) => el === mostVisible.target);
        if (idx >= 0) setActiveIndex(idx);
      },
      { root: scroller, threshold: [0.55, 0.8] },
    );
    for (const el of pageRefs.current) {
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [items.length]);

  if (items.length === 0) return null;

  return (
    <div>
      <div
        ref={scrollerRef}
        className="overflow-x-auto hide-scrollbar snap-x snap-mandatory"
      >
        <div className="flex">
          {items.map((item, i) => (
            <section
              key={item.pollaSlug}
              ref={(el) => {
                pageRefs.current[i] = el;
              }}
              className="snap-center shrink-0 w-full px-4"
            >
              <h3 className="font-display text-[16px] tracking-[0.08em] uppercase text-text-muted mb-2 text-center">
                {item.pollaName}
              </h3>
              <div className="rounded-lg border border-border-subtle bg-bg-card p-4">
                <PodiumLeaderboard
                  top3={item.top3}
                  currentUserId={currentUserId}
                />
                <div className="mt-10 pt-2 pb-1 flex justify-center">
                  <Link
                    href={`/pollas/${item.pollaSlug}`}
                    className="inline-flex items-center gap-2 rounded-full bg-gold text-bg-base font-display tracking-[0.06em] uppercase text-[14px] h-9 px-4 shadow-[0_8px_24px_-6px_rgba(255,215,0,0.4)] hover:-translate-y-px transition-transform"
                  >
                    Ver polla
                    <ArrowRight
                      className="w-4 h-4"
                      strokeWidth={2.5}
                      aria-hidden="true"
                    />
                  </Link>
                </div>
              </div>
            </section>
          ))}
        </div>
      </div>

      {items.length > 1 ? (
        <div className="mt-3 flex items-center justify-center gap-1.5" role="tablist" aria-label="Paginación del podio">
          {items.map((item, i) => (
            <button
              key={item.pollaSlug}
              type="button"
              role="tab"
              aria-selected={i === activeIndex}
              aria-label={`Ir al podio de ${item.pollaName}`}
              onClick={() => {
                const target = pageRefs.current[i];
                if (target && scrollerRef.current) {
                  scrollerRef.current.scrollTo({
                    left: target.offsetLeft,
                    behavior: "smooth",
                  });
                }
              }}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === activeIndex ? "w-5 bg-gold" : "w-1.5 bg-border-default",
              )}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default PodiumCarousel;
