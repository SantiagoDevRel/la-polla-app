import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPollaBySlug } from "@/lib/casa/queries";
import { casaJson } from "@/lib/casa/operations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Same signed-in audience as the leaderboard. No contacts or payout mutations. */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const session = await createClient();
    const { data: { user }, error: authError } = await session.auth.getUser();
    if (authError || !user) return casaJson({ error: "Sin sesión." }, 401);
    const polla = await getPollaBySlug((await params).slug);
    if (!polla || polla.prize_kind !== "objeto" || polla.kind === "rifa"
      || polla.status === "anulada" || polla.status === "borrador") {
      return casaJson({ error: "Ese resultado no está disponible." }, 404);
    }
    const { data, error } = await createAdminClient().rpc("casa_object_result_v1", { p_polla_id: polla.id });
    if (error) throw error;
    if (!data) return casaJson({ error: "Ese resultado no está disponible." }, 404);
    return casaJson({ result: data });
  } catch {
    return casaJson({ error: "No se pudo actualizar el resultado." }, 500);
  }
}
