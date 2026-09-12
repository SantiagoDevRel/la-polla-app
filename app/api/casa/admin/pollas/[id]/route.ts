import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { casaJson, casaError, requireCasaContract } from "@/lib/casa/operations";

export const dynamic = "force-dynamic";

const BodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.enum(["publicar", "cerrar", "repartir", "anular", "eliminar"]),
  }),
  // Resolver una pregunta de una polla manual. Mismo efecto que /resolver del
  // bot: escribe la respuesta correcta y repuntúa al toque.
  z.object({
    action: z.literal("responder"),
    questionId: z.string().uuid(),
    optionId: z.string().uuid().optional(),
    texto: z.string().trim().min(1).max(120).optional(),
  }).refine((b) => Boolean(b.optionId) !== Boolean(b.texto), {
    message: "Manda la opción elegida o el texto de la respuesta, no ambos.",
  }),
  // El número que salió en una rifa. Equivale a /numero del bot.
  z.object({
    action: z.literal("numero"),
    numero: z.number().int().min(1).max(100000),
  }),
]);

/** GET — lo que el panel necesita para resolver: preguntas y número sorteado. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  if (!user.is_admin) return NextResponse.json({ error: "Sin permiso." }, { status: 403 });

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Polla inválida." }, { status: 400 });
  }

  const db = createAdminClient();
  const { data: polla, error } = await db
    .from("casa_pollas")
    .select("id, kind, status, ticket_count, drawn_number, draw_method")
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "No se pudo leer la polla." }, { status: 500 });
  if (!polla) return NextResponse.json({ error: "No existe esa polla." }, { status: 404 });

  const { data: preguntas, error: qError } = await db
    .from("casa_questions")
    .select("id, prompt, points, input_kind, resolved_option_id, resolved_text, resolved_at, order_index")
    .eq("polla_id", id)
    .order("order_index", { ascending: true });

  if (qError) return casaError(qError);
  const ids = (preguntas ?? []).map((q: { id: string }) => q.id);
  const { data: opciones, error: oError } = ids.length
    ? await db.from("casa_options").select("id, question_id, label, order_index").in("question_id", ids).order("order_index", { ascending: true })
    : { data: [], error: null };
  if (oError) return casaError(oError);

  return NextResponse.json(
    {
      polla,
      preguntas: (preguntas ?? []).map((q: { id: string }) => ({
        ...q,
        options: (opciones ?? []).filter((o: { question_id: string }) => o.question_id === q.id),
      })),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return casaJson({ error: "No autenticado." }, 401);
  if (!user.is_admin) return casaJson({ error: "Sin permiso." }, 403);
  const contractError = requireCasaContract(request);
  if (contractError) return contractError;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return casaJson({ error: "Polla inválida." }, 400);
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return casaJson({ error: "Acción inválida." }, 400);
  const body = parsed.data;
  const db = createAdminClient();
  const args = { p_polla_id: id, p_contract: 2, p_actor_id: user.id };
  const result = body.action === "repartir"
    ? await db.rpc("casa_settle_polla_v2", args)
    : body.action === "eliminar"
      ? await db.rpc("casa_archive_polla_v2", args)
      : body.action === "responder"
        ? await db.rpc("casa_resolve_question_v2", { ...args, p_question_id: body.questionId, p_option_id: body.optionId ?? null, p_text: body.texto ?? null })
        : body.action === "numero"
          ? await db.rpc("casa_set_drawn_number_v2", { ...args, p_number: body.numero })
          : await db.rpc("casa_change_status_v2", { ...args, p_action: body.action });
  if (result.error) return casaError(result.error);
  return casaJson({ ok: true, ...(body.action === "repartir" ? { reparto: result.data } : result.data) });
}
