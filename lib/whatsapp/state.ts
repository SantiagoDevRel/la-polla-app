// lib/whatsapp/state.ts — Conversation state for multi-step WhatsApp bot flows
// In-memory Map with 10-minute TTL. Fine for MVP; move to Supabase if needed.

interface ConversationState {
  action: string;
  pollaId: string;
  matchId?: string;
  matchIndex?: number;
  totalMatches?: number;
  expires: number;
}

const STATE_TTL = 10 * 60 * 1000; // 10 minutes
const store = new Map<string, ConversationState>();

export function setState(phone: string, state: Omit<ConversationState, "expires">) {
  store.set(phone, { ...state, expires: Date.now() + STATE_TTL });
}

export function getState(phone: string): ConversationState | null {
  const entry = store.get(phone);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    store.delete(phone);
    return null;
  }
  return entry;
}

export function clearState(phone: string) {
  store.delete(phone);
}
