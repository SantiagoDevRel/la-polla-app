// npx tsx scripts/bake-rifa-story-thumbnails.tsx — miniaturas del selector de diseño.
//
// Renderiza cada plantilla con una rifa de ejemplo (50 números, algunos tomados)
// y la guarda como WebP de 216×384 en public/plantillas-rifa/<clave>.webp. Son
// archivos estáticos: el panel las muestra al instante, sin pedirle al servidor
// un render por plantilla. Volver a correrlo cuando cambie una plantilla.
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { STORY_TEMPLATE_LIST, STORY_W, STORY_H, renderStory, type StoryData } from "../lib/rifas/story-templates";
import { STORY_CLUBS } from "../lib/rifas/shared";

// sharp viene con Next (dependencia de next/image); no se agrega al package.json.
type Sharp = (input: Buffer) => { resize(w: number, h: number): { webp(o: { quality: number }): { toFile(path: string): Promise<unknown> } } };
const sharp = createRequire(join(process.cwd(), "node_modules/next/package.json"))("sharp") as Sharp;

export const THUMB_W = 216;
export const THUMB_H = 384;

async function main() {
  const root = process.cwd();
  const out = join(root, "public/plantillas-rifa");
  await mkdir(out, { recursive: true });
  const [bebas, outfit, logoBytes] = await Promise.all([
    readFile(join(root, "assets/fonts/BebasNeue-latin.ttf")),
    readFile(join(root, "assets/fonts/Outfit-SemiBold-latin.ttf")),
    readFile(join(root, "assets/rifas-story/logo.png")),
  ]);
  const fonts = [
    { name: "Bebas", data: bebas, weight: 400 as const, style: "normal" as const },
    { name: "Outfit", data: outfit, weight: 600 as const, style: "normal" as const },
  ];
  const logo = `data:image/png;base64,${logoBytes.toString("base64")}`;
  const club = STORY_CLUBS[0];
  const r: StoryData = {
    slug: "boleta-sur", name: "Boleta Sur para el clásico", prize_kind: "texto", prize_cop: null,
    prize_text: "Boleta Sur para el clásico", number_count: 50, price_cop: 6_000, lottery_name: "Astro Sol",
    draw_at: "2026-10-14T02:00:00.000Z", status: "abierta", winning_number: null,
    taken: [2, 7, 13, 14, 21, 25, 31, 38, 44, 47],
  };
  for (const template of STORY_TEMPLATE_LIST) {
    const pollito = template.usesClub
      ? `data:image/png;base64,${(await readFile(join(root, `assets/rifas-story/pollito_${club.key}.png`))).toString("base64")}`
      : null;
    const png = Buffer.from(await new ImageResponse(renderStory(template.key, { r, club, logo, pollito, appHost: "lapollacolombiana.com" }),
      { width: STORY_W, height: STORY_H, fonts }).arrayBuffer());
    const file = join(out, `${template.key}.webp`);
    await sharp(png).resize(THUMB_W, THUMB_H).webp({ quality: 80 }).toFile(file);
    console.log(file);
  }
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
