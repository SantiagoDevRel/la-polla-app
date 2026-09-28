// app/api/rifas/[slug]/historia/route.tsx — imagen para historia (1080×1920, PNG).
//
// Solo el creador (SQL: rifa_story_data_v1 → CREATOR_ONLY). Lleva nombre,
// premio, el tablero con los números tomados marcados, fecha, lotería, valor y
// el enlace para comprar. NUNCA nombres ni celulares: SQL solo entrega los
// números tomados.
// Plantillas (siempre con la marca La Polla):
//   neutra → fondo oscuro de la marca, logo del pollito.
//   club   → colores de camiseta y pollito del catálogo (docs/pollito-clubes.md).
//            Sin escudos oficiales: solo colores y pollito.
// Fuentes de la marca (Bebas Neue + Outfit 600) en assets/fonts, OFL.
// Runtime Node: lee fuentes y pollitos del disco (sin fetch a sí mismo). Los
// pollitos van como PNG en assets/rifas-story porque satori no decodifica WebP.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { rifaError, rifaJson, RIFA_DISABLED, RIFA_UNAUTHORIZED } from "@/lib/rifas/errors";
import { getRifaViewer, rifaRpc, rifasEnabled, validSlug } from "@/lib/rifas/server";
import { storyClub, STORY_TEMPLATES, type StoryTemplate } from "@/lib/rifas/shared";
import { STORY_H, STORY_W, storyElement, type StoryData } from "@/lib/rifas/story";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function asset(path: string, mime: string) {
  const data = await readFile(join(process.cwd(), path));
  return `data:${mime};base64,${data.toString("base64")}`;
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!rifasEnabled()) return RIFA_DISABLED();
  const viewer = await getRifaViewer();
  if (!viewer) return RIFA_UNAUTHORIZED();
  const { slug } = await params;
  if (!validSlug(slug)) return rifaJson({ error: "No encontrado." }, 404);
  const { data: r, error } = await rifaRpc<StoryData>("rifa_story_data_v1", { p_actor: viewer.id, p_slug: slug });
  if (error || !r) return rifaError(error ?? {});

  const url = new URL(request.url);
  const templateParam = url.searchParams.get("plantilla");
  const template: StoryTemplate = (STORY_TEMPLATES as readonly string[]).includes(templateParam ?? "") ? (templateParam as StoryTemplate) : "neutra";
  const club = storyClub(url.searchParams.get("club"));
  const appHost = (process.env.NEXT_PUBLIC_APP_URL ?? "https://lapollacolombiana.com").replace(/^https?:\/\//, "").replace(/\/$/, "");

  const [bebas, outfit, logo, pollito] = await Promise.all([
    readFile(join(process.cwd(), "assets/fonts/BebasNeue-latin.ttf")),
    readFile(join(process.cwd(), "assets/fonts/Outfit-SemiBold-latin.ttf")),
    // PNG horneados (scripts/bake-rifa-story-assets.py): satori no decodifica WebP.
    asset("assets/rifas-story/logo.png", "image/png"),
    template === "club" ? asset(`assets/rifas-story/pollito_${club.key}.png`, "image/png") : Promise.resolve(null),
  ]);

  return new ImageResponse(storyElement({ r, template, club, appHost, logo, pollito }), {
    width: STORY_W, height: STORY_H,
    fonts: [
      { name: "Bebas", data: bebas, weight: 400, style: "normal" },
      { name: "Outfit", data: outfit, weight: 600, style: "normal" },
    ],
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `inline; filename="rifa-${r.slug}.png"`,
    },
  });
}
