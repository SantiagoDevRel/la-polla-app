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
import { getMyEntryByNumber, getMyPicks, getPollaBySlug } from "@/lib/casa/queries";
import { casaPicksBodySchema, pollaAcceptsPicks, saveCasaPicks } from "@/lib/casa/picks-save";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sin sesión." }, { status: 401 });

  const polla = await getPollaBySlug((await params).slug);
  if (!polla) return NextResponse.json({ error: "No existe." }, { status: 404 });

  // ?p=N limita a una participación; sin número devuelve todas las de la persona.
  const raw = req.nextUrl.searchParams.get("p");
  let entryId: string | undefined;
  if (raw !== null) {
    const number = /^\d{1,2}$/.test(raw) ? Number(raw) : NaN;
    const entry = Number.isInteger(number) && number >= 1 ? await getMyEntryByNumber(polla.id, user.id, number) : null;
    if (!entry) return NextResponse.json({ error: "Ese cupo no existe." }, { status: 404 });
    entryId = entry.id;
  }
  const picks = await getMyPicks(polla.id, user.id, entryId);
  return NextResponse.json({ picks }, { headers: { "Cache-Control": "private, no-store" } });
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

  const parsed = casaPicksBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Datos inválidos." },
      { status: 400 },
    );
  }

  // saveCasaPicks valida que la participación sea de esta persona y pueda pronosticar.
  const result = await saveCasaPicks(polla, user.id, parsed.data.picks, undefined, parsed.data.entryNumber);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, guardados: result.guardados, avisos: result.avisos });
}
