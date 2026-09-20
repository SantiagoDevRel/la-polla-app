"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Film, Play, X } from "lucide-react";
import { useLocale } from "next-intl";
import type { PollaHighlight } from "@/lib/highlights/matching";
import { colombiaDateKey } from "@/lib/time/colombia";
import { loadYoutubePlayerApi } from "@/lib/youtube/player-api";

interface Feed { enabled: boolean; day: string; videos: PollaHighlight[]; partial: boolean; matchCount?: number }
interface Props { polla?: string; matchId?: string; className?: string }

function VideoDialog({ video, onClose, en }: { video: PollaHighlight; onClose: () => void; en: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  const [playerError, setPlayerError] = useState<number | null>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { previous?.focus(); };
  }, []);
  useEffect(() => {
    let active = true;
    let player: { destroy(): void } | undefined;
    void loadYoutubePlayerApi().then(api => {
      if (active && iframe.current) player = new api.Player(iframe.current, { events: {
        onError: event => { if (active) setPlayerError(event.data); },
      } });
    }).catch(() => { /* The standard iframe still works if the optional API fails. */ });
    return () => { active = false; player?.destroy(); };
  }, []);
  return <dialog ref={dialog} aria-labelledby={titleId} onCancel={onClose}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-xl border border-border-strong bg-bg-card p-0 text-text-primary shadow-xl backdrop:bg-bg-base/85">
    <div className="flex items-start gap-3 p-4">
      <h2 id={titleId} className="min-w-0 flex-1 text-[15px] font-semibold leading-relaxed [overflow-wrap:anywhere]">{video.title}</h2>
      <button type="button" autoFocus onClick={onClose} aria-label={en ? "Close video" : "Cerrar video"}
        className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border-subtle transition-colors hover:bg-bg-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-turf"><X className="h-5 w-5" /></button>
    </div>
    {playerError !== null && <p role="status" className="px-4 pb-4 text-[15px] leading-relaxed text-text-secondary">{[101, 150].includes(playerError)
      ? (en ? "This channel doesn't allow this video to play inside the app. You can watch it on YouTube." : "El canal no permite reproducir este video dentro de la app. Puedes verlo en YouTube.")
      : (en ? "This video can't be played here right now. Try opening it on YouTube." : "Este video no se puede reproducir aquí en este momento. Intenta abrirlo en YouTube.")}</p>}
    <iframe ref={iframe} src={`https://www.youtube-nocookie.com/embed/${video.videoId}?autoplay=1&playsinline=1&rel=0&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`}
      title={`${en ? "Match highlights" : "Resumen del partido"}: ${video.title}`}
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      referrerPolicy="strict-origin-when-cross-origin" allowFullScreen
      className={playerError === null ? "aspect-video min-h-[200px] w-full border-0 bg-bg-base" : "hidden"} />
    <div className="space-y-2 p-4 text-[13px] leading-relaxed text-text-secondary">
      <p>{video.channel}</p>
      <a href={`https://www.youtube.com/watch?v=${video.videoId}`} target="_blank" rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border-subtle px-4 font-semibold transition-colors hover:bg-bg-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-turf">
        <ExternalLink className="h-4 w-4 shrink-0" />{en ? "If it won't play, open YouTube" : "Si no reproduce, abrir en YouTube"}
      </a>
    </div>
  </dialog>;
}

