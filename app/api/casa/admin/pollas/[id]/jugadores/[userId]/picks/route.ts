import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { casaError, casaJson, requireCasaContract } from "@/lib/casa/operations";
import { casaPicksBodySchema } from "@/lib/casa/picks-save";
import { isPickSaveAck } from "@/lib/casa/picks-protocol";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; userId: string }> };
const identifiers = z.object({ id: z.string().uuid(), userId: z.string().uuid() });

export async function GET(request: Request, { params }: Context) {
  const actor = await getAuthenticatedUser();
  if (!actor) return casaJson({ error: "No autenticado." }, 401);
  if (!actor.is_admin) return casaJson({ error: "Sin permiso." }, 403);
  const scope = identifiers.safeParse(await params);
  if (!scope.success) return casaJson({ error: "Jugador o polla inválidos." }, 400);
  const { data, error } = await createAdminClient().rpc("casa_admin_player_pick_state", {
    p_polla_id: scope.data.id, p_user_id: scope.data.userId, p_actor_id: actor.id,
  });
  if (error) return casaError(error);
  const expected = new URL(request.url).searchParams.get("entryId");
  if (expected && data?.entryId !== expected) return casaJson({ error: "El cupo cambió. Vuelve a abrir la vista del jugador." }, 409);
  return casaJson(data);
}

export async function PUT(request: Request, { params }: Context) {
  const actor = await getAuthenticatedUser();
  if (!actor) return casaJson({ error: "No autenticado." }, 401);
  if (!actor.is_admin) return casaJson({ error: "Sin permiso." }, 403);
  const contract = requireCasaContract(request);
  if (contract) return contract;
  const scope = identifiers.safeParse(await params);
  if (!scope.success) return casaJson({ error: "Jugador o polla inválidos." }, 400);
  const parsed = casaPicksBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !parsed.data.entryId || !parsed.data.requestId || parsed.data.expectedRevision === undefined) {
    return casaJson({ error: "El envío está incompleto. Conservamos tus cambios." }, 400);
  }
  const body = parsed.data;
  const { data, error } = await createAdminClient().rpc("casa_admin_save_player_picks", {
    p_polla_id: scope.data.id, p_user_id: scope.data.userId, p_actor_id: actor.id,
    p_entry_id: body.entryId, p_request_id: body.requestId, p_expected_revision: body.expectedRevision,
    p_picks: body.picks, p_contract: 2,
  });
  if (error) {
    if (["55P03", "40P01", "57014"].includes(error.code)) return casaJson({ error: "La polla se está actualizando. Conservamos tus cambios; comprueba el guardado." }, 503);
    return casaError(error);
  }
  if (data?.ok === false && data.conflict === true) return casaJson({ ...data, error: "Hay pronósticos más recientes. Revisa tus cambios antes de guardar." }, 409);
  if (!isPickSaveAck(data) || data.requestId !== body.requestId) return casaJson({ error: "No pudimos confirmar el guardado. Conservamos tus cambios." }, 500);
  return casaJson(data);
}
