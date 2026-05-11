// components/layout/background-variants.ts — Pool de videos ambient para
// AppBackground. Cada variant tiene su poster + webm + mp4 lite.
//
// Reusamos los 5 clips que ya viven en /public/videos (los 4 "momentos"
// la-polla-* ya aparecen en modals/avisos, ademas como ambient rotativo
// dan vida al background sin pagar bytes extra de descarga unica).

export const BACKGROUND_VARIANTS = [
  "nuevo-background",
  "la-polla-celebration",
  "la-polla-rankup-moment",
  "la-polla-rivales",
  "la-polla-triste",
] as const;

export type BackgroundVariant = (typeof BACKGROUND_VARIANTS)[number];

export interface BackgroundSources {
  poster: string;
  webm: string;
  mp4: string;
}

export const BACKGROUND_SOURCES: Record<BackgroundVariant, BackgroundSources> = {
  "nuevo-background": {
    poster: "/videos/nuevo-background-poster.webp",
    webm: "/videos/nuevo-background.webm",
    mp4: "/videos/nuevo-background-lite.mp4",
  },
  "la-polla-celebration": {
    poster: "/videos/la-polla-celebration-poster.webp",
    webm: "/videos/la-polla-celebration.webm",
    mp4: "/videos/la-polla-celebration-lite.mp4",
  },
  "la-polla-rankup-moment": {
    poster: "/videos/la-polla-rankup-moment-poster.webp",
    webm: "/videos/la-polla-rankup-moment.webm",
    mp4: "/videos/la-polla-rankup-moment-lite.mp4",
  },
  "la-polla-rivales": {
    poster: "/videos/la-polla-rivales-poster.webp",
    webm: "/videos/la-polla-rivales.webm",
    mp4: "/videos/la-polla-rivales-lite.mp4",
  },
  "la-polla-triste": {
    poster: "/videos/la-polla-triste-poster.webp",
    webm: "/videos/la-polla-triste.webm",
    mp4: "/videos/la-polla-triste-lite.mp4",
  },
};

export function pickRandomVariant(): BackgroundVariant {
  const i = Math.floor(Math.random() * BACKGROUND_VARIANTS.length);
  return BACKGROUND_VARIANTS[i];
}