/** Today's published Casa matches; a matchId permits a scoped historical video. */
export function PollaHighlights({ polla, matchId, className = "" }: Props) {
  const en = useLocale() === "en";
  const [feed, setFeed] = useState<Feed | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<PollaHighlight | null>(null);
  const [revision, setRevision] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const inFlight = useRef(false);
  const params = new URLSearchParams();
  if (polla) params.set("polla", polla);
  if (matchId) params.set("match", matchId);
  const endpoint = `/api/casa/highlights${params.size ? `?${params}` : ""}`;
  const retry = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => {
    let alive = true;
    let controller: AbortController | undefined;
    inFlight.current = false;
    setFeed(null); setFailed(false); setSelected(null);
    async function refresh() {
      if (document.hidden || inFlight.current) return;
      inFlight.current = true;
      controller = new AbortController();
      try {
        const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Highlights unavailable");
        const next: Feed = await response.json();
        if (!Array.isArray(next.videos)) throw new Error("Invalid highlights");
        if (alive) { setFeed(next); setFailed(false); }
      } catch {
        if (alive && !controller?.signal.aborted) setFailed(true);
      } finally { if (alive) inFlight.current = false; }
    }
    void refresh();
    // Discover delayed summaries and new finals without requiring a reload.
    const timer = window.setInterval(refresh, 300_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { alive = false; controller?.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [endpoint, revision]);

  if (feed?.enabled === false) return null;
  if (matchId && feed?.matchCount === 0) return null;
  // At Colombia midnight never label yesterday's cached response as today.
  const videos = feed && (matchId || feed.day === colombiaDateKey(new Date())) ? feed.videos : [];
  // Keep polling while hidden, but do not reserve space or show an empty,
  // loading or error state. This discovery section only exists with content.
  if (!feed || videos.length === 0) return null;
  const title = matchId ? (en ? "Match highlights" : "Resumen del partido") : (en ? "Today's highlights" : "Resúmenes de hoy");
  return <section aria-labelledby={titleId} className={`min-w-0 space-y-3 ${className}`} data-polla-highlights>
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <h2 id={titleId} className="flex items-center gap-2 font-display text-[20px] font-normal leading-tight tracking-[0.04em] text-text-primary">
          <Film className="h-5 w-5 shrink-0 text-text-secondary" aria-hidden="true" />{title}
        </h2>
        {!matchId && <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">{polla ? (en ? "Matches in this pool." : "Partidos de esta polla.") : (en ? "Matches in the Casa pools." : "Partidos de las pollas de la Casa.")}</p>}
      </div>
      {videos.length > 1 && <div className="flex shrink-0 gap-1">
        {[-1, 1].map(direction => <button key={direction} type="button"
          aria-label={direction < 0 ? (en ? "Previous highlights" : "Resúmenes anteriores") : (en ? "Next highlights" : "Más resúmenes")}
          onClick={() => scroller.current?.scrollBy({ left: direction * 272, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" })}
          className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-border-subtle transition-colors hover:bg-bg-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-turf">
          {direction < 0 ? <ChevronLeft className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
        </button>)}
      </div>}
    </div>
    <>
      <div ref={scroller} role="region" aria-label={title} tabIndex={0}
        className="lp-hscroll flex snap-x snap-mandatory items-stretch gap-3 overflow-x-auto overscroll-x-contain pb-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-turf">
        {videos.map(video => <article key={video.matchId} className="lp-card flex w-[260px] max-w-full shrink-0 snap-start flex-col overflow-hidden !p-0">
          <button type="button" onClick={() => setSelected(video)} aria-label={`${en ? "Watch highlights" : "Ver resumen"}: ${video.title}`}
            className="group relative flex flex-1 cursor-pointer flex-col text-left transition-colors hover:bg-bg-elevated focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-turf">
            <span className="relative block aspect-video w-full overflow-hidden bg-bg-elevated">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`} alt="" loading="lazy" className="h-full w-full object-cover"
                onError={event => { event.currentTarget.hidden = true; }} />
              <span className="absolute inset-0 flex items-center justify-center bg-bg-base/20"><span className="flex h-12 w-12 items-center justify-center rounded-full border border-border-strong bg-bg-base/80 text-text-primary transition-transform motion-safe:group-hover:scale-110"><Play className="h-5 w-5 fill-current" aria-hidden="true" /></span></span>
            </span>
            <span className="block w-full space-y-2 p-3">
              <span className="block text-[15px] font-semibold leading-relaxed text-text-primary [overflow-wrap:anywhere]">{video.title}</span>
              <span className="block text-[13px] leading-relaxed text-text-secondary [overflow-wrap:anywhere]">{video.channel}</span>
              <span className="block text-[13px] font-semibold leading-relaxed text-text-primary">{en ? "Watch highlights" : "Ver resumen"}</span>
            </span>
          </button>
        </article>)}
      </div>
      {(failed || feed?.partial) && <div role="status" className="rounded-lg border border-border-subtle bg-bg-card/80 p-3 text-[13px] leading-relaxed text-text-secondary">
        <p>{en ? "Some highlights couldn't be loaded." : "No pudimos cargar todos los resúmenes."}</p>
        <button type="button" onClick={retry} className="mt-2 min-h-11 cursor-pointer rounded-full border border-border-subtle px-4 font-semibold transition-colors hover:bg-bg-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-turf">{en ? "Try again" : "Reintentar"}</button>
      </div>}
      <a href="https://www.thesportsdb.com" target="_blank" rel="noopener noreferrer" className="inline-block rounded text-[13px] leading-relaxed text-text-muted underline underline-offset-4 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-turf">{en ? "Videos found with TheSportsDB" : "Videos encontrados con TheSportsDB"}</a>
    </>
    {selected && <VideoDialog video={selected} en={en} onClose={() => setSelected(null)} />}
  </section>;
}
