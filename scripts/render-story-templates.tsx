// npx tsx scripts/render-story-templates.tsx — offline, synthetic data only.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { STORY_TEMPLATE_LIST, STORY_W, STORY_H, renderStory, type StoryData } from "../lib/rifas/story-templates";
import { STORY_CLUBS } from "../lib/rifas/shared";

async function main() {
  const root = process.cwd();
  const out = join(root, "tmp/story-templates");
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
  const requested = process.argv.slice(2);
  for (const key of requested) {
    if (!STORY_TEMPLATE_LIST.some((template) => template.key === key)) throw new Error(`Plantilla desconocida: ${key}`);
  }
  const templates = requested.length ? STORY_TEMPLATE_LIST.filter((template) => requested.includes(template.key)) : STORY_TEMPLATE_LIST;
  let count = 0;
  for (const template of templates) {
    for (const [i, n] of [10, 25, 50, 100].entries()) {
      // Dark, light and two-color shirts, including white/black Once Caldas.
      const club = STORY_CLUBS[[0, 8, 1, 2][i]];
      const pollito = template.usesClub
        ? `data:image/png;base64,${(await readFile(join(root, `assets/rifas-story/pollito_${club.key}.png`))).toString("base64")}`
        : null;
      const r: StoryData = {
        slug: "abcd2345", name: n === 25 ? "Gran rifa de nuestra comunidad para celebrar juntos un premio extraordinario" : "La suerte está en tu número",
        prize_kind: n === 25 || n === 100 ? "texto" : "dinero", prize_cop: 2_000_000,
        prize_text: "Un viaje para dos personas a Cartagena con vuelos, alojamiento por tres noches y desayuno incluido",
        number_count: n, price_cop: 20_000, lottery_name: "LOTERÍA DE CUNDINAMARCA", draw_at: "2026-10-04T03:30:00.000Z",
        status: n === 100 ? "resuelta" : "abierta", winning_number: n === 100 ? 7 : null,
        taken: Array.from({ length: n }, (_, index) => index).filter((index) => index % 7 === 0 || index % 11 === 3),
      };
      const response = new ImageResponse(renderStory(template.key, { r, club, logo, pollito, appHost: "lapollacolombiana.com" }), {
        width: STORY_W, height: STORY_H, fonts,
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
          bytes.readUInt32BE(16) !== STORY_W || bytes.readUInt32BE(20) !== STORY_H) {
        throw new Error(`${template.key}-${n}: no es un PNG 1080×1920`);
      }
      await writeFile(join(out, `${template.key}-${n}.png`), bytes);
      count++;
      console.log(`${template.key}-${n}.png (${bytes.length} bytes)`);
    }
  }
  console.log(`${count} PNGs verificados en ${out}`);
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
