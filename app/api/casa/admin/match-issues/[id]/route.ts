// app/api/casa/admin/match-issues/[id]/route.ts — decisión del administrador
// sobre un partido suspendido, aplazado, cancelado o abandonado.
//
// Nada se anula solo: el caso queda abierto hasta que un administrador elige
// ANULAR (0 puntos para todos en las pollas Casa no finalizadas que lo
// contienen) o MANTENER. Toda la escritura vive en el RPC
// `casa_decide_match_issue`, que bloquea el caso, aplica los guards de Casa
// y rechaza una segunda decisión.

import { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { casaJson, casaError, requireCasaContract } from "@/lib/casa/operations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  decision: z.enum(["anular", "mantener"]),
  note: z.string().trim().max(300).optional(),
}).strict();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return casaJson({ error: "No autenticado." }, 401);
  if (!user.is_admin) return casaJson({ error: "Solo el administrador." }, 403);
  const contractError = requireCasaContract(req);
  if (contractError) return contractError;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return casaJson({ error: "Caso inválido." }, 400);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return casaJson({ error: "Datos inválidos." }, 400);

  const { decision, note } = parsed.data;
  const { data, error } = await createAdminClient().rpc("casa_decide_match_issue", {
    p_issue: id,
    p_decision: decision,
    p_admin: user.id,
    p_note: note ? note : null,
  });
  if (error) return casaError(error);
  return casaJson({ ok: true, ...(data ?? {}) });
}
