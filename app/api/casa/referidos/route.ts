// app/api/casa/referidos/route.ts — invitaciones de la persona en sesión (migración 135).
//
//   GET  → su código, cuántos invitó, quién la invitó y a quién apunta el
//          enlace que abrió (cookie lp_ref), si todavía puede elegir.
//   POST → { accion: "vincular", codigo } escribe quién la invitó (código
//          escrito o confirmado); { accion: "descartar" } olvida el enlace.
//
// La sesión se valida antes de tocar la base y todo va por las funciones SQL,
// que vuelven a exigir persona nueva, invitador único y el tope de intentos.

import { cookies } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { casaError, casaJson, requireCasaContract } from "@/lib/casa/operations";
import { getReferralInvitee, getReferralProfile, setReferrer } from "@/lib/casa/referrals";
import {
  REFERRAL_COOKIE,
  normalizeReferralCode,
  referralErrorMessage,
  validReferralCode,
} from "@/lib/casa/referrals-shared";

export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("vincular"), codigo: z.string().trim().min(1).max(40) }),
  z.object({ accion: z.literal("descartar") }),
]);

async function sessionUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function GET() {
  const user = await sessionUser();
  if (!user) return casaJson({ error: "Necesitas iniciar sesión." }, 401);
  const hint = validReferralCode((await cookies()).get(REFERRAL_COOKIE)?.value);
  const [profile, invitee] = await Promise.all([getReferralProfile(user.id), getReferralInvitee(user.id, hint)]);
  if (!profile || !invitee) return casaJson({ error: "No pudimos cargar tus invitaciones." }, 500);
  return casaJson({ profile, invitee });
}

export async function POST(request: Request) {
  const user = await sessionUser();
  if (!user) return casaJson({ error: "Necesitas iniciar sesión." }, 401);
  const contractError = requireCasaContract(request);
  if (contractError) return contractError;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return casaJson({ error: "Escribe el código de la persona que te invitó." }, 400);

  if (parsed.data.accion === "descartar") {
    const response = casaJson({ ok: true });
    response.cookies.delete(REFERRAL_COOKIE);
    return response;
  }

  const code = normalizeReferralCode(parsed.data.codigo);
  if (!code) return casaJson({ error: referralErrorMessage("REFERRAL_CODE_NOT_FOUND"), code: "REFERRAL_CODE_NOT_FOUND" }, 400);
  try {
    const result = await setReferrer(user.id, code, "codigo");
    if (!result.ok) {
      return casaJson({ error: referralErrorMessage(result.error), code: result.error, referrer: result.referrer ?? null }, 409);
    }
    const response = casaJson({ ok: true, changed: result.changed, referrer: result.referrer });
    // Ya quedó elegido: el enlace abierto no tiene nada más que ofrecer.
    response.cookies.delete(REFERRAL_COOKIE);
    return response;
  } catch (error) {
    return casaError(error as { message?: string; code?: string });
  }
}
