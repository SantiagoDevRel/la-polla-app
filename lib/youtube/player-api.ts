"use client";

interface Player { destroy(): void }
interface PlayerApi {
  Player: new (element: HTMLIFrameElement, options: { events: { onError: (event: { data: number }) => void } }) => Player;
}
declare global {
  interface Window { YT?: PlayerApi; onYouTubeIframeAPIReady?: () => void }
}
let pending: Promise<PlayerApi> | null = null;

/** Loaded only after pressing play, so embeds never delay the home screen. */
export function loadYoutubePlayerApi(): Promise<PlayerApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (pending) return pending;
  pending = new Promise<PlayerApi>((resolve, reject) => {
    const script = document.createElement("script");
    const previous = window.onYouTubeIframeAPIReady;
    const timer = window.setTimeout(fail, 10_000);
    function fail() {
      window.clearTimeout(timer);
      window.onYouTubeIframeAPIReady = previous;
      script.remove();
      pending = null;
      reject(new Error("YouTube player API unavailable"));
    }
    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timer);
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
      else fail();
    };
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return pending;
}
