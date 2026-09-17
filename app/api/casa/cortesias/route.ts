// app/api/casa/cortesias/route.ts — las cortesías de quien las reparte y el canje.
//
//   GET  → mis cortesías (los enlaces que puedo regalar y cuáles ya se usaron).
//   POST → activo la cortesía del enlace que abrí (el código vive en la cookie
//          lp_cortesia que puso proxy.ts; el cuerpo puede repetirlo).
//
// La regla la aplica SQL: cuenta nueva, una sola vez en la vida y solo en la
// polla de esa cortesía. Acá solo se valida la sesión y se limpia la cookie.

import { cookies } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { casaError, casaJson, requireCasaContract } from "@/lib/casa/operations";
import { listMyCourtesies, redeemCourtesy } from "@/lib/casa/courtesies";
import {
  COURTESY_COOKIE,
  courtesyErrorMessage,
  validCourtesyCode,
} from "@/lib/casa/courtesies-shared";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ code: z.string().max(40).optional() }).nullable();

async function sessionUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function GET() {
  const user = await sessionUser();
  if (!user) return casaJson({ error: "Necesitas iniciar sesión." }, 401);
  try {
    return casaJson({ cortesias: await listMyCourtesies(user.id) });
  } catch (error) {
    return casaError(error as { message?: string; code?: string });
  }
}

export async function POST(request: Request) {
  const user = await sessionUser();
  if (!user) return casaJson({ error: "Necesitas iniciar sesión." }, 401);
  const contractError = requireCasaContract(request);
  if (contractError) return contractError;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return casaJson({ error: "No pudimos leer la cortesía." }, 400);
  const jar = await cookies();
  const code = validCourtesyCode(parsed.data?.code) ?? validCourtesyCode(jar.get(COURTESY_COOKIE)?.value);
  if (!code) {
    return casaJson({ error: courtesyErrorMessage("COURTESY_NOT_FOUND"), code: "COURTESY_NOT_FOUND" }, 404);
  }

  let result;
  try {
    result = await redeemCourtesy(code, user.id);
  } catch (error) {
    return casaError(error as { message?: string; code?: string });
  }
  if (!result.ok) {
    const response = casaJson(
      { error: courtesyErrorMessage(result.error), code: result.error, slug: result.slug },
      409,
    );
    // El enlace no va a servir nunca para esta persona: se descarta para que la
    // tarjeta de «activa tu cupo» no la persiga por toda la app.
    if (result.error !== "COURTESY_EXPIRED") response.cookies.delete(COURTESY_COOKIE);
    return response;
  }
  const response = casaJson({ ok: true, slug: result.slug, polla: result.polla, entryNumber: result.entry_number });
  response.cookies.delete(COURTESY_COOKIE);
  return response;
}
