import "server-only";
import type { PrizeMedia, PrizePhoto } from "./PrizeShowcase";
import type { PrizeCrest } from "./CrestPairPrize";

type PollaPrize = { kind: "jersey"; title: string; media: PrizeMedia; photos: readonly PrizePhoto[] }
  | { kind: "cash"; banknote: string; back: string; poster: string; turntable: NonNullable<PrizeMedia["turntable"]> }
  | { kind: "crests"; crests: readonly PrizeCrest[] };

/** El millón en diez billetes de cien mil: OFIGOLAZO4 y OFIGOLAZO 5. */
const CASH_POLLAS = new Set(["05f83cb8-d16d-42fd-a6b8-a0840c9b0cf9", "6e9bea55-fdc0-4ba1-b703-9f947c2bb3c1"]);

/** La camiseta firmada de James: POLLA JAMES y POLLA JAMES 2 (gratis, sin boleta). */
const JAMES_TITLES: Readonly<Record<string, string>> = {
  "e5e5719d-bdaf-407d-bf8d-b856338709a9": "Camiseta James firmada (XL o L) + boleta clásico (oriental o sur)",
  "95c5a3f0-8131-47af-b167-cf3928db4d9b": "Camiseta Atlético Nacional firmada por James",
};

/** Versioned display assets; publication and access remain enforced by the caller. */
export function pollaPrizeMedia(id: string, base = "/prizes/v3-30099c32d6c6/"): PollaPrize | null {
  const jamesTitle = JAMES_TITLES[id];
  if (jamesTitle) return {
    kind: "jersey",
    title: jamesTitle,
    media: { front: `${base}james-v2-front.png`, back: `${base}james-v2-back.png`, poster: `${base}james-v2-poster.png`,
      video: `${base}james-v2-turntable.webm`, animation: `${base}james-v2-turntable.webp`,
      turntable: { small: `${base}james-v3-atlas-192-`, large: `${base}james-v3-atlas-512-` } },
    photos: [
      { src: `${base}james-real-front.jpg`, label: "Frente y autógrafo", alt: "Foto original del frente y el autógrafo de la camiseta" },
      { src: `${base}james-real-back.jpg`, label: "James · número 23", alt: "Foto original de la espalda de la camiseta, James número 23" },
    ],
  };
  if (CASH_POLLAS.has(id)) return {
    kind: "cash", banknote: `${base}billete-100000-clean.webp`, back: `${base}billete-100000-back-clean.webp`,
    poster: `${base}cash-v3-front.png`,
    turntable: { small: `${base}cash-v3-atlas-192-`, large: `${base}cash-v3-atlas-512-` },
  };
  // POLLA REGALO 2: boletas para el clásico. Escudos vigentes en octubre de 2026;
  // el de Medellín es el que el club estrenó en el segundo semestre (manual de marca 2026).
  if (id === "67b3f25f-f94b-4319-9081-517c206d8241") return {
    kind: "crests",
    crests: [
      { src: `${base}crest-nacional-2026-256.webp`, alt: "Escudo de Atlético Nacional", width: 177, height: 256 },
      { src: `${base}crest-medellin-2026-256.webp`, alt: "Escudo de Independiente Medellín", width: 276, height: 256 },
    ],
  };
  return null;
}
