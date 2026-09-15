import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { casaJson, casaError, requireCasaContract } from "@/lib/casa/operations";
import { MAX_POLLA_MATCHES, editorErrorMessage } from "@/lib/casa/editor";

export const dynamic = "force-dynamic";

// Solo las claves que cambian; los límites finos y las reglas por estado
// (inscripciones, cierre, publicación) los valida SQL.
const nullableText = (max: number) => z.string().trim().max(max).nullable();
const EditChangesSchema = z.object({
  name: z.string().trim().min(3).max(80).optional(),
  description: nullableText(400).optional(),
  scoringMode: z.enum(["1x2", "marcador"]).optional(),
  entryPriceCop: z.number().int().min(0).max(10_000_000).optional(),
  houseCutPct: z.number().int().min(0).max(100).optional(),
  potMode: z.enum(["proporcional", "fijo"]).optional(),
  fixedPrizeCop: z.number().int().min(1).max(1_000_000_000).optional(),
  prizeObject: z.string().trim().min(3).max(160).optional(),
  payoutMethod: nullableText(40).optional(),
  payoutAccount: nullableText(60).optional(),
  payoutAccountName: nullableText(80).optional(),
  // Migración 131. No lo valida casa_edit_polla_v2: va a casa_set_max_entries_v2.
  maxEntriesPerUser: z.number().int().min(1).max(50).optional(),
}).strict().refine((changes) => Object.keys(changes).length > 0, { message: "No hay cambios para guardar." });

const BodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("publicacion"),
    mode: z.enum(["ahora", "programada", "oculta"]),
    opensAt: z.string().datetime().optional(),
  }),
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
  // Editor administrativo (2026-09-14, migración 122). Las tres acciones van
  // a casa_edit_polla_v2, que decide si la polla todavía se puede editar.
  z.object({
    action: z.literal("editar"),
    changes: EditChangesSchema,
  }),
  z.object({
    action: z.literal("agregar_partidos"),
    matchIds: z.array(z.string().uuid()).min(1).max(MAX_POLLA_MATCHES),
  }),
  z.object({
    action: z.literal("quitar_partido"),
    matchId: z.string().uuid(),
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
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return casaJson({ error: issue?.message === "No hay cambios para guardar." ? issue.message : "Acción inválida." }, 400);
  }
  const body = parsed.data;
  const db = createAdminClient();

  // (2026-09-13, migración 118) Publicar ya no exige horarios confirmados: el
  // cierre automático sigue al calendario en SQL cada vez que un partido se
  // confirma o se reprograma, así que no queda un cierre viejo al publicar.
  const args = { p_polla_id: id, p_contract: 2, p_actor_id: user.id };
  if (body.action === "editar" || body.action === "agregar_partidos" || body.action === "quitar_partido") {
    // El tope de participaciones se puede cambiar aunque ya haya inscripciones:
    // no toca dinero ni participaciones existentes, solo las nuevas.
    const { maxEntriesPerUser, ...changes } = body.action === "editar" ? body.changes : {};
    if (maxEntriesPerUser !== undefined) {
      const cap = await db.rpc("casa_set_max_entries_v2", { ...args, p_max: maxEntriesPerUser });
      if (cap.error) return casaError(cap.error);
      if (Object.keys(changes).length === 0) return casaJson({ ok: true, ...cap.data });
    }
    const edit = await db.rpc("casa_edit_polla_v2", {
      ...args,
      p_changes: changes,
      p_add_match_ids: body.action === "agregar_partidos" ? body.matchIds : [],
      p_remove_match_ids: body.action === "quitar_partido" ? [body.matchId] : [],
    });
    if (edit.error) {
      const message = editorErrorMessage(edit.error);
      return message ? casaJson({ error: message, code: edit.error.message }, 409) : casaError(edit.error);
    }
    return casaJson(edit.data);
  }
  const result = body.action === "publicacion"
    ? await db.rpc("casa_set_publication_v2", { ...args, p_mode: body.mode, p_opens_at: body.opensAt ?? null })
    : body.action === "repartir"
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
