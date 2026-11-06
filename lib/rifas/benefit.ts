import "server-only";
// lib/rifas/benefit.ts — rifas sin ánimo de lucro: para qué es la plata y la camiseta que gira.
//
// Mismo patrón que components/casa/prize-media.ts: la portada especial se
// enlaza por el uuid de la rifa y los assets viven versionados en /public.
// Solo cambia lo que se ve; quién puede ver la rifa lo sigue decidiendo SQL
// (rifa_public_view_v1) antes de llegar aquí.
import type { PrizeMedia } from "@/components/casa/PrizeShowcase";

export interface RifaBenefit {
  /** «Rifa para …»: el titular grande de la portada. */
  cause: string;
  /** Qué se compra con lo recaudado. */
  detail: string;
  /** Camiseta girando. Provisional: la de James hasta tener el diseño de cada camiseta. */
  jersey: { media: PrizeMedia; label: string } | null;
}

function jamesJersey(base = "/prizes/v3-30099c32d6c6/"): RifaBenefit["jersey"] {
  return {
    label: "Camiseta girando",
    media: {
      front: `${base}james-v2-front.png`, back: `${base}james-v2-back.png`, poster: `${base}james-v2-poster.png`,
      video: `${base}james-v2-turntable.webm`, animation: `${base}james-v2-turntable.webp`,
      turntable: { small: `${base}james-v3-atlas-192-`, large: `${base}james-v3-atlas-512-` },
    },
  };
}

const LA_IGUANA = {
  cause: "una familia damnificada en La Iguaná",
  detail: "Todo lo recaudado compra camas, colchones, cobijas y almohadas para su casa.",
} as const;

/** Rifa solidaria La Iguaná: una camiseta por rifa, de a una. */
const BENEFIT_RIFAS: Readonly<Record<string, () => RifaBenefit>> = {
  "495aa5b1-767c-47bb-8487-15223ab44f63": () => ({ ...LA_IGUANA, jersey: jamesJersey() }),
};

/** Las rifas sin ánimo de lucro van de primeras en el inicio, para todos (si son Públicas). */
export const FEATURED_RIFA_IDS: readonly string[] = Object.keys(BENEFIT_RIFAS);

export function rifaBenefit(rifaId: string): RifaBenefit | null {
  return BENEFIT_RIFAS[rifaId]?.() ?? null;
}
