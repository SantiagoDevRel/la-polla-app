import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { casaJson, casaError } from "@/lib/casa/operations";

const schema = z.object({ price: z.coerce.number().int().min(0).max(10000000), cut: z.coerce.number().int().min(0).max(100),
  tickets: z.coerce.number().int().min(2).max(1000), kind: z.enum(["pozo", "objeto"]) });
export async function GET(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return casaJson({ error: "No autenticado." }, 401);
  if (!user.is_admin) return casaJson({ error: "Sin permiso." }, 403);
  const parsed = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return casaJson({ error: "Valores de premio inválidos." }, 400);
  const { price, cut, tickets, kind } = parsed.data;
  const { data, error } = await createAdminClient().rpc("casa_prize_preview_v2", { p_price: price, p_cut: cut, p_tickets: tickets, p_object: kind === "objeto" });
  return error ? casaError(error) : casaJson(data);
}
