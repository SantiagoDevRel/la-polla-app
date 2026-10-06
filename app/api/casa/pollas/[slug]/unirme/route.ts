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
import { getMyEntry, getPollaBySlug, joinFreePolla } from "@/lib/casa/queries";
import { linkReferralFromCookie } from "@/lib/casa/referrals";
import { REFERRAL_COOKIE } from "@/lib/casa/referrals-shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A reconciliation read never enrolls anybody or changes a pending reservation.
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return casaJson({ error: "Necesitas iniciar sesión." }, 401);
  try {
    const slug = (await params).slug;
    const polla = await getPollaBySlug(slug);
    if (!polla || polla.status === "borrador") return casaJson({ error: "Esa polla no existe." }, 404);
    const entry = await getMyEntry(polla.id, user.id);
    const joined = entry?.status === "pagada";
    return casaJson({ ok: true, owner_id: user.id, slug, joined, entry: joined ? {
      entry_id: entry.id, entry_number: entry.entry_number, status: entry.status,
    } : null });
  } catch (error) {
    return casaError(error as { message?: string; code?: string });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return casaJson({ error: "Necesitas iniciar sesión." }, 401);
  const expectedOwner = request.headers.get("X-Casa-Owner");
  if (expectedOwner && expectedOwner !== user.id) return casaJson({ code: "ACCOUNT_CHANGED", error: "Tu cuenta cambió. Revisa tu perfil e ingresa con la cuenta original." }, 412);
  const contractError = requireCasaContract(request);
  if (contractError) return contractError;

  const polla = await getPollaBySlug((await params).slug);
  if (!polla || polla.status === "borrador") return casaJson({ error: "Esa polla no existe." }, 404);

  // Quien llegó por un enlace de invitación queda vinculado antes de entrar,
  // igual que en el flujo de pago. Mejor esfuerzo: nunca frena la inscripción.
  const referral = await linkReferralFromCookie(user.id, (await cookies()).get(REFERRAL_COOKIE)?.value);
  try {
    const entry = await joinFreePolla(polla.id, user.id);
    if (!entry?.ok || !entry.entry_id || entry.slug !== polla.slug) {
      return casaJson({ error: "No pudimos confirmar tu inscripción. Intenta de nuevo." }, 503);
    }
    const response = casaJson({ ...entry, owner_id: user.id });
    if (referral.clearCookie) response.cookies.delete(REFERRAL_COOKIE);
    return response;
  } catch (error) {
    return casaError(error as { message?: string; code?: string });
  }
}
