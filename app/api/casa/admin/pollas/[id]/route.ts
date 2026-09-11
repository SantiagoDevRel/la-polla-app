// app/api/casa/admin/pollas/[id]/route.ts — las acciones sobre una polla YA creada.
//
// POR QUE EXISTE (2026-09-02):
// El formulario ofrecia "Guardar borrador" y avisaba "no es visible hasta que
// lo publiques"... pero NO habia forma de publicarlo. En todo /api/casa no
// existia un solo PATCH/PUT de admin: `status` pasaba a 'abierta' unicamente
// dentro del mismo POST de creacion. Y el borrador es invisible por triplicado
// (lib/casa/queries.ts lo filtra, /casa/[slug] hace notFound, join devuelve
// 404), asi que quedaba enterrado sin gesto para revivirlo.
//
// Era una trampa: el boton mas conservador del formulario — el que uno toca
// cuando no esta seguro — era el unico que perdia el trabajo.
//
// ALCANCE: publicar, cerrar, repartir y anular — el ciclo completo.
//
// (2026-09-02) Cerrar y repartir SE MUDARON ACA. Hasta hoy `/cerrar` y
// `/resolver` existian UNICAMENTE como comandos del bot de Telegram, o sea
// que la plata tenia una sola puerta: si el bot se caia, o el chat no estaba
// vinculado, el pozo no se podia repartir salvo corriendo SQL a mano.
// El dueño ademas pidio sacar los bots de la UI ("por ahora nada de bots"),
// asi que la web pasa a ser el camino principal y no el respaldo.
//
// Los guards del bot NO se relajaron al mudarlos — se copiaron:
//   · repartir exige que TODOS los partidos esten verificados (si no, esos
//     cuentan 0 puntos y alguien cobra de menos),
//   · una rifa exige el numero sorteado,
//   · una polla manual exige sus preguntas resueltas.
//
// ⛔ NO se expone DELETE. Una polla puede tener inscripciones pagadas: borrarla
// destruiria el rastro de plata de gente real. 'anulada' es reversible y
// auditable; un DELETE no.

