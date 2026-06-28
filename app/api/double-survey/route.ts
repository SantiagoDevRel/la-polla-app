// app/api/double-survey/route.ts — Estado de la encuesta "puntos dobles
// desde octavos" para el usuario actual.
//
// Devuelve la encuesta SOLO si: (1) hay sesión, (2) el usuario es
// participante PAGADO de alguna polla con double_survey_open=true, (3)
// todavía no votó, y (4) no tiene pendiente la encuesta goles_v2 (esa va
// primero — un popup a la vez). Si algo de eso falla → { survey: null } y el
// popup no se muestra.
//
// Auth: sesión Supabase (getUser). La lectura va por admin client + filtro
// user_id explícito porque auth.uid() retorna NULL en el request context de
// PostgREST (ver CLAUDE.md). RLS queda como defense-in-depth.
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

  // Prioridad: si el usuario tiene pendiente la encuesta goles_v2, esa va
  // primero. No mostramos la del doble hasta que resuelva la otra (un popup
  // a la vez). Mismo criterio de "participante pagado + survey abierta + no
  // votó" que /api/scoring-survey.
  const { data: gv2Parts } = await admin
    .from("polla_participants")
    .select("polla_id, pollas!inner(id, scoring_survey_open)")
    .eq("user_id", user.id)
    .eq("paid", true)
    .eq("pollas.scoring_survey_open", true)
    .limit(1);
  const gv2Row = gv2Parts?.[0] as unknown as { polla_id: string } | undefined;
  if (gv2Row) {
    const { data: gv2Voted } = await admin
      .from("scoring_survey_votes")
      .select("choice")
      .eq("polla_id", gv2Row.polla_id)
      .eq("user_id", user.id)
      .maybeSingle();
    // Tiene una goles_v2 abierta sin votar → diferimos la del doble.
    if (!gv2Voted) {
      return NextResponse.json({ survey: null });
    }
  }

  // Pollas con la encuesta del doble abierta donde este usuario es
  // participante pagado. Traemos también la escala de puntos para mostrar
  // la tabla "hoy vs doble" con los valores reales de ESA polla.
  const { data: parts, error: partsErr } = await admin
    .from("polla_participants")
    .select(
      "polla_id, pollas!inner(id, name, slug, double_survey_open, scoring_mode, points_exact, points_goal_diff, points_correct_result, points_one_team)",
    )
    .eq("user_id", user.id)
    .eq("paid", true)
    .eq("pollas.double_survey_open", true)
    .limit(1);

  if (partsErr) {
    console.error("[double-survey] participants query error:", partsErr);
    return NextResponse.json({ survey: null });
  }

  const row = parts?.[0] as unknown as
    | { polla_id: string; pollas: PollaScoring }
    | undefined;
  if (!row) {
    return NextResponse.json({ survey: null });
  }

  // ¿Ya votó?
  const { data: existing } = await admin
    .from("double_survey_votes")
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
      tiers: buildTiers(row.pollas),
    },
  });
}

interface PollaScoring {
  id: string;
  name: string;
  slug: string;
  scoring_mode: string | null;
  points_exact: number | null;
  points_goal_diff: number | null;
  points_correct_result: number | null;
  points_one_team: number | null;
}

// Construye la escala de puntos de la polla con la columna "doble" (x2).
// goles_v2 usa su escalera fija 5/4/3/2/1/0; classic usa las columnas de la
// polla (default 5/3/2/1). El doble es x2 (0 sigue 0). Debe leerse claro:
// lo que se gana HOY en octavos vs con el cambio.
function buildTiers(
  p: PollaScoring,
): { label: string; hoy: number; nuevo: number }[] {
  const rows =
    p.scoring_mode === "goles_v2"
      ? [
          { label: "Marcador exacto", hoy: 5 },
          { label: "Ganador + diferencia de gol", hoy: 4 },
          { label: "Ganador + un gol de algún equipo", hoy: 3 },
          { label: "Ganador solo", hoy: 2 },
          { label: "Un gol de algún equipo (sin el ganador)", hoy: 1 },
          { label: "No le acertaste a nada", hoy: 0 },
        ]
      : [
          { label: "Marcador exacto", hoy: p.points_exact ?? 5 },
          { label: "Ganador + diferencia de gol", hoy: p.points_goal_diff ?? 3 },
          { label: "Ganador (resultado correcto)", hoy: p.points_correct_result ?? 2 },
          { label: "Un gol de algún equipo", hoy: p.points_one_team ?? 1 },
          { label: "No le acertaste a nada", hoy: 0 },
        ];
  return rows.map((r) => ({ ...r, nuevo: r.hoy * 2 }));
}
