// app/api/rifas/[slug]/historia/route.tsx — imagen para compartir (PNG): historia
// 1080×1920, o el tablero de Los Del Sur en cuadrada 1080×1350 o vertical
// (?formato=cuadrada|vertical, por defecto cuadrada).
//
// Solo el creador (SQL: rifa_story_data_v1 → CREATOR_ONLY). Lleva nombre,
// premio, el tablero con los números tomados marcados, fecha, lotería, valor y
// el enlace para comprar. NUNCA nombres ni celulares: SQL solo entrega los
// números tomados.
// Registro: lib/rifas/story-templates (12 diseños, respaldo neutra).
// Solo usesClub carga pollito del catálogo, sin escudos oficiales.
// Las rifas de Los Del Sur (lib/rifas/partner.ts) usan SOLO sus 7 plantillas (el tablero primero):
// escudo, trapo y fotos de la barra + un pollito barrista (assets/rifas-story/lds).
// Fuentes de la marca (Bebas Neue + Outfit 600, y 700 para los resaltados del tablero) en assets/fonts, OFL.
// Runtime Node: lee fuentes y pollitos del disco (sin fetch a sí mismo). Los
// pollitos van como PNG en assets/rifas-story porque satori no decodifica WebP.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { rifaError, rifaJson, RIFA_DISABLED, RIFA_UNAUTHORIZED } from "@/lib/rifas/errors";
import { getRifaViewer, rifaRpc, rifasEnabled, validSlug } from "@/lib/rifas/server";
import { storyClub } from "@/lib/rifas/shared";
import { rifaPartnerBySlug } from "@/lib/rifas/partner";
import { rifaStoryArt } from "@/lib/rifas/benefit";
import { LDS_STORY_TEMPLATE_LIST, getStoryTemplate, renderStory, storyFormat, storyHasFormats, storySize, type StoryData, type StoryPartnerArt } from "@/lib/rifas/story-templates";

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
  const partner = rifaPartnerBySlug(r.slug);
  const template = getStoryTemplate(templateParam, partner?.key ?? null);
  const lds = LDS_STORY_TEMPLATE_LIST.find((t) => t.key === template.key) ?? null;
  const format = storyFormat(template.key, url.searchParams.get("formato"));
  const size = storySize(template.key, format);
  // El tablero tiene una foto recortada para cada formato (scripts/bake-rifa-lds-fondos.py).
  const background = lds?.background ? (storyHasFormats(template.key) ? `${lds.background}-${format}` : lds.background) : null;
  const club = storyClub(url.searchParams.get("club"));
  const appHost = (process.env.NEXT_PUBLIC_APP_URL ?? "https://lapollacolombiana.com").replace(/^https?:\/\//, "").replace(/\/$/, "");

  const art = rifaStoryArt(r.slug);
  // El tablero muestra la camiseta grande: va la versión en alta.
  const prizePath = art ? (storyHasFormats(template.key) ? art.prizeLarge : art.prize) : null;
  const [bebas, outfit, outfitBold, logo, pollito, partnerArt, prizeImage] = await Promise.all([
    readFile(join(process.cwd(), "assets/fonts/BebasNeue-latin.ttf")),
    readFile(join(process.cwd(), "assets/fonts/Outfit-SemiBold-latin.ttf")),
    storyHasFormats(template.key) ? readFile(join(process.cwd(), "assets/fonts/Outfit-Bold-latin.ttf")) : Promise.resolve(null),
    // PNG horneados (scripts/bake-rifa-story-assets.py): satori no decodifica WebP.
    asset("assets/rifas-story/logo.png", "image/png"),
    lds ? asset(`assets/rifas-story/lds/pollito-${lds.pollito}.png`, "image/png")
      : template.usesClub ? asset(`assets/rifas-story/pollito_${club.key}.png`, "image/png") : Promise.resolve(null),
    // Arte de la barra: escudo y trapo (scripts/bake-rifa-lds-assets.py) y la
    // foto real de fondo (scripts/bake-rifa-lds-fondos.py).
    lds ? Promise.all([
      asset("assets/rifas-story/lds/escudo.png", "image/png"),
      asset("assets/rifas-story/lds/trapo.png", "image/png"),
      background ? asset(`assets/rifas-story/lds/fondo-${background}.jpg`, "image/jpeg") : Promise.resolve(null),
    ]).then(([escudo, trapo, background]): StoryPartnerArt => ({ escudo, trapo, background })) : Promise.resolve(null),
    // El premio de frente al lado del texto (lib/rifas/benefit.ts), solo en las rifas que lo tienen.
    prizePath ? asset(prizePath, "image/png") : Promise.resolve(null),
  ]);

  const props = { r, club, appHost, logo, pollito, partner: partnerArt, prizeImage, format, headline: art?.headline ?? null };
  return new ImageResponse(renderStory(template.key, props), {
    width: size.width, height: size.height,
    fonts: [
      { name: "Bebas", data: bebas, weight: 400, style: "normal" },
      { name: "Outfit", data: outfit, weight: 600, style: "normal" },
      ...(outfitBold ? [{ name: "Outfit", data: outfitBold, weight: 700 as const, style: "normal" as const }] : []),
    ],
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `inline; filename="rifa-${r.slug}${storyHasFormats(template.key) ? `-${format}` : ""}.png"`,
    },
  });
}