import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";

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

  const { data: preguntas } = await db
    .from("casa_questions")
    .select("id, prompt, points, input_kind, resolved_option_id, resolved_text, resolved_at, order_index")
    .eq("polla_id", id)
    .order("order_index", { ascending: true });

  const ids = (preguntas ?? []).map((q: { id: string }) => q.id);
  const { data: opciones } = ids.length
    ? await db.from("casa_options").select("id, question_id, label, order_index").in("question_id", ids).order("order_index", { ascending: true })
    : { data: [] };

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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Auth ANTES de tocar la DB, y con la misma puerta que el resto de /casa/admin.
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  if (!user.is_admin) return NextResponse.json({ error: "Sin permiso." }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo invalido." }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Accion invalida." }, { status: 400 });
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Polla inválida." }, { status: 400 });
  }

  const db = createAdminClient();

  if (parsed.data.action === "eliminar") {
    const { data: polla, error: readError } = await db.from("casa_pollas")
      .select("id, name, archived_at").eq("id", id).maybeSingle();
    if (readError) return NextResponse.json({ error: "No se pudo consultar la polla." }, { status: 500 });
    if (!polla) return NextResponse.json({ error: "No existe esa polla." }, { status: 404 });
    if (polla.archived_at) return NextResponse.json({ error: "Esta polla ya se eliminó." }, { status: 409 });
    // Archive every lifecycle state, including settled pools, without changing
    // the original status or deleting financial and prediction history.
    const { data, error } = await db.from("casa_pollas")
      .update({ archived_at: new Date().toISOString(), archived_by: user.id })
      .eq("id", id).is("archived_at", null)
      .select("id, slug, archived_at").maybeSingle();
    if (error) return NextResponse.json({ error: "No se pudo eliminar la polla." }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Esta polla ya se eliminó." }, { status: 409 });
    return NextResponse.json({ ok: true, slug: data.slug, archived: true });
  }

  // ── responder una pregunta (polla manual) ────────────────────────────
  // Hasta hoy esto SOLO existía como comando del bot de Telegram, igual que
  // pasaba con cerrar y repartir antes del 2026-09-02: una polla manual se
  // podía crear y jugar desde la web, pero para resolverla había que abrir el
  // bot — y sin las preguntas resueltas el reparto se bloquea. Los guards son
  // los mismos del bot: no se toca una polla ya repartida y el
  // `.is("resolved_at", null)` evita la doble resolución.
  if (parsed.data.action === "responder") {
    const { questionId, optionId, texto } = parsed.data;

    const { data: pregunta, error: qError } = await db
      .from("casa_questions")
      .select("id, polla_id, prompt, input_kind, resolved_at")
      .eq("id", questionId)
      .eq("polla_id", id) // la pregunta tiene que ser DE esta polla
      .maybeSingle();
    if (qError) return NextResponse.json({ error: "No se pudo leer la pregunta." }, { status: 500 });
    if (!pregunta) return NextResponse.json({ error: "Esa pregunta no es de esta polla." }, { status: 404 });
    if (pregunta.resolved_at) {
      return NextResponse.json({ error: "Esa pregunta ya estaba resuelta." }, { status: 409 });
    }
    if (pregunta.input_kind === "opciones" && !optionId) {
      return NextResponse.json({ error: "Elige cuál opción era la correcta." }, { status: 400 });
    }
    if (pregunta.input_kind === "texto" && !texto) {
      return NextResponse.json({ error: "Escribe la respuesta correcta." }, { status: 400 });
    }

    const { data: polla, error: pError } = await db
      .from("casa_pollas")
      .select("id, status, archived_at")
      .eq("id", id)
      .maybeSingle();
    if (pError) return NextResponse.json({ error: "No se pudo leer la polla." }, { status: 500 });
    if (!polla || polla.archived_at || ["resuelta", "anulada"].includes(polla.status)) {
      return NextResponse.json(
        { error: "Esta polla ya se repartió, se anuló o se eliminó: sus respuestas no se cambian." },
        { status: 409 },
      );
    }

    if (optionId) {
      const { data: opcion } = await db
        .from("casa_options")
        .select("id")
        .eq("id", optionId)
        .eq("question_id", questionId) // la opción tiene que ser DE esa pregunta
        .maybeSingle();
      if (!opcion) {
        return NextResponse.json({ error: "Esa opción no es de esa pregunta." }, { status: 400 });
      }
    }

    const { data: resuelta, error: uError } = await db
      .from("casa_questions")
      .update({
        resolved_option_id: optionId ?? null,
        resolved_text: texto ?? null,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", questionId)
      .is("resolved_at", null) // guard anti doble-tap, igual que el bot
      .select("id")
      .maybeSingle();
    if (uError) return NextResponse.json({ error: "No se pudo guardar la respuesta." }, { status: 500 });
    if (!resuelta) return NextResponse.json({ error: "Esa pregunta ya estaba resuelta." }, { status: 409 });

    // Repuntuar al toque: la tabla queda al día sin esperar el reparto.
    await db.rpc("casa_score_polla", { p_polla_id: id });

    const { count: faltan } = await db
      .from("casa_questions")
      .select("id", { count: "exact", head: true })
      .eq("polla_id", id)
      .is("resolved_at", null);

    return NextResponse.json({ ok: true, faltan: faltan ?? 0 });
  }

  // ── el número que salió (rifa) ───────────────────────────────────────
  if (parsed.data.action === "numero") {
    const { data: polla, error: pError } = await db
      .from("casa_pollas")
      .select("id, kind, status, archived_at, ticket_count")
      .eq("id", id)
      .maybeSingle();
    if (pError) return NextResponse.json({ error: "No se pudo leer la polla." }, { status: 500 });
    if (!polla) return NextResponse.json({ error: "No existe esa polla." }, { status: 404 });
    if (polla.kind !== "rifa") {
      return NextResponse.json({ error: "Esa polla no es una rifa." }, { status: 400 });
    }
    if (polla.archived_at || ["resuelta", "anulada"].includes(polla.status)) {
      return NextResponse.json(
        { error: "Esta rifa ya se repartió, se anuló o se eliminó: el número no se cambia." },
        { status: 409 },
      );
    }
    if (polla.ticket_count != null && parsed.data.numero > polla.ticket_count) {
      return NextResponse.json(
        { error: `Esta rifa va del 1 al ${polla.ticket_count}.` },
        { status: 400 },
      );
    }

    const { data, error } = await db
      .from("casa_pollas")
      .update({ drawn_number: parsed.data.numero })
      .eq("id", id)
      .is("archived_at", null)
      .not("status", "in", "(resuelta,anulada)")
      .select("id, drawn_number")
      .maybeSingle();
    if (error) return NextResponse.json({ error: "No se pudo guardar el número." }, { status: 500 });
    if (!data) return NextResponse.json({ error: "No se pudo guardar el número." }, { status: 409 });

    // Quién tiene esa boleta, para que el admin lo vea ANTES de repartir.
    const { data: ganadora } = await db
      .from("casa_entries")
      .select("user_id")
      .eq("polla_id", id)
      .eq("status", "pagada")
      .eq("ticket_number", parsed.data.numero)
      .maybeSingle();

    return NextResponse.json({ ok: true, numero: data.drawn_number, vendida: Boolean(ganadora) });
  }

  if (parsed.data.action === "publicar") {
    // El `.eq("status","borrador")` no es decorativo: es el guard contra el
    // doble-tap y contra reabrir una polla ya cerrada o repartida. Si no
    // matchea ninguna fila, es que ya no estaba en borrador.
    const { data, error } = await db
      .from("casa_pollas")
      .update({ status: "abierta" })
      .eq("id", (await params).id)
      .eq("status", "borrador")
      .is("archived_at", null)
      .select("id, slug, status")
      .maybeSingle();

    if (error) {
      console.error("[casa/admin/pollas] publicar:", error.message);
      return NextResponse.json({ error: "No pude publicarla." }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json(
        { error: "Esa polla ya no esta en borrador." },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, slug: data.slug, status: data.status });
  }

  // ── cerrar ───────────────────────────────────────────────────────────
  // Deja de recibir inscripciones. NO reparte: son dos gestos separados a
  // proposito, porque entre uno y otro hay que esperar a que terminen los
  // partidos.
  if (parsed.data.action === "cerrar") {
    const { data, error } = await db
      .from("casa_pollas")
      .update({ status: "cerrada" })
      .eq("id", (await params).id)
      .eq("status", "abierta")
      .is("archived_at", null)
      .select("id, slug, status")
      .maybeSingle();

    if (error) {
      console.error("[casa/admin/pollas] cerrar:", error.message);
      return NextResponse.json({ error: "No pude cerrarla." }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json(
        { error: "Esa polla ya no está abierta." },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, slug: data.slug, status: data.status });
  }

  // ── repartir ─────────────────────────────────────────────────────────
  if (parsed.data.action === "repartir") {
    const { data: polla } = await db
      .from("casa_pollas")
      .select("id, slug, kind, status, drawn_number")
      .eq("id", (await params).id)
      .is("archived_at", null)
      .maybeSingle();

    if (!polla) {
      return NextResponse.json({ error: "No existe esa polla." }, { status: 404 });
    }
    if (polla.status === "resuelta") {
      return NextResponse.json({ error: "Ya se repartió." }, { status: 409 });
    }
    if (polla.status !== "cerrada") {
      return NextResponse.json(
        { error: "Primero ciérrala. Repartir con la polla abierta dejaría entrar gente después del reparto." },
        { status: 409 },
      );
    }

    const { count: pendientes, error: pendingError } = await db
      .from("casa_entries")
      .select("id", { count: "exact", head: true })
      .eq("polla_id", polla.id).eq("status", "pendiente")
      .not("proof_path", "is", null);
    if (pendingError) {
      return NextResponse.json({ error: "No se pudieron verificar los pagos pendientes." }, { status: 500 });
    }
    if ((pendientes ?? 0) > 0) {
      return NextResponse.json({ error: "Revisa todos los comprobantes pendientes antes de repartir el pozo." }, { status: 409 });
    }

    // Guard de la rifa: sin numero sorteado no hay a quien pagarle.
    if (polla.kind === "rifa" && polla.drawn_number == null) {
      return NextResponse.json(
        { error: "Falta el número que salió. Regístralo antes de repartir." },
        { status: 409 },
      );
    }

    // Guard de las preguntas: una pregunta sin resolver puntúa 0 para todos.
    if (polla.kind === "manual") {
      const { data: qs } = await db
        .from("casa_questions")
        .select("id, prompt, resolved_at")
        .eq("polla_id", polla.id);
      const sinResolver = (qs ?? []).filter(
        (q: { resolved_at: string | null }) => !q.resolved_at,
      );
      if (sinResolver.length > 0) {
        return NextResponse.json(
          {
            error: `Faltan ${sinResolver.length} pregunta(s) por resolver. Si reparto ahora, esas cuentan 0 para todos.`,
          },
          { status: 409 },
        );
      }
    }

    // Guard de los partidos: EL MAS IMPORTANTE. Un partido sin verificar
    // puntúa 0, así que repartir antes de tiempo le paga de menos a quien
    // acertó — y el reparto no se puede deshacer.
    if (polla.kind === "partidos") {
      const { data: links } = await db
        .from("casa_polla_matches")
        .select("match_id")
        .eq("polla_id", polla.id);
      const ids = (links ?? []).map((l: { match_id: string }) => l.match_id);

      if (ids.length > 0) {
        const { data: ms } = await db
          .from("matches")
          .select("id, home_team, away_team, final_verified_at")
          .in("id", ids);
        const sinVerificar = (ms ?? []).filter(
          (m: { final_verified_at: string | null }) => !m.final_verified_at,
        );
        if (sinVerificar.length > 0) {
          const nombres = sinVerificar
            .slice(0, 4)
            .map(
              (m: { home_team: string; away_team: string }) =>
                `${m.home_team} vs ${m.away_team}`,
            )
            .join(", ");
          return NextResponse.json(
            {
              error: `Faltan ${sinVerificar.length} partido(s) por verificar (${nombres}). Si reparto ahora esos cuentan 0 y alguien cobra de menos.`,
            },
            { status: 409 },
          );
        }
      }
    }

    const { data: repartido, error } = await db.rpc("casa_settle_polla", {
      p_polla_id: polla.id,
    });
    if (error) {
      if (error.code === "55000") {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      console.error("[casa/admin/pollas] repartir:", error.message);
      return NextResponse.json(
        { error: "No se pudo repartir el pozo. Intenta de nuevo." },
        { status: 500 },
      );
    }

    const r = repartido as {
      prize_cop: number;
      winners: number;
      each_cop: number;
      top_points: number;
    } | null;
    return NextResponse.json({ ok: true, slug: polla.slug, reparto: r });
  }

  // anular — se permite desde borrador o abierta. Una polla ya 'liquidada' no
  // se toca: la plata ya se repartio y anularla dejaria los payouts colgando.
  const { data, error } = await db
    .from("casa_pollas")
    .update({ status: "anulada" })
    .eq("id", (await params).id)
    .in("status", ["borrador", "abierta"])
    .is("archived_at", null)
    .select("id, slug, status")
    .maybeSingle();

  if (error) {
    console.error("[casa/admin/pollas] anular:", error.message);
    return NextResponse.json({ error: "No pude anularla." }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json(
      { error: "Solo se puede anular una polla en borrador o abierta." },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true, slug: data.slug, status: data.status });
}
