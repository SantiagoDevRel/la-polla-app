import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPollaBySlug, getActiveProofs } from "@/lib/casa/queries";
import { casaJson, casaError } from "@/lib/casa/operations";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return casaJson({ error: "Necesitas iniciar sesión." }, 401);
  const polla = await getPollaBySlug((await params).slug);
  if (!polla || polla.kind !== "rifa" || ["borrador", "anulada"].includes(polla.status)) return casaJson({ error: "No existe esa rifa." }, 404);
  const search = new URL(request.url).searchParams;
  const db = createAdminClient();
  if (search.get("mine") === "1") {
    const offset = Number(search.get("offset") ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) return casaJson({ error: "Página inválida." }, 400);
    const { data, error } = await db.from("casa_entries")
      .select("id, ticket_number, status, proof_path, reject_reason")
      .eq("polla_id", polla.id).eq("user_id", user.id).order("ticket_number").range(offset, offset + 20);
    if (error) return casaError(error);
    const active = await getActiveProofs(polla.id, user.id);
    return casaJson({ entries: (data ?? []).slice(0, 20).map(({ proof_path, ...entry }) => ({ ...entry, hasProof: Boolean(proof_path), canResume: active.some((proof) => proof.entry_id === entry.id) })),
      next: (data?.length ?? 0) > 20 ? offset + 20 : null });
  }
  const from = Number(search.get("from") ?? 1);
  if (!Number.isSafeInteger(from) || from < 1 || from > (polla.ticket_count ?? 0)) return casaJson({ error: "Rango inválido." }, 400);
  const { data, error } = await db.rpc("casa_ticket_availability_v2", { p_polla_id: polla.id, p_user_id: user.id, p_from: from, p_limit: 50 });
  return error ? casaError(error) : casaJson(data);
}
