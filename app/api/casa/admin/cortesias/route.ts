// app/api/casa/admin/cortesias/route.ts — cortesías del panel (migración 136).
//
//   GET  ?pollaId=… | ?holderId=…  → la lista (quién, qué polla, si ya se usó).
//   POST { accion:"dar", pollaId, userId, cantidad }   → crea N enlaces únicos.
//   POST { accion:"retirar", cortesiaId }              → quita una sin usar.
//
// Solo administradores, en las dos capas: acá y en SQL (casa_v2_admin). Una
// cortesía ya redimida es la inscripción de alguien y no se puede retirar.

import { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { casaError, casaJson, requireCasaContract } from "@/lib/casa/operations";
import { CASA_CONTRACT } from "@/lib/casa/contract";
import { listCourtesiesAdmin } from "@/lib/casa/courtesies";

export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("accion", [
  z.object({
    accion: z.literal("dar"),
    pollaId: z.string().uuid(),
    userId: z.string().uuid(),
    cantidad: z.number().int().min(1).max(20),
  }),
  z.object({ accion: z.literal("retirar"), cortesiaId: z.string().uuid() }),
]);

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return casaJson({ error: "No autenticado." }, 401);
  if (!user.is_admin) return casaJson({ error: "Solo el administrador." }, 403);
  const pollaId = request.nextUrl.searchParams.get("pollaId");
  const holderId = request.nextUrl.searchParams.get("holderId");
  for (const value of [pollaId, holderId]) {
    if (value !== null && !z.string().uuid().safeParse(value).success) {
      return casaJson({ error: "Filtro inválido." }, 400);
    }
  }
  try {
    return casaJson({ cortesias: await listCourtesiesAdmin(user.id, { pollaId, holderId }) });
  } catch (error) {
    return casaError(error as { message?: string; code?: string });
  }
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return casaJson({ error: "No autenticado." }, 401);
  if (!user.is_admin) return casaJson({ error: "Solo el administrador." }, 403);
  const contractError = requireCasaContract(request);
  if (contractError) return contractError;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return casaJson({ error: "Elige la polla, la persona y cuántas cortesías (1 a 20)." }, 400);
  }
  const body = parsed.data;
  const db = createAdminClient();
  const { data, error } = body.accion === "dar"
    ? await db.rpc("casa_grant_courtesies_v1", {
      p_polla_id: body.pollaId, p_user_id: body.userId, p_count: body.cantidad,
      p_actor_id: user.id, p_contract: CASA_CONTRACT,
    })
    : await db.rpc("casa_revoke_courtesy_v1", {
      p_courtesy_id: body.cortesiaId, p_actor_id: user.id, p_contract: CASA_CONTRACT,
    });
  if (error) return casaError(error);
  return casaJson({ ok: true, ...data });
}
