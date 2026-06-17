// app/api/scoring-survey/route.ts — Estado de la encuesta de sistema de
// puntos para el usuario actual.
//
// Devuelve la encuesta SOLO si: (1) hay sesión, (2) el usuario es
// participante PAGADO de alguna polla con scoring_survey_open=true, y
// (3) todavía no votó. Si algo de eso falla → { survey: null } y el popup
// no se muestra.
//
// Auth: sesión Supabase (getUser). La lectura va por admin client +
// filtro user_id explícito porque auth.uid() retorna NULL en el request
// context de PostgREST (ver CLAUDE.md). RLS queda como defense-in-depth.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Pollas con encuesta abierta donde este usuario es participante pagado.
  const { data: parts, error: partsErr } = await admin
    .from("polla_participants")
    .select("polla_id, pollas!inner(id, name, slug, scoring_survey_open)")
    .eq("user_id", user.id)
    .eq("paid", true)
    .eq("pollas.scoring_survey_open", true)
    .limit(1);

  if (partsErr) {
    console.error("[scoring-survey] participants query error:", partsErr);
    return NextResponse.json({ survey: null });
  }

  const row = parts?.[0] as unknown as
    | { polla_id: string; pollas: { id: string; name: string; slug: string } }
    | undefined;
  if (!row) {
    return NextResponse.json({ survey: null });
  }

  // ¿Ya votó?
  const { data: existing } = await admin
    .from("scoring_survey_votes")
    .select("choice")
    .eq("polla_id", row.polla_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ survey: null, alreadyVoted: true });
  }

  return NextResponse.json({
    survey: {
      pollaId: row.polla_id,
      pollaName: (row.pollas?.name ?? "").trim(),
    },
  });
}
