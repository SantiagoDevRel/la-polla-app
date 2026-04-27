// lib/whatsapp/state.ts
//
// Persistent conversation state for multi-step WhatsApp bot flows.
//
// Backed by public.whatsapp_conversation_state (originally migration 015,
// dropped in 023 when the bot was retired, restored in 026). Replaces the
// previous in-memory Map, which was wiped on every Vercel Lambda cold
// start and caused users to lose their place mid-prediction or mid-join.
//
// Keyed by phone (E.164 without a leading plus, as Meta delivers). One
// row per active conversation. TTL is 10 minutes, enforced lazily by the
// read filter (expires_at > now()). Writers refresh the TTL on every
// setState call.
//
// Every function is async and returns a Promise. Public API surface
// mirrors the previous in-memory module so callers only add `await`.
//
// Error handling: each DB op retries once at 100ms then fails closed.
//   - setState: throws on second failure. Outer handlers already try/catch.
//   - getState: returns null on second failure and logs a structured error.
//   - clearState: logs on second failure and swallows. TTL will catch it.
//
// Privacy: logged errors include only the last 4 digits of the phone.
//
// Race semantics: last-write-wins via UPSERT on the phone primary key.
// No row locking. The bot flows tolerate this because the downstream DB
// writes (predictions, polla_participants) have their own unique
// constraints.
import { createAdminClient } from "@/lib/supabase/admin";

export type ConversationAction =
  | "browsing_polla"
  | "picking_group"
  | "picking_match"
  | "waiting_prediction"
  | "confirm_prediction"
  | "waiting_join_confirm";

export type ConversationState = {
  action: ConversationAction;
  pollaId?: string;
  matchId?: string;
  matchIndex?: number;
  totalMatches?: number;
  page?: number;
  predictedHome?: number;
  predictedAway?: number;
  joinCode?: string;
  // Predict flow grouping. Set when the user picks "Por fase" / "Por
  // fecha", cleared on flow exit. Persisted in dedicated columns so
  // pagination ("Ver más") and selection survive across messages.
  predictGroupMode?: "phase" | "date";
  predictGroupKey?: string;
  predictGroupPage?: number;
};

const STATE_TTL_MINUTES = 10;
const RETRY_DELAY_MS = 100;

interface StateRow {
  phone: string;
  action: ConversationAction;
  polla_id: string | null;
  match_id: string | null;
  match_index: number | null;
  total_matches: number | null;
  page: number | null;
  predicted_home: number | null;
  predicted_away: number | null;
  join_code: string | null;
  predict_group_mode: "phase" | "date" | null;
  predict_group_key: string | null;
  predict_group_page: number | null;
  updated_at: string;
  expires_at: string;
}

const SELECT_COLUMNS =
  "phone, action, polla_id, match_id, match_index, total_matches, page, " +
  "predicted_home, predicted_away, join_code, predict_group_mode, " +
  "predict_group_key, predict_group_page, updated_at, expires_at";

async function retryOnce<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (firstErr) {
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    try {
      return await fn();
    } catch (secondErr) {
      void firstErr;
      throw secondErr;
    }
  }
}

function maskPhone(phone: string): string {
  if (phone.length <= 4) return phone;
  return phone.slice(-4);
}

export async function setState(
  phone: string,
  state: ConversationState,
): Promise<void> {
  const supabase = createAdminClient();
  const row = {
    phone,
    action: state.action,
    polla_id: state.pollaId ?? null,
    match_id: state.matchId ?? null,
    match_index: state.matchIndex ?? null,
    total_matches: state.totalMatches ?? null,
    page: state.page ?? null,
    predicted_home: state.predictedHome ?? null,
    predicted_away: state.predictedAway ?? null,
    join_code: state.joinCode ?? null,
    predict_group_mode: state.predictGroupMode ?? null,
    predict_group_key: state.predictGroupKey ?? null,
    predict_group_page: state.predictGroupPage ?? null,
    updated_at: new Date().toISOString(),
    expires_at: new Date(
      Date.now() + STATE_TTL_MINUTES * 60 * 1000,
    ).toISOString(),
  };

  await retryOnce(async () => {
    const { error } = await supabase
      .from("whatsapp_conversation_state")
      .upsert(row, { onConflict: "phone" });
    if (error) throw error;
  });
}

export async function getState(
  phone: string,
): Promise<ConversationState | null> {
  const supabase = createAdminClient();

  try {
    const row = await retryOnce<StateRow | null>(async () => {
      const { data, error } = await supabase
        .from("whatsapp_conversation_state")
        .select(SELECT_COLUMNS)
        .eq("phone", phone)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      if (error) throw error;
      return (data as StateRow | null) ?? null;
    });

    if (!row) return null;

    return {
      action: row.action,
      pollaId: row.polla_id ?? undefined,
      matchId: row.match_id ?? undefined,
      matchIndex: row.match_index ?? undefined,
      totalMatches: row.total_matches ?? undefined,
      page: row.page ?? undefined,
      predictedHome: row.predicted_home ?? undefined,
      predictedAway: row.predicted_away ?? undefined,
      joinCode: row.join_code ?? undefined,
      predictGroupMode: row.predict_group_mode ?? undefined,
      predictGroupKey: row.predict_group_key ?? undefined,
      predictGroupPage: row.predict_group_page ?? undefined,
    };
  } catch (error) {
    console.error("[conversation_state] getState failed", {
      phone: maskPhone(phone),
      error,
    });
    return null;
  }
}

export async function clearState(phone: string): Promise<void> {
  const supabase = createAdminClient();

  try {
    await retryOnce(async () => {
      const { error } = await supabase
        .from("whatsapp_conversation_state")
        .delete()
        .eq("phone", phone);
      if (error) throw error;
    });
  } catch (error) {
    console.error("[conversation_state] clearState failed", {
      phone: maskPhone(phone),
      error,
    });
  }
}
