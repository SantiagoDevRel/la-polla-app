// lib/casa/editor-state.ts — lo que lee el editor administrativo de una polla.
//
// Solo servidor. El estado (campos, motivo de bloqueo, inscripciones y
// pronósticos por partido) sale de casa_polla_editor_v2, que también exige
// que el actor sea administrador. Aquí solo se agregan los datos visibles de
// cada partido, con columnas explícitas.

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CasaPolla } from "@/lib/casa/types";
import type { EditBlock } from "@/lib/casa/editor";

export type EditorPolla = Pick<
  CasaPolla,
  | "id"
  | "slug"
  | "name"
  | "description"
  | "kind"
  | "status"
  | "publication_mode"
  | "opens_at"
  | "closes_at"
  | "close_mode"
  | "scoring_mode"
  | "entry_price_cop"
  | "house_cut_pct"
  | "prize_kind"
  | "pot_mode"
  | "fixed_prize_cop"
  | "prize_object"
  | "prize_image_path"
  | "payout_method"
  | "payout_account"
  | "payout_account_name"
  | "ticket_count"
  | "max_entries_per_user"
  | "referral_every"
>;

export interface EditorMatch {
  match_id: string;
  order_index: number;
  voided: boolean;
  picks: number;
  home_team: string;
  away_team: string;
  home_team_flag: string | null;
  away_team_flag: string | null;
  scheduled_at: string;
  scheduled_at_confirmed: boolean;
  status: string;
  tournament: string | null;
}

export interface PollaEditorState {
  polla: EditorPolla;
  block: EditBlock | null;
  entries: number;
  operationMode: string | null;
  matches: EditorMatch[];
}

interface RpcState {
  polla: EditorPolla | null;
  block: EditBlock | null;
  entries: number;
  operation_mode: string | null;
  matches: { match_id: string; order_index: number; voided: boolean; picks: number }[];
}

export async function getPollaEditorState(pollaId: string, actorId: string): Promise<PollaEditorState | null> {
  const db = createAdminClient();
  const { data, error } = await db.rpc("casa_polla_editor_v2", { p_polla_id: pollaId, p_actor_id: actorId });
  if (error) throw error;
  const state = data as RpcState | null;
  if (!state?.polla) return null;

  const ids = state.matches.map((m) => m.match_id);
  const { data: rows, error: matchesError } = ids.length
    ? await db
        .from("matches")
        .select("id, home_team, away_team, home_team_flag, away_team_flag, scheduled_at, scheduled_at_confirmed, status, tournament")
        .in("id", ids)
    : { data: [], error: null };
  if (matchesError) throw matchesError;
  const byId = new Map((rows ?? []).map((row) => [row.id as string, row]));
  // Migración 135: casa_polla_editor_v2 no trae el programa de invitaciones.
  const { data: referral, error: referralError } = await db
    .from("casa_pollas").select("referral_every").eq("id", pollaId).maybeSingle();
  if (referralError) throw referralError;

  return {
    polla: { ...state.polla, referral_every: referral?.referral_every ?? null },
    block: state.block ?? null,
    entries: Number(state.entries ?? 0),
    operationMode: state.operation_mode ?? null,
    // Mismo orden que ve el jugador: por hora de empezada, y `order_index`
    // solo como desempate (2026-09-18). Si el admin viera otro recorrido, no
    // podría revisar la polla como la revisa la gente.
    matches: state.matches.flatMap((link) => {
      const row = byId.get(link.match_id);
      if (!row) return [];
      return [{
        ...link,
        picks: Number(link.picks ?? 0),
        home_team: row.home_team,
        away_team: row.away_team,
        home_team_flag: row.home_team_flag ?? null,
        away_team_flag: row.away_team_flag ?? null,
        scheduled_at: row.scheduled_at,
        scheduled_at_confirmed: row.scheduled_at_confirmed !== false,
        status: row.status,
        tournament: row.tournament ?? null,
      }];
    }).sort((a, b) => (Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at)) || (a.order_index - b.order_index)),
  };
}
