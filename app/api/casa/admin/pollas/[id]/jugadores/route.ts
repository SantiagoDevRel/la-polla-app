import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { casaError, casaJson, requireCasaContract } from "@/lib/casa/operations";

export const dynamic = "force-dynamic";

const SelectionSchema = z.object({
  userId: z.string().uuid(),
  selected: z.boolean(),
  revision: z.number().int().min(0).max(2147483646),
}).strict();

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return casaJson({ error: "No autenticado." }, 401);
  if (!user.is_admin) return casaJson({ error: "Sin permiso." }, 403);
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return casaJson({ error: "Polla inválida." }, 400);

  const result = await createAdminClient().rpc("casa_get_admin_players", {
    p_polla_id: id, p_actor_id: user.id,
  });
  if (result.error) return casaError(result.error);
  return casaJson(result.data);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return casaJson({ error: "No autenticado." }, 401);
  if (!user.is_admin) return casaJson({ error: "Sin permiso." }, 403);
  const contractError = requireCasaContract(request);
  if (contractError) return contractError;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return casaJson({ error: "Polla inválida." }, 400);
  const parsed = SelectionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return casaJson({ error: "Selección inválida." }, 400);

  const result = await createAdminClient().rpc("casa_set_admin_player", {
    p_polla_id: id,
    p_user_id: parsed.data.userId,
    p_selected: parsed.data.selected,
    p_revision: parsed.data.revision,
    p_actor_id: user.id,
    p_contract: 2,
  });
  if (result.error) return casaError(result.error);
  return casaJson(result.data);
}
