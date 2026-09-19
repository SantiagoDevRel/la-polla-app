// app/api/casa/pollas/[slug]/canjear/route.ts — usar un cupo gratis por invitar.
//
// (2026-09-19, migración 144) El cupo que se gana por cada 5 invitados ya no cae
// solo en una polla: queda de saldo y la persona elige dónde usarlo. Acá solo se
// valida la sesión. Si tiene saldo, si la polla participa, si sigue abierta y si
// cabe en el tope por persona lo decide `casa_referral_redeem_v1`.

import { createClient } from "@/lib/supabase/server";
import { casaError, casaJson, requireCasaContract } from "@/lib/casa/operations";
import { getPollaBySlug } from "@/lib/casa/queries";
import { redeemFreeEntry } from "@/lib/casa/referrals";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return casaJson({ error: "Necesitas iniciar sesión." }, 401);
  const contractError = requireCasaContract(request);
  if (contractError) return contractError;

  const polla = await getPollaBySlug((await params).slug);
  if (!polla || polla.status === "borrador") return casaJson({ error: "Esa polla no existe." }, 404);

  try {
    const entry = await redeemFreeEntry(polla.id, user.id);
    return casaJson({ ...entry, ok: true });
  } catch (error) {
    return casaError(error as { message?: string; code?: string; details?: string | null });
  }
}
