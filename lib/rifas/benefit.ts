import "server-only";
// lib/rifas/benefit.ts — rifas sin ánimo de lucro: para qué es la plata y la camiseta que gira.
//
// Mismo patrón que components/casa/prize-media.ts: la portada especial se
// enlaza por el uuid de la rifa y los assets viven versionados en /public.
// Solo cambia lo que se ve; quién puede ver la rifa lo sigue decidiendo SQL
// (rifa_public_view_v1) antes de llegar aquí.
import type { PrizeMedia, PrizePhoto } from "@/components/casa/PrizeShowcase";

export interface RifaBenefit {
  /** «Rifa para …»: el titular grande de la portada. */
  cause: string;
  /** Qué se compra con lo recaudado. */
  detail: string;
  /** La camiseta que se rifa, girando, con sus fotos reales debajo («Ver foto original»). */
  jersey: { media: PrizeMedia; label: string; photos: readonly PrizePhoto[] } | null;
}

/**
 * (2026-11-08, v2) Camiseta de arquero firmada por Franco Armani y René Higuita.
 * El giro ya no pega las fotos: es una recreación limpia (frente y espalda sin
 * maniquí, generadas con IA a partir de las dos fotos) sobre un volumen en
 * Blender, 144 poses. Las firmas del giro son una recreación repasada en dorado
 * para que se lean; las reales están en las fotos originales. Carpeta versionada
 * por contenido; un cambio crea otra.
 */
function armaniJersey(base = "/prizes/armani-8e245f817802/"): RifaBenefit["jersey"] {
  return {
    label: "Camiseta de arquero firmada por Franco Armani y René Higuita, girando",
    media: {
      front: `${base}armani-v2-front.png`, back: `${base}armani-v2-back.png`, poster: `${base}armani-v2-poster.png`,
      video: `${base}armani-v2-turntable.webm`, animation: `${base}armani-v2-turntable.webp`,
      turntable: { small: `${base}armani-v2-atlas-192-`, large: `${base}armani-v2-atlas-512-` },
    },
    photos: [
      { src: `${base}armani-real-front.jpg`, label: "Frente y autógrafos", alt: "Foto original del frente de la camiseta con los autógrafos de Franco Armani y René Higuita" },
      { src: `${base}armani-real-back.jpg`, label: "Espalda", alt: "Foto original de la espalda de la camiseta" },
    ],
  };
}

const LA_IGUANA = {
  cause: "una familia damnificada en La Iguaná",
  detail: "Todo lo recaudado compra camas, colchones, cobijas y almohadas para su casa.",
} as const;

/** Rifa solidaria La Iguaná: una camiseta por rifa, de a una. */
const BENEFIT_RIFAS: Readonly<Record<string, () => RifaBenefit>> = {
  "495aa5b1-767c-47bb-8487-15223ab44f63": () => ({ ...LA_IGUANA, jersey: armaniJersey() }),
};

/** Las rifas sin ánimo de lucro van de primeras en el inicio, para todos (si son Públicas). */
export const FEATURED_RIFA_IDS: readonly string[] = Object.keys(BENEFIT_RIFAS);

export function rifaBenefit(rifaId: string): RifaBenefit | null {
  return BENEFIT_RIFAS[rifaId]?.() ?? null;
}

/**
 * (2026-11-08) La camiseta de frente para las imágenes de historia: PNG en
 * assets/rifas-story (satori no decodifica WebP). Va por slug porque la imagen
 * solo recibe el slug desde SQL, igual que lib/rifas/partner.ts.
 */
const STORY_PRIZE_BY_SLUG: Readonly<Record<string, string>> = {
  "rifa-solidaria-la-iguana-camiseta": "assets/rifas-story/premios/armani-frente.png",
};

export function rifaStoryPrize(slug: string): string | null {
  return STORY_PRIZE_BY_SLUG[slug] ?? null;
}
