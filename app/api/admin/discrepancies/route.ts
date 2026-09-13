// app/api/admin/discrepancies/route.ts
//
// GET → lista los matches con status='finished' que aún no tienen
// final_verified_at y que alguien está jugando, junto con la última
// observación de API-Football que ya está en caché (sin gastar cuota).
//
// El admin layout (lib/auth/admin) ya gatea quién llega acá, pero
// re-chequeamos en cada handler como defensa en profundidad.

import { NextResponse } from "next/server";
import { matchesEnJuego } from "@/lib/matches/en-juego";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCurrentUserAdmin } from "@/lib/auth/admin";
import { cachedApiFootballResult } from "@/lib/matches/af-cached-result";
import { readFinalResult } from "@/lib/api-football/results";

interface MatchRow {
  id: string;
  external_id: string | null;
  source_external_ids: string[] | null;
  tournament: string;
  home_team: string;
  away_team: string;
  home_team_flag: string | null;
  away_team_flag: string | null;
  home_score: number | null;
  away_score: number | null;
  status: string;
  scheduled_at: string;
  final_verification_notes: string | null;
}

export async function GET() {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const admin = createAdminClient();
  // Solo discrepancias de partidos que ESTÁ JUGANDO ALGUIEN: si nadie espera
  // que se le puntúe, no es trabajo del admin resolverlo.
  //
  // 🚨 (2026-09-03) Preguntaba solo por `predictions`, o sea por el modelo
  // P2P viejo. Esta pantalla es el ÚNICO lugar donde un humano puede
  // destrabar un partido en disputa, así que dejar fuera a los de la casa
  // significaba que una polla trabada no tenía salida por la interfaz —
  // solo corriendo SQL a mano.
  const { filas: matches, errores } = await matchesEnJuego<MatchRow>(
    admin,
    "id, external_id, source_external_ids, tournament, home_team, away_team, home_team_flag, away_team_flag, home_score, away_score, status, scheduled_at, final_verification_notes",
    (q) =>
      q
        .eq("status", "finished")
        .is("final_verified_at", null)
        .order("scheduled_at", { ascending: false }),
  );

  if (errores.length > 0) {
    console.error("[admin/discrepancies] db query failed:", errores.join(" | "));
    if (matches.length === 0) {
      return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }
  }

  const enriched = await Promise.all(matches.map(async (m) => {
    let observation: Awaited<ReturnType<typeof cachedApiFootballResult>> = null;
    try {
      observation = await cachedApiFootballResult(m);
    } catch {
      console.warn("[admin/discrepancies] API-Football cache read failed");
    }
    const final = observation ? readFinalResult(observation.fixture) : null;
    const alerted = (m.final_verification_notes ?? "").match(/ alerted=([^ ]+)/);
    return {
      ...m,
      af_status: observation?.fixture.fixture.status.short ?? null,
      af_fetched_at: observation?.fetchedAt ?? null,
      af_home: final?.home ?? null,
      af_away: final?.away ?? null,
      af_fulltime_home: final?.fulltime?.home ?? null,
      af_fulltime_away: final?.fulltime?.away ?? null,
      af_penalty_home: final?.penalty?.home ?? null,
      af_penalty_away: final?.penalty?.away ?? null,
      alerted_at: alerted ? alerted[1] : null,
    };
  }));

  return NextResponse.json({ matches: enriched });
}
