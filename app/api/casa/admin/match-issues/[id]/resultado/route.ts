// app/api/casa/admin/match-issues/[id]/resultado/route.ts — resultado manual
// de los 90 minutos para un caso «Sin datos del proveedor» (migración 121).
//
// Toda la escritura vive en el RPC `casa_resolve_sin_datos_with_result`: bloquea
// el caso, verifica que el usuario sea administrador, cierra el partido con
// `finalize_verified_match_result` (el mismo cierre de /admin/discrepancias) y
// marca el caso resuelto en la misma transacción. Si el partido ya quedó
// verificado por otra vía responde conflicto; nunca sobrescribe.

import { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { casaJson, casaError, requireCasaContract } from "@/lib/casa/operations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const goals = z.number().int().min(0).max(99);
const schema = z.object({ home: goals, away: goals }).strict();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return casaJson({ error: "No autenticado." }, 401);
  if (!user.is_admin) return casaJson({ error: "Solo el administrador." }, 403);
  const contractError = requireCasaContract(req);
  if (contractError) return contractError;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return casaJson({ error: "Caso inválido." }, 400);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return casaJson({ error: "Escribe los goles de cada equipo: números enteros entre 0 y 99." }, 400);

  const { data, error } = await createAdminClient().rpc("casa_resolve_sin_datos_with_result", {
    p_issue: id,
    p_home: parsed.data.home,
    p_away: parsed.data.away,
    p_admin: user.id,
  });
  if (error) return casaError(error);
  return casaJson({ ok: true, ...(data ?? {}) });
}
