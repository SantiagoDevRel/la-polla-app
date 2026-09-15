// app/api/casa/pollas/[slug]/picks/route.ts
//
// Guardar y leer los pronosticos de UNA persona en UNA polla.
//
// Reglas duras (viven en lib/casa/picks-save.ts, compartidas con el bot de
// Telegram para jugadores):
//  * Solo se pronostica si tienes inscripcion (aunque el pago esté pendiente:
//    asi la gente puede ir marcando mientras el admin confirma).
//  * Se bloquea cuando la polla cierra (`closes_at`) y, ademas, partido por
//    partido: un partido que ya arrancó no se puede pronosticar aunque la
//    polla siga abierta.
//  * Los picks NUNCA se borran; se sobrescriben con upsert por (entry, target).

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMyEntry, getMyPicks, getPollaBySlug } from "@/lib/casa/queries";
import { casaPicksBodySchema, entryCanPick, pollaAcceptsPicks, saveCasaPicks } from "@/lib/casa/picks-save";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sin sesión." }, { status: 401 });

  const polla = await getPollaBySlug((await params).slug);
  if (!polla) return NextResponse.json({ error: "No existe." }, { status: 404 });

  const picks = await getMyPicks(polla.id, user.id);
  return NextResponse.json({ picks });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sin sesión." }, { status: 401 });

  const polla = await getPollaBySlug((await params).slug);
  if (!polla || polla.status === "borrador") {
    return NextResponse.json({ error: "Esa polla no existe." }, { status: 404 });
  }
  if (!pollaAcceptsPicks(polla)) {
    return NextResponse.json(
      { error: "Esta polla ya cerró. Los pronósticos quedaron como estaban." },
      { status: 409 },
    );
  }

  const entry = await getMyEntry(polla.id, user.id);
  if (!entryCanPick(entry)) {
    return NextResponse.json(
      { error: "Primero tienes que inscribirte a la polla." },
      { status: 403 },
    );
  }

  const parsed = casaPicksBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Datos inválidos." },
      { status: 400 },
    );
  }

  const result = await saveCasaPicks(polla, user.id, parsed.data.picks);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, guardados: result.guardados, avisos: result.avisos });
}
