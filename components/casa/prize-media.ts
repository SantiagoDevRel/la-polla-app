import "server-only";
import type { PrizeMedia, PrizePhoto } from "./PrizeShowcase";

type PollaPrize = { kind: "jersey"; title: string; media: PrizeMedia; photos: readonly PrizePhoto[] }
  | { kind: "cash"; banknote: string; back: string; poster: string; turntable: NonNullable<PrizeMedia["turntable"]> };

/** Versioned display assets; publication and access remain enforced by the caller. */
export function pollaPrizeMedia(id: string, base = "/prizes/v3-30099c32d6c6/"): PollaPrize | null {
  if (id === "e5e5719d-bdaf-407d-bf8d-b856338709a9") return {
    kind: "jersey",
    title: "Camiseta James firmada + boleta clásico (oriental o sur)",
    media: { front: `${base}james-v2-front.png`, back: `${base}james-v2-back.png`, poster: `${base}james-v2-poster.png`,
      video: `${base}james-v2-turntable.webm`, animation: `${base}james-v2-turntable.webp`,
      turntable: { small: `${base}james-v3-atlas-192-`, large: `${base}james-v3-atlas-512-` } },
    photos: [
      { src: `${base}james-real-front.jpg`, label: "Frente y autógrafo", alt: "Foto original del frente y el autógrafo de la camiseta" },
      { src: `${base}james-real-back.jpg`, label: "James · número 23", alt: "Foto original de la espalda de la camiseta, James número 23" },
    ],
  };
  if (id === "05f83cb8-d16d-42fd-a6b8-a0840c9b0cf9") return {
    kind: "cash", banknote: `${base}billete-100000-clean.webp`, back: `${base}billete-100000-back-clean.webp`,
    poster: `${base}cash-v3-front.png`,
    turntable: { small: `${base}cash-v3-atlas-192-`, large: `${base}cash-v3-atlas-512-` },
  };
  return null;
}
