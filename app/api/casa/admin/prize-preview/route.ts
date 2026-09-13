import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { casaJson, casaError } from "@/lib/casa/operations";

const schema = z.object({ price: z.coerce.number().int().min(0).max(10000000), cut: z.coerce.number().int().min(0).max(100),
  tickets: z.coerce.number().int().min(2).max(1000), kind: z.enum(["pozo", "objeto"]),
  mode: z.enum(["proporcional", "fijo"]).default("proporcional"),
  fixed: z.coerce.number().int().min(1).max(1_000_000_000).optional() });
export async function GET(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return casaJson({ error: "No autenticado." }, 401);
  if (!user.is_admin) return casaJson({ error: "Sin permiso." }, 403);
  const parsed = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return casaJson({ error: "Valores de premio inválidos." }, 400);
  const { price, cut, tickets, kind, mode, fixed } = parsed.data;
  if (mode === "fijo" && (kind !== "pozo" || !fixed)) return casaJson({ error: "Elige un premio fijo mayor a cero." }, 400);
  // Fixed = guaranteed minimum (migration 109): SQL returns the prize for N entries,
  // the entries needed to cover it, and the pot/house split of each entry above it.
  const { data, error } = mode === "fijo"
    ? await createAdminClient().rpc("casa_fixed_prize_threshold_preview_v2", { p_price: price, p_cut: cut, p_fixed: fixed, p_tickets: tickets })
    : await createAdminClient().rpc("casa_prize_preview_v2", { p_price: price, p_cut: cut, p_tickets: tickets, p_object: kind === "objeto" });
  return error ? casaError(error) : casaJson(data);
}
