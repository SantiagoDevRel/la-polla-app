// app/api/matches/[id]/live/route.ts — GET datos en vivo de UN partido
// desde ESPN /summary (timeline de goles/tarjetas, boxscore, alineaciones).
//
// Resuelve el ESPN event id a partir del row de `matches`:
//   1. Si external_id trae un número (espn:NNN o NNN) → ese es el event id.
//   2. Si no, consulta el scoreboard de ESPN y matchea por nombres de
//      equipo normalizados (sin acentos, lowercase) contra home/away.
//
// El detalle vivo NUNCA rompe la UI: si ESPN no responde o no hay match,
// devolvemos { summary: null } y el cliente muestra el partido sin detalle.
//
// 🔋 free-tier: fetchEspnSummary cachea en Next Data Cache (30s vivo / 1h
// terminado), compartido global. El header Cache-Control privado de 20s
// evita re-hits cuando el mismo user abre/cierra el popup repetido.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchEspnScoreboard } from "@/lib/espn/client";
import { fetchEspnSummary } from "@/lib/espn/summary";

interface MatchRow {
  id: string;
  tournament: string;
  external_id: string | null;
  scheduled_at: string;
  status: string;
  home_team: string;
  away_team: string;
}

/** Normaliza un nombre de equipo para comparar (lowercase, sin acentos,
 *  sin espacios extra). Suficiente para parear ESPN vs nuestra DB. */
function normalize(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Extrae el ESPN event id SOLO de un external_id explícito de ESPN
 *  ("espn:401862893"). Un número pelado ("552094") es un id de football-data
 *  (numeración distinta) — usarlo como event id de ESPN trae un partido
 *  EQUIVOCADO (bug real: Canada vs Bosnia mostraba alineación de Numancia vs
 *  Dépor). Para esos casos devolvemos null y se resuelve por scoreboard. */
function espnIdFromExternal(externalId: string | null): string | null {
  if (!externalId) return null;
  const match = externalId.match(/^espn:(\d+)$/i);
  return match ? match[1] : null;
}

/** Busca el event id en el scoreboard de ESPN pareando por nombres de
 *  equipo normalizados. Devuelve null si no encuentra el partido. */
async function resolveEventIdFromScoreboard(
  tournament: string,
  homeTeam: string,
  awayTeam: string,
): Promise<string | null> {
  let events;
  try {
    events = await fetchEspnScoreboard(tournament);
  } catch {
    return null;
  }
  const targetHome = normalize(homeTeam);
  const targetAway = normalize(awayTeam);
  for (const ev of events) {
    const competitors = ev.competitions?.[0]?.competitors ?? [];
    const names = competitors.map((c) => normalize(c.team?.displayName ?? ""));
    // Match en cualquier orden home/away: ESPN puede listar al revés.
    const hasHome = names.some((n) => n === targetHome || n.includes(targetHome) || targetHome.includes(n));
    const hasAway = names.some((n) => n === targetAway || n.includes(targetAway) || targetAway.includes(n));
    if (hasHome && hasAway) return ev.id;
  }
  return null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("matches")
      .select("id, tournament, external_id, scheduled_at, status, home_team, away_team")
      .eq("id", params.id)
      .maybeSingle<MatchRow>();

    if (error) {
      console.error("[matches/live] query failed:", error.message);
      return NextResponse.json({ error: "Error consultando el partido" }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Partido no encontrado" }, { status: 404 });
    }

    // 1. external_id numérico → event id directo.
    // 2. fallback: parear contra el scoreboard de ESPN por nombres.
    let eventId = espnIdFromExternal(data.external_id);
    if (!eventId) {
      eventId = await resolveEventIdFromScoreboard(data.tournament, data.home_team, data.away_team);
    }

    if (!eventId) {
      // No pudimos resolver el partido en ESPN — sin detalle, no rompemos.
      return NextResponse.json({ summary: null });
    }

    const summary = await fetchEspnSummary(data.tournament, eventId, {
      live: data.status === "live",
    });

    return NextResponse.json(
      { summary },
      { headers: { "Cache-Control": "private, max-age=20" } },
    );
  } catch (err) {
    console.error("[matches/live] unexpected:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
