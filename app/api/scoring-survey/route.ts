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

  // TODAS las pollas con encuesta abierta donde este usuario es participante
  // pagado (no .limit(1): puede estar en varias y todas deben mostrarse, una
  // por una).
  const { data: parts, error: partsErr } = await admin
    .from("polla_participants")
    .select("polla_id, joined_at, pollas!inner(id, name, slug, scoring_survey_open)")
    .eq("user_id", user.id)
    .eq("paid", true)
    .eq("pollas.scoring_survey_open", true)
    .order("joined_at", { ascending: true });

  if (partsErr) {
    console.error("[scoring-survey] participants query error:", partsErr);
    return NextResponse.json({ survey: null });
  }

  const rows = (parts ?? []) as unknown as {
    polla_id: string;
    pollas: { id: string; name: string; slug: string };
  }[];
  if (rows.length === 0) {
    return NextResponse.json({ survey: null });
  }

  // Excluir las pollas donde ya votó → primera SIN votar. Al votar esa, el
  // próximo fetch devuelve la siguiente, hasta agotar todas.
  const pollaIds = rows.map((r) => r.polla_id);
  const { data: votes } = await admin
    .from("scoring_survey_votes")
    .select("polla_id")
    .eq("user_id", user.id)
    .in("polla_id", pollaIds);
  const voted = new Set((votes ?? []).map((v) => v.polla_id));

  const next = rows.find((r) => !voted.has(r.polla_id));
  if (!next) {
    return NextResponse.json({ survey: null, alreadyVoted: true });
  }

  return NextResponse.json({
    survey: {
      pollaId: next.polla_id,
      pollaName: (next.pollas?.name ?? "").trim(),
    },
  });
}
