// app/api/casa/cortesias/aceptar/route.ts — acepto las cortesías que me dio la casa.
//
//   POST { pollaId } → un cupo gratis por cada cortesía sin aceptar en esa polla
//                      (migración 173).
//
// La regla la aplica SQL: solo las cortesías de quien llama, solo con la polla
// abierta, y un doble toque no crea cupos de más. Acá solo se valida la sesión.

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { casaError, casaJson, requireCasaContract } from "@/lib/casa/operations";
import { acceptCourtesies } from "@/lib/casa/courtesies";
import { courtesyAcceptErrorMessage } from "@/lib/casa/courtesies-shared";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ pollaId: z.string().uuid() });

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return casaJson({ error: "Necesitas iniciar sesión." }, 401);
  const contractError = requireCasaContract(request);
  if (contractError) return contractError;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return casaJson({ error: "No pudimos leer la cortesía." }, 400);

  let result;
  try {
    result = await acceptCourtesies(parsed.data.pollaId, user.id);
  } catch (error) {
    return casaError(error as { message?: string; code?: string });
  }
  if (!result.ok) {
    return casaJson({ error: courtesyAcceptErrorMessage(result.error), code: result.error, slug: result.slug }, 409);
  }
  return casaJson({ ok: true, slug: result.slug, accepted: result.accepted, entryNumber: result.entry_number });
}
