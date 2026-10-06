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
import { casaPicksBodySchema, getOwnedPickEntry, getPickSaveState, saveCasaPicks } from "@/lib/casa/picks-save";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const privateHeaders = { "Cache-Control": "private, no-store" };

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user }, error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Sin sesión." }, { status: 401, headers: privateHeaders });

  const polla = await getPollaBySlug((await params).slug);
  if (!polla || polla.status === "borrador") return NextResponse.json({ error: "No existe." }, { status: 404, headers: privateHeaders });

  if (req.nextUrl.searchParams.get("state") === "1") {
    try {
      const db = createAdminClient();
      const rawNumber = req.nextUrl.searchParams.get("p");
      const number = rawNumber === null ? undefined : /^\d{1,2}$/.test(rawNumber) ? Number(rawNumber) : NaN;
      if (number !== undefined && (!Number.isInteger(number) || number < 1 || number > 50)) return NextResponse.json({ error: "Ese cupo no existe." }, { status: 404, headers: privateHeaders });
      const entry = await getOwnedPickEntry(polla.id, user.id, db, number);
      const expectedEntry = req.nextUrl.searchParams.get("entryId");
      if (!entry || (expectedEntry && entry.id !== expectedEntry)) return NextResponse.json({ error: "La sesión o el cupo cambió. Vuelve a abrir esta polla." }, { status: 403, headers: privateHeaders });
      const state = await getPickSaveState(polla.id, user.id, entry.id, db);
      if (!state) return NextResponse.json({ error: "Ese cupo no está disponible." }, { status: 404, headers: privateHeaders });
      return NextResponse.json(state, { headers: { "Cache-Control": "private, no-store" } });
    } catch {
      return NextResponse.json({ error: "No pudimos comprobar tus pronósticos. Conservamos tus cambios." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
    }
  }

  // ?p=N limita a una participación; sin número devuelve todas las de la persona.
  const raw = req.nextUrl.searchParams.get("p");
  let entryId: string | undefined;
  if (raw !== null) {
    const number = /^\d{1,2}$/.test(raw) ? Number(raw) : NaN;
    const entry = Number.isInteger(number) && number >= 1 ? await getMyEntryByNumber(polla.id, user.id, number) : null;
    if (!entry) return NextResponse.json({ error: "Ese cupo no existe." }, { status: 404, headers: privateHeaders });
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
    data: { user }, error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Sin sesión." }, { status: 401, headers: privateHeaders });

  const polla = await getPollaBySlug((await params).slug);
  if (!polla || polla.status === "borrador") {
    return NextResponse.json({ error: "Esa polla no existe." }, { status: 404, headers: privateHeaders });
  }

  const parsed = casaPicksBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Datos inválidos." },
      { status: 400, headers: privateHeaders },
    );
  }

  // saveCasaPicks valida que la participación sea de esta persona y pueda pronosticar.
  const body = parsed.data;
  const operation = body.requestId !== undefined && body.expectedRevision !== undefined
    ? { requestId: body.requestId, expectedRevision: body.expectedRevision, entryId: body.entryId } : undefined;
  const result = await saveCasaPicks(polla, user.id, body.picks, undefined, body.entryNumber, operation);
  const headers = { "Cache-Control": "private, no-store" };
  if (!result.ok) return NextResponse.json({ error: result.error, conflict: result.conflict, retryable: result.retryable }, { status: result.status, headers });
  return NextResponse.json(result, { headers });
}
