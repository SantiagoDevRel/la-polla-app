// app/matches/[slug]/opengraph-image.tsx — alias EN.
// Runtime debe declararse localmente; Next no lo rastrea a través de
// re-exports.
import handler from "@/app/partidos/[slug]/opengraph-image";

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Match preview";

export default handler;
