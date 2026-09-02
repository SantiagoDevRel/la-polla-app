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

const BodySchema = z.object({
  action: z.enum(["publicar", "cerrar", "repartir", "anular"]),
});

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
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

  const db = createAdminClient();

  if (parsed.data.action === "publicar") {
    // El `.eq("status","borrador")` no es decorativo: es el guard contra el
    // doble-tap y contra reabrir una polla ya cerrada o repartida. Si no
    // matchea ninguna fila, es que ya no estaba en borrador.
    const { data, error } = await db
      .from("casa_pollas")
      .update({ status: "abierta" })
      .eq("id", params.id)
      .eq("status", "borrador")
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
      .eq("id", params.id)
      .eq("status", "abierta")
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
      .eq("id", params.id)
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
      console.error("[casa/admin/pollas] repartir:", error.message);
      return NextResponse.json(
        { error: `No pude repartir: ${error.message}` },
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
    .eq("id", params.id)
    .in("status", ["borrador", "abierta"])
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
