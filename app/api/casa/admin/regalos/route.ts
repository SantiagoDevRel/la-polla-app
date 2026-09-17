// app/api/casa/admin/regalos/route.ts — cupos de regalo por invitar de una polla (migración 135).
//
//   GET  ?pollaId=… → la lista para el panel (quién, qué cupo, cuántos invitados).
//   POST { entryId, accion: "remover", motivo } | { entryId, accion: "restaurar" }
//
// Punto 6 del dueño: el regalo se crea solo; «Remover cupo» es opcional, por si
// algo. SQL exige administrador, deja el motivo en el historial y no permite
// cambios después del reparto.

import { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { casaError, casaJson, requireCasaContract } from "@/lib/casa/operations";

export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("remover"), entryId: z.string().uuid(), motivo: z.string().trim().min(1).max(200) }),
  z.object({ accion: z.literal("restaurar"), entryId: z.string().uuid() }),
]);

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return casaJson({ error: "No autenticado." }, 401);
  if (!user.is_admin) return casaJson({ error: "Solo el administrador." }, 403);
  const pollaId = request.nextUrl.searchParams.get("pollaId");
  if (!z.string().uuid().safeParse(pollaId).success) return casaJson({ error: "Polla inválida." }, 400);
  const { data, error } = await createAdminClient().rpc("casa_referral_gifts_admin_v1", {
    p_polla_id: pollaId, p_actor_id: user.id,
  });
  if (error) return casaError(error);
  return casaJson({ regalos: data ?? [] });
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return casaJson({ error: "No autenticado." }, 401);
  if (!user.is_admin) return casaJson({ error: "Solo el administrador." }, 403);
  const contractError = requireCasaContract(request);
  if (contractError) return contractError;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return casaJson({ error: "Escribe el motivo para remover el cupo." }, 400);
  const body = parsed.data;
  const db = createAdminClient();
  const { data, error } = body.accion === "remover"
    ? await db.rpc("casa_referral_remove_gift_v1", {
      p_entry_id: body.entryId, p_reason: body.motivo, p_actor_id: user.id, p_contract: 2,
    })
    : await db.rpc("casa_referral_restore_gift_v1", {
      p_entry_id: body.entryId, p_actor_id: user.id, p_contract: 2,
    });
  if (error) return casaError(error);
  return casaJson({ ok: true, ...data });
}
