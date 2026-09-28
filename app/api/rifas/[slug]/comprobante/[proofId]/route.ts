// app/api/rifas/[slug]/comprobante/[proofId]/route.ts — ver un comprobante.
//
// Bucket privado + URL firmada de 5 minutos, solo para el creador de la rifa y
// para el dueño del comprobante (y los coadministradores de la rifa, 158). Un administrador de La Polla NO lo ve: puede
// traer datos bancarios de otra persona (Ley 1581).
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rifaJson, RIFA_DISABLED, RIFA_UNAUTHORIZED } from "@/lib/rifas/errors";
import { getRifaViewer, isRifaManager, RIFA_PROOF_BUCKET, rifasEnabled, signedRifaFile, validSlug } from "@/lib/rifas/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; proofId: string }> }) {
  if (!rifasEnabled()) return RIFA_DISABLED();
  const viewer = await getRifaViewer();
  if (!viewer) return RIFA_UNAUTHORIZED();
  const { slug, proofId } = await params;
  if (!validSlug(slug) || !/^[0-9a-f-]{36}$/.test(proofId)) return rifaJson({ error: "No encontrado." }, 404);
  const db = createAdminClient();
  const { data: rifa } = await db.from("rifas").select("id, creator_id").eq("slug", slug).maybeSingle();
  if (!rifa) return rifaJson({ error: "No encontrado." }, 404);
  const { data: proof } = await db.from("rifa_proofs").select("path, buyer_id, state")
    .eq("id", proofId).eq("rifa_id", rifa.id).maybeSingle();
  if (!proof || proof.state === "subiendo") return rifaJson({ error: "No encontrado." }, 404);
  if (viewer.id !== proof.buyer_id && !(await isRifaManager(rifa.id, viewer.id))) return rifaJson({ error: "No encontrado." }, 404);
  const url = await signedRifaFile(RIFA_PROOF_BUCKET, proof.path);
  if (!url) return rifaJson({ error: "No se pudo abrir el comprobante." }, 503);
  return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "private, no-store" } });
}
