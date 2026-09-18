// app/api/casa/pollas/[slug]/unirme/route.ts — entrar a una polla gratis.
//
// (2026-09-18, migración 143) POLLA REGALO no cuesta nada y aun así el flujo
// pedía transferir y subir el pantallazo: dos personas subieron el comprobante
// de una transferencia de $0. Pedido del dueño: tocar «Unirme» y quedar dentro.
//
// Acá solo se valida la sesión. Quién puede entrar, si la polla sigue abierta y
// si de verdad es gratis lo decide `casa_join_free_v1`: una polla con entrada
// falla con NOT_FREE y conserva su flujo de comprobante.

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { casaError, casaJson, requireCasaContract } from "@/lib/casa/operations";
import { getPollaBySlug, joinFreePolla } from "@/lib/casa/queries";
import { linkReferralFromCookie } from "@/lib/casa/referrals";
import { REFERRAL_COOKIE } from "@/lib/casa/referrals-shared";

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

  // Quien llegó por un enlace de invitación queda vinculado antes de entrar,
  // igual que en el flujo de pago. Mejor esfuerzo: nunca frena la inscripción.
  const referral = await linkReferralFromCookie(user.id, (await cookies()).get(REFERRAL_COOKIE)?.value);
  try {
    const entry = await joinFreePolla(polla.id, user.id);
    const response = casaJson({ ...entry, ok: true });
    if (referral.clearCookie) response.cookies.delete(REFERRAL_COOKIE);
    return response;
  } catch (error) {
    return casaError(error as { message?: string; code?: string });
  }
}
