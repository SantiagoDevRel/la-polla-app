// lib/matches/verify-final.ts — Cross-check entre ESPN y football-data
// antes de declarar un match como verificado para scoring.
//
// Llamado desde el sync orquestador cuando un match transiciona a
// status='finished' o cuando un match ya finished todavía no tiene
// final_verified_at.
//
// Reglas:
//   1. Pedir el match a ESPN y a football-data.
//   2. Si AMBOS dicen finished + mismo home_score + mismo away_score
//      → marcar final_verified_at=NOW() en DB y dejar nota.
//   3. Si discrepan → notificar al admin (WhatsApp + email) UNA SOLA
//      VEZ por match (track via final_verification_notes que contiene
//      "alerted").
//   4. Si solo una dice finished → no verificamos todavía, retry next
//      tick.

import { createAdminClient } from "@/lib/supabase/admin";
import {
  ESPN_LEAGUE_BY_TOURNAMENT,
  fetchEspnScoreboard,
  mapEspnStatus,
  parseEspnScore,
} from "@/lib/espn/client";
import { notifyAdmin } from "@/lib/notifications/admin-alert";

export interface VerifyResult {
  match_id: string;
  external_id: string | null;
  espn_id: string | null;
  status: "verified" | "pending" | "discrepancy" | "error";
  notes: string;
}

interface MatchRow {
  id: string;
  external_id: string | null;
  espn_id: string | null;
  tournament: string;
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
  status: string;
  scheduled_at: string;
  final_verified_at: string | null;
  final_verification_notes: string | null;
}

/**
 * Para cada match en `status='finished'` con `final_verified_at IS
 * NULL`, intenta verificar contra las dos fuentes y actualiza la DB.
 * Devuelve el detalle por match para logging.
 */
export async function verifyPendingFinals(): Promise<VerifyResult[]> {
  const admin = createAdminClient();

  // Solo matches recién finalizados sin verificar QUE TIENEN AL MENOS
  // UNA PREDICCIÓN ASOCIADA. Si un match no está en ninguna polla, no
  // hay scoring que ejecutar — no tiene sentido pedir verificación
  // (ni alertar al admin) por algo que no afecta a ningún user.
  // Esto baja drásticamente el ruido de alertas en torneos como liga
  // colombiana donde sync-eamos toda la fixture pero solo unas pocas
  // matches están en pollas activas.
  const { data, error } = await admin
    .from("matches")
    .select("id, external_id, espn_id, tournament, home_team, away_team, home_score, away_score, status, scheduled_at, final_verified_at, final_verification_notes, predictions!inner(id)")
    .eq("status", "finished")
    .is("final_verified_at", null);

  if (error) {
    console.error("[verify-final] db query failed:", error.message);
    return [];
  }
  // El !inner del select fuerza al menos 1 prediction; pero distinct no
  // está disponible directo, así que de-duplicamos en cliente por id.
  const seen = new Set<string>();
  const candidates: MatchRow[] = [];
  for (const row of (data ?? []) as Array<MatchRow & { predictions: unknown }>) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    // Tiramos la columna join antes de pasar al verifier.
    const { predictions: _join, ...rest } = row;
    void _join;
    candidates.push(rest as MatchRow);
  }
  if (candidates.length === 0) return [];

  const results: VerifyResult[] = [];

  for (const match of candidates) {
    const result = await verifyOneMatch(match);
    results.push(result);
  }

  return results;
}

