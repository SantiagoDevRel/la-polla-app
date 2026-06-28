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

  // Prioridad: si el usuario tiene pendiente la encuesta goles_v2 en CUALQUIERA
  // de sus pollas, esa va primero (un popup a la vez). Diferimos la del doble
  // hasta que no le quede ninguna goles_v2 sin votar.
  const { data: gv2Parts } = await admin
    .from("polla_participants")
    .select("polla_id, pollas!inner(scoring_survey_open)")
    .eq("user_id", user.id)
    .eq("paid", true)
    .eq("pollas.scoring_survey_open", true);
  const gv2Ids = (gv2Parts ?? []).map((p) => p.polla_id);
  if (gv2Ids.length > 0) {
    const { data: gv2Votes } = await admin
      .from("scoring_survey_votes")
      .select("polla_id")
      .eq("user_id", user.id)
      .in("polla_id", gv2Ids);
    const gv2Voted = new Set((gv2Votes ?? []).map((v) => v.polla_id));
    if (gv2Ids.some((id) => !gv2Voted.has(id))) {
      return NextResponse.json({ survey: null });
    }
  }

  // TODAS las pollas donde el usuario es participante pagado y la encuesta del
  // doble está abierta (no .limit(1): el usuario puede estar en varias y todas
  // deben mostrarse, una por una). Traemos también la escala de puntos para la
  // tabla "hoy vs doble" con los valores reales de ESA polla.
  const { data: parts, error: partsErr } = await admin
    .from("polla_participants")
    .select(
      "polla_id, joined_at, pollas!inner(id, name, slug, double_survey_open, scoring_mode, points_exact, points_goal_diff, points_correct_result, points_one_team)",
    )
    .eq("user_id", user.id)
    .eq("paid", true)
    .eq("pollas.double_survey_open", true)
    .order("joined_at", { ascending: true });

  if (partsErr) {
    console.error("[double-survey] participants query error:", partsErr);
    return NextResponse.json({ survey: null });
  }

  const rows = (parts ?? []) as unknown as {
    polla_id: string;
    pollas: PollaScoring;
  }[];
  if (rows.length === 0) {
    return NextResponse.json({ survey: null });
  }

  // Excluir las pollas donde ya votó → primera polla SIN votar. Cuando vote en
  // esa, el próximo fetch devuelve la siguiente, hasta agotar todas.
  const pollaIds = rows.map((r) => r.polla_id);
  const { data: votes } = await admin
    .from("double_survey_votes")
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
      tiers: buildTiers(next.pollas),
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
