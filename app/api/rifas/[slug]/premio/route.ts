// app/api/rifas/[slug]/premio/route.ts — foto opcional del premio.
//
// GET: quien puede ver la rifa (SQL: rifa_public_view_v1) recibe una URL
// firmada de 5 minutos del bucket privado rifa-media. Una rifa Privada no
// expone su foto a nadie más.
// POST: el creador sube la foto ya comprimida en el navegador
// (PRIZE_IMAGE_PREPARE_OPTIONS, < 4 MB). Se verifica la firma de los bytes.
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { matchesImageSignature } from "@/lib/casa/payout-proofs";
import { rifaError, rifaJson, RIFA_DISABLED, RIFA_UNAUTHORIZED } from "@/lib/rifas/errors";
import { getPublicView, getRifaViewer, RIFA_MEDIA_BUCKET, rifaRpc, rifasEnabled, signedRifaFile, validSlug } from "@/lib/rifas/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
type ImageType = (typeof TYPES)[number];
const MAX_BYTES = 4 * 1024 * 1024;

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!rifasEnabled()) return RIFA_DISABLED();
  const { slug } = await params;
  if (!validSlug(slug)) return rifaJson({ error: "No encontrado." }, 404);
  const viewer = await getRifaViewer();
  const { data: view, error } = await getPublicView(slug, viewer?.id ?? null);
  if (error || !view) return rifaError(error ?? {});
  const { data } = await createAdminClient().from("rifas").select("prize_image_path").eq("id", view.id).maybeSingle();
  if (!data?.prize_image_path) return rifaJson({ error: "Sin foto." }, 404);
  const url = await signedRifaFile(RIFA_MEDIA_BUCKET, data.prize_image_path);
  if (!url) return rifaJson({ error: "No se pudo abrir la foto." }, 503);
  return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!rifasEnabled()) return RIFA_DISABLED();
  const viewer = await getRifaViewer();
  if (!viewer) return RIFA_UNAUTHORIZED();
  const { slug } = await params;
  if (!validSlug(slug)) return rifaJson({ error: "No encontrado." }, 404);
  const db = createAdminClient();
  const { data: rifa } = await db.from("rifas").select("id, creator_id, prize_image_path").eq("slug", slug).maybeSingle();
  if (!rifa || rifa.creator_id !== viewer.id) return rifaJson({ error: "Solo quien creó la rifa puede hacer esto." }, 403);

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob) || file.size < 1 || file.size > MAX_BYTES || !TYPES.includes(file.type as ImageType)) {
    return rifaJson({ error: "Usa una imagen JPG, PNG o WEBP de hasta 4 MB." }, 400);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!matchesImageSignature(bytes.subarray(0, 16), file.type as ImageType)) {
    return rifaJson({ error: "El archivo no es una imagen válida." }, 400);
  }
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `rifas/${rifa.id}/premio-${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await db.storage.from(RIFA_MEDIA_BUCKET).upload(path, bytes, { contentType: file.type, upsert: false });
  if (upErr) return rifaJson({ error: "No se pudo guardar la foto. Intenta de nuevo." }, 503);
  const { error } = await rifaRpc("rifa_set_prize_image_v1", { p_actor: viewer.id, p_rifa: rifa.id, p_path: path });
  if (error) {
    await db.storage.from(RIFA_MEDIA_BUCKET).remove([path]).catch(() => {});
    return rifaError(error);
  }
  if (rifa.prize_image_path) await db.storage.from(RIFA_MEDIA_BUCKET).remove([rifa.prize_image_path]).catch(() => {});
  return rifaJson({ ok: true });
}
