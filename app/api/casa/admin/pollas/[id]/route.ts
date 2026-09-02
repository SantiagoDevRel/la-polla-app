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
// ALCANCE A PROPOSITO: publicar y anular. No edita campos.
//   · publicar → borrador pasa a 'abierta'. Solo desde 'borrador'.
//   · anular   → 'anulada'. listPublicPollas ya la filtra.
// Cerrar y repartir NO viven aca: son del bot (/cerrar y /resolver), que ya
// tiene los guards de partidos verificados y numero sorteado.
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
  action: z.enum(["publicar", "anular"]),
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
