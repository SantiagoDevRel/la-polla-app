import "server-only";
import type { PrizeMedia, PrizePhoto } from "./PrizeShowcase";

type LocalPrize = { kind: "jersey"; title: string; media: PrizeMedia; photos: readonly PrizePhoto[] }
  | { kind: "cash"; banknote: string };

/** Visual review only: these files stay on this machine, outside public/. */
export function localPrizeMedia(id: string): LocalPrize | null {
  if (process.env.CASA_LOCAL_TEST !== "1"
    || !/^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) return null;
  const base = "/__local-prize-media/";
  if (id === "e5e5719d-bdaf-407d-bf8d-b856338709a9") return {
    kind: "jersey",
    title: "Camiseta James firmada + boleta clásico (oriental o sur)",
    media: { front: `${base}james-v2-front.png`, back: `${base}james-v2-back.png`, poster: `${base}james-v2-poster.png`,
      video: `${base}james-v2-turntable.webm`, animation: `${base}james-v2-turntable.webp` },
    photos: [
      { src: `${base}james-real-front.jpg`, label: "Frente y autógrafo", alt: "Foto original del frente y el autógrafo de la camiseta" },
      { src: `${base}james-real-back.jpg`, label: "James · número 23", alt: "Foto original de la espalda de la camiseta, James número 23" },
    ],
  };
  if (id === "05f83cb8-d16d-42fd-a6b8-a0840c9b0cf9") return { kind: "cash", banknote: `${base}billete-100000.webp` };
  return null;
}