async function verifyOneMatch(match: MatchRow): Promise<VerifyResult> {
  const result: VerifyResult = {
    match_id: match.id,
    external_id: match.external_id,
    espn_id: match.espn_id,
    status: "pending",
    notes: "",
  };

  const admin = createAdminClient();

  // 1. ESPN — pedir el scoreboard del torneo y buscar el evento que
  //    matchee este match (idealmente por espn_id ya guardado).
  const espnLeague = ESPN_LEAGUE_BY_TOURNAMENT[match.tournament];
  if (!espnLeague) {
    result.status = "error";
    result.notes = `No hay mapeo ESPN para tournament=${match.tournament}`;
    await persistNote(admin, match.id, result.notes);
    return result;
  }

  let espnFinished = false;
  let espnHome: number | null = null;
  let espnAway: number | null = null;
  try {
    const events = await fetchEspnScoreboard(match.tournament);
    let event = match.espn_id ? events.find((e) => e.id === match.espn_id) : null;
    if (!event) {
      // Fallback: buscar por kickoff +/- 2h (el matcher principal lo
      // hace en sync.ts; acá replicamos básico).
      const kickMs = new Date(match.scheduled_at).getTime();
      event = events.find((e) => {
        const eventMs = new Date(e.date).getTime();
        return Math.abs(eventMs - kickMs) < 2 * 60 * 60 * 1000;
      }) ?? null;
    }
    if (event) {
      const mapped = mapEspnStatus(event.status);
      espnFinished = mapped === "finished";
      const competition = event.competitions[0];
      const home = competition?.competitors.find((c) => c.homeAway === "home");
      const away = competition?.competitors.find((c) => c.homeAway === "away");
      espnHome = parseEspnScore(home?.score);
      espnAway = parseEspnScore(away?.score);
    }
  } catch (err) {
    console.error("[verify-final] espn fetch failed:", err);
    result.notes += ` espn_error=${err instanceof Error ? err.message : String(err)};`;
  }

  // 2. football-data ya escribió status=finished + scores en match
  //    (por eso estamos acá). Tomamos esos como la posición de
  //    football-data. football-data hace upsert vía la sync existente.
  const fdFinished = match.status === "finished";
  const fdHome = match.home_score;
  const fdAway = match.away_score;

  // 3. Comparar.
  // El marker "alerted=<iso>" del cycle anterior debe sobrevivir cualquier
  // re-write de notes — si lo perdemos, el próximo tick re-notifica y
  // spammeamos al admin con N emails idénticos. Preservamos el suffix
  // explícitamente en cada UPDATE.
  const previousNotes = match.final_verification_notes ?? "";
  const previousAlertedMatch = previousNotes.match(/ alerted=[^ ]+/);
  const alertedSuffix = previousAlertedMatch ? previousAlertedMatch[0] : "";

  if (!espnFinished) {
    result.status = "pending";
    result.notes = `ESPN aún no marca finished (espn=${espnHome}-${espnAway}). football-data: ${fdHome}-${fdAway}.`;
    await persistNote(admin, match.id, result.notes + alertedSuffix);
    return result;
  }

  if (espnHome === fdHome && espnAway === fdAway && fdFinished) {
    // ✅ Coinciden. Marcar verified. El alerted= ya no importa.
    result.status = "verified";
    result.notes = `Verificado: ESPN y football-data coinciden en ${fdHome}-${fdAway}.`;
    await admin
      .from("matches")
      .update({
        final_verified_at: new Date().toISOString(),
        final_verification_notes: result.notes,
      })
      .eq("id", match.id);
    return result;
  }

  // ❌ Discrepancia.
  result.status = "discrepancy";
  result.notes = `DISCREPANCIA — ESPN: ${espnHome}-${espnAway}, football-data: ${fdHome}-${fdAway}.`;

  // Notificar admin solo una vez por match (gate via alerted= en notes).
  // Hacemos un UPDATE solo, con o sin el alerted nuevo según corresponda.
  const alreadyAlerted = !!alertedSuffix;
  if (!alreadyAlerted) {
    try {
      await notifyAdmin({
        title: `Discrepancia de score: ${match.home_team} vs ${match.away_team}`,
        body: result.notes + `\n\nMatch ID: ${match.id}\nKickoff: ${match.scheduled_at}\n\nResolvé desde /admin/discrepancias o forzá manualmente:\nUPDATE matches SET final_verified_at=NOW(), final_verification_notes='manual override' WHERE id='${match.id}';`,
        category: "score_mismatch",
      });
    } catch (err) {
      console.error("[verify-final] notifyAdmin failed:", err);
    }
    await admin
      .from("matches")
      .update({
        final_verification_notes: `${result.notes} alerted=${new Date().toISOString()}`,
      })
      .eq("id", match.id);
  } else {
    // Ya alerté antes. Preservo el alerted= original y solo refresco el
    // texto de la discrepancia (las cifras pueden haber cambiado por
    // un upsert posterior — quiero el snapshot más reciente).
    await admin
      .from("matches")
      .update({
        final_verification_notes: `${result.notes}${alertedSuffix}`,
      })
      .eq("id", match.id);
  }

  return result;
}

async function persistNote(
  admin: ReturnType<typeof createAdminClient>,
  matchId: string,
  note: string,
): Promise<void> {
  await admin
    .from("matches")
    .update({ final_verification_notes: note })
    .eq("id", matchId);
}
