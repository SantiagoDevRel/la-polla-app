// components/inicio/HighlightsStrip.tsx — Strip "Lo último del Mundial".
//
// Highlights/goles/resúmenes del Mundial de canales de broadcasters (Gol
// Caracol, ESPN Deportes…) que SÍ permiten embed → se reproducen INLINE
// dentro de La Polla, sin salir a YouTube. El iframe carga SOLO al tocar
// play (lazy); hasta entonces solo el poster (i.ytimg.com, en el CSP).
//
// Client Component: fetchea /api/highlights on-mount. Si falla o no hay
// clips, NO renderiza nada — jamás rompe el home.
"use client";

import { useEffect, useState } from "react";
import { Film, Play } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

interface HighlightVideo {
  videoId: string;
  title: string;
  channel: string;
  publishedAt: string | null;
  thumbnail: string;
  embedUrl: string;
  watchUrl: string;
}

// "hace 2h" / "2h ago" desde el publishedAt (client-side, aproximado).
function relativeTime(iso: string | null, locale: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMin = Math.max(0, Math.round((Date.now() - then) / 60000));
  const en = locale === "en";
  if (diffMin < 1) return en ? "just now" : "ahora";
  if (diffMin < 60) return en ? `${diffMin}m ago` : `hace ${diffMin}m`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return en ? `${diffH}h ago` : `hace ${diffH}h`;
  const diffD = Math.round(diffH / 24);
  return en ? `${diffD}d ago` : `hace ${diffD}d`;
}

function HighlightCard({ v, locale }: { v: HighlightVideo; locale: string }) {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="snap-center shrink-0 w-[260px]">
      <div className="lp-card overflow-hidden !p-0">
        {/* Player 16:9 — iframe lazy al tocar play */}
        <div className="relative aspect-video bg-black">
          {playing ? (
            <iframe
              src={`${v.embedUrl}?autoplay=1&rel=0&playsinline=1`}
              title={v.title}
              loading="lazy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              className="absolute inset-0 h-full w-full"
            />
          ) : (
            <button
              type="button"
              onClick={() => setPlaying(true)}
              aria-label={v.title}
              className="group absolute inset-0 cursor-pointer"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={v.thumbnail}
                alt=""
                loading="lazy"
                onError={(e) => {
                  // Thumbnail muerto (404) → caemos a la copa (nunca card vacía).
                  const img = e.currentTarget;
                  if (!img.src.endsWith("/highlight-fallback.webp")) {
                    img.src = "/highlight-fallback.webp";
                  }
                }}
                onLoad={(e) => {
                  // YouTube sirve un placeholder GRIS de 120x90 cuando el video
                  // no tiene thumbnail (no dispara onError) — lo detectamos por
                  // tamaño y caemos a la copa.
                  const img = e.currentTarget;
                  if (
                    img.naturalWidth > 0 &&
                    img.naturalWidth <= 120 &&
                    !img.src.endsWith("/highlight-fallback.webp")
                  ) {
                    img.src = "/highlight-fallback.webp";
                  }
                }}
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
              />
              <span
                aria-hidden="true"
                className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent"
              />
              {/* Play glass blanco — NO gold (la regla de oro reserva el
                  dorado; acá va el lenguaje glass del BottomNav). */}
              <span
                aria-hidden="true"
                className="absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/30 bg-white/15 backdrop-blur-md transition-all duration-200 group-hover:scale-110 group-hover:bg-white/25"
              >
                <Play className="h-5 w-5 translate-x-[1px] fill-white text-white" />
              </span>
            </button>
          )}
        </div>
        {/* Meta */}
        <div className="p-3">
          <a
            href={v.watchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="line-clamp-2 text-sm font-medium leading-snug text-text-primary transition-colors hover:text-gold [overflow-wrap:anywhere]"
          >
            {v.title}
          </a>
          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-text-muted">
            <span className="font-semibold tracking-wide text-text-secondary [overflow-wrap:anywhere]">
              {v.channel}
            </span>
            <span aria-hidden="true">·</span>
            <span className="shrink-0">{relativeTime(v.publishedAt, locale)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="shrink-0 w-[260px]">
      <div className="lp-card overflow-hidden !p-0">
        <div className="aspect-video animate-pulse bg-bg-elevated" />
        <div className="space-y-2 p-3">
          <div className="h-3.5 w-11/12 animate-pulse rounded bg-bg-elevated" />
          <div className="h-3.5 w-2/3 animate-pulse rounded bg-bg-elevated" />
        </div>
      </div>
    </div>
  );
}

export function HighlightsStrip() {
  const t = useTranslations("Inicio");
  const locale = useLocale();
  const [videos, setVideos] = useState<HighlightVideo[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/highlights")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("http"))))
      .then((d: { videos?: HighlightVideo[] }) => {
        if (alive) setVideos(Array.isArray(d.videos) ? d.videos : []);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Nunca romper el home: ante fallo o lista vacía, no renderiza la sección.
  if (failed) return null;
  if (videos !== null && videos.length === 0) return null;

  return (
    <section>
      <h2 className="lp-section-title px-4 mb-3 flex items-center gap-2">
        <Film className="h-4 w-4 text-gold" aria-hidden="true" />
        {t("highlightsTitle")}
      </h2>
      <div className="overflow-x-auto hide-scrollbar">
        <div className="flex gap-3 px-4 pb-1 snap-x snap-mandatory">
          {videos === null
            ? Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)
            : videos.map((v) => <HighlightCard key={v.videoId} v={v} locale={locale} />)}
        </div>
      </div>
    </section>
  );
}
