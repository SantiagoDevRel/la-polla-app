// lib/whatsapp/state.ts
//
// Persistent conversation state for multi-step WhatsApp bot flows.
//
// Backed by the public.whatsapp_conversation_state Supabase table created in
// migration 015. Replaces the previous in-memory Map, which was wiped on
// every Vercel Lambda cold start and caused users to lose their place
// mid-prediction or mid-join.
//
// Keyed by phone (E.164 without a leading plus, as Meta delivers). One row
// per active conversation. The TTL is 10 minutes, enforced lazily by the
// read filter (expires_at > now()). Writers refresh the TTL on every
// setState call.
//
// Every function is async and returns a Promise. The public API surface
// mirrors the previous in-memory module so callers only add await.
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
  // Predict flow grouping. The bot asks "¿Por fase o por fecha?" and then
  // lists the groups. Both fields are set when the user picks a group and
  // cleared when the prediction flow exits. Stored as JSON keys on the
  // existing state row so no migration is needed.
  predictGroupMode?: "phase" | "date";
  predictGroupKey?: string;
};

// TTL in minutes. Kept at 10 to preserve the previous in-memory behavior.
const STATE_TTL_MINUTES = 10;

// Retry delay between the initial attempt and the single retry. Short
// enough to stay under Meta's webhook acknowledgement budget, long enough
// to ride out transient network blips against Supabase.
const RETRY_DELAY_MS = 100;

// Row shape as it lives in the Supabase table. snake_case mirrors the SQL
// column names from migration 015.
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
  updated_at: string;
  expires_at: string;
}

/**
 * Runs an async operation once. On failure, waits RETRY_DELAY_MS and tries
 * once more. If the second attempt also fails, re-throws the second error.
 * Centralizes the retry policy so setState, getState, and clearState stay
 * readable and do not diverge on behavior.
 */
async function retryOnce<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (firstErr) {
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    try {
      return await fn();
    } catch (secondErr) {
      // Rethrow the second error; callers decide whether to log, swallow,
      // or propagate. The first error is discarded on purpose since the
      // retry makes it stale context.
      void firstErr;
      throw secondErr;
    }
  }
}

/**
 * Returns the last 4 digits of the phone number, or the original string if
 * shorter than 4. Used only for structured logging so operator dashboards
 * can correlate incidents without logging full PII.
 */
function maskPhone(phone: string): string {
  if (phone.length <= 4) return phone;
  return phone.slice(-4);
}

/**
 * Writes a conversation state row for the given phone. Overwrites any
 * existing row for that phone and refreshes expires_at to now + TTL.
 *
 * Retries once on failure. On second failure, throws. Upstream handlers
 * already wrap their Supabase calls in try/catch, so the throw surfaces as
 * a generic error to the user rather than a silent loss.
 */
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

/**
 * Reads the conversation state for the given phone. Returns null if there
 * is no row, if the row has expired, or if both Supabase attempts fail.
 *
 * Null-to-undefined mapping is intentional: callers that test
 * `if (state.pollaId)` must behave the same way as with the previous
 * in-memory Map where missing keys were undefined.
 */
export async function getState(
  phone: string,
): Promise<ConversationState | null> {
  const supabase = createAdminClient();

  try {
    const row = await retryOnce<StateRow | null>(async () => {
      const { data, error } = await supabase
        .from("whatsapp_conversation_state")
        .select(
          "phone, action, polla_id, match_id, match_index, total_matches, page, predicted_home, predicted_away, join_code, updated_at, expires_at",
        )
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
    };
  } catch (error) {
    console.error("[conversation_state] getState failed", {
      phone: maskPhone(phone),
      error,
    });
    return null;
  }
}

/**
 * Deletes the conversation state row for the given phone. No-op if the
 * row does not exist.
 *
 * Retries once on failure. On second failure, logs and swallows the error:
 * the row will expire via TTL anyway, and failing here would turn a
 * successful user flow into a confusing error message.
 */
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
