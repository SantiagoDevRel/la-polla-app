# Batch 4 Audit: Supabase state migration

Audit-only document. Phase 1 of the migration of WhatsApp bot conversation state from an in-process `Map` to Supabase. Phase 2 (code changes, SQL migration, deploy) is out of scope for this file.

## 1. Current state.ts shape

### Full source (lib/whatsapp/state.ts)

```typescript
// lib/whatsapp/state.ts - Conversation state for multi-step WhatsApp bot flows
// In-memory Map with 10-minute TTL. Fine for MVP; move to Supabase if needed.

interface ConversationState {
  action: string;
  // Most flows pin a specific polla; join-by-code confirmation does not
  // know the polla until the code resolves, so this is optional.
  pollaId?: string;
  matchId?: string;
  // matchIndex / totalMatches track position in the "picking_match" UX
  // only (which match out of how many). They are NOT repurposed for
  // prediction scores anymore - see predictedHome/predictedAway below.
  matchIndex?: number;
  totalMatches?: number;
  page?: number;
  // Set while action === 'confirm_prediction': the pending prediction
  // waiting for the user's SI/NO confirmation.
  predictedHome?: number;
  predictedAway?: number;
  // Set when action === 'waiting_join_confirm': the 6-char code the user
  // sent bare, pending their SI/NO response.
  joinCode?: string;
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
```

Note: the source file in the repo uses em dashes in two inline comments (lines 1 and 11 of `state.ts`). They have been rendered as hyphens in this audit doc to comply with the no-em-dash rule, and Phase 2 should normalize the real source to hyphens when it rewrites the file.

### API surface

| Function | Signature | Returns | Notes |
|---|---|---|---|
| `setState` | `(phone: string, state: Omit<ConversationState, "expires">) => void` | void (synchronous) | Overwrites. Sets `expires = now + 600_000`. |
| `getState` | `(phone: string) => ConversationState \| null` | null if absent or expired | Lazy TTL check on read. Deletes expired entries as a side effect. |
| `clearState` | `(phone: string) => void` | void (synchronous) | No-op when absent. |

### Storage mechanism

Module-level `const store = new Map<string, ConversationState>()`. One Map per Node process. Key is the raw phone number string passed by the Meta webhook (E.164 without a leading `+`, for example `573146167334`). No normalization is applied, so a variant with or without `+` would collide in the Map (not a real concern since Meta always delivers the same format).

### Lifetime

- Per-Lambda-instance. Vercel spawns one Node process per Lambda container; the Map is reset on cold start.
- Entries expire at `Date.now() + 10 * 60 * 1000` (10 minutes) from the last write. TTL is checked only on `getState`, never proactively swept. In a warm Lambda the Map could grow with stale entries until users either return or the container is recycled. Size bound is active-user count, not a memory risk in practice.
- Not shared across Lambda instances. Two concurrent webhook invocations for the same phone can land on different containers and see different states.

## 2. All callers

Every file that imports from `lib/whatsapp/state.ts`.

### lib/whatsapp/bot.ts (11 call sites)

| Line | Call | Reads | Writes | Missing behavior |
|---|---|---|---|---|
| 9 | `import { getState, setState, clearState }` | n/a | n/a | n/a |
| 268 | `getState(from)` inside text prediction branch | action, pollaId, matchId | n/a | Falls through to fallback text. User loses the score they typed. |
| 330 | `getState(from)` inside join-confirm text branch | action, joinCode | n/a | Falls through to fallback text. User typed `si` and sees "no entendí bien". |
| 338 | `clearState(from)` on join-confirm `no` | n/a | deletes key | Safe no-op. |
| 410 | `clearState(from)` in router keepState gate | n/a | deletes key | Safe no-op. |
| 415 | `getState(from)` on `join_code_yes` payload | action, joinCode | n/a | Explicit message: "Parce, se me perdió el código. Mándalo de nuevo porfa." |
| 427 | `clearState(from)` on `join_code_no` payload | n/a | deletes key | Safe no-op. |
| 448 | `clearState(from)` on `rotate_no` payload | n/a | deletes key | Safe no-op. |
| 497 | `getState(from)` on `match_<id>` payload | pollaId | n/a | Handler returns silently. User tapped a match button and nothing happens. |
| 500 | `setState(from, { action: 'waiting_prediction', pollaId, matchId })` | n/a | action, pollaId, matchId | n/a |
| 524 | `getState(from)` on `confirm_yes` payload | action, pollaId, matchId, predictedHome, predictedAway | n/a | Handler returns silently. User tapped `Confirmar`, prediction is not saved, no error shown. |
| 532 | `getState(from)` on `confirm_no` payload | pollaId | n/a | Handler returns silently. User tapped `Cambiar`, nothing happens. |

### lib/whatsapp/flows.ts (6 call sites)

| Line | Call | Action written | Keys written | Notes |
|---|---|---|---|---|
| 10 | `import { clearState, setState }` | n/a | n/a | n/a |
| 323 | `setState(phone, { action, pollaId })` in `handlePollaMenu` | `browsing_polla` | action, pollaId | Written before outbound. |
| 498 | `setState(phone, { action, pollaId, page })` in `handlePronosticar` list view | `picking_match` | action, pollaId, page | |
| 556 | `setState(phone, { action, pollaId, matchId, matchIndex, totalMatches })` in `showPredictionPrompt` | `waiting_prediction` | action, pollaId, matchId, matchIndex, totalMatches | Only writer for matchIndex/totalMatches. |
| 679 | `setState(phone, { action, pollaId, matchId, predictedHome, predictedAway })` in `handlePredictionInput` | `confirm_prediction` | action, pollaId, matchId, predictedHome, predictedAway | |
| 1260 | `setState(phone, { action, joinCode })` in `handleJoinByCodeConfirm` | `waiting_join_confirm` | action, joinCode | Only write without pollaId. |
| 1281 | `clearState(phone)` in `handleJoinByCode` | n/a | deletes key | Deliberate: consume pending code exactly once. |

## 3. Cold-start failure modes

The underlying defect is that state.ts holds state in a `Map` scoped to a single Lambda container. Vercel spins up, reuses, and tears down containers at its own discretion. Concrete failure scenarios below.

### Scenario A: user goes idle and returns to a cold Lambda

1. User 573146167334 taps `Predecir`, picks a match. Bot writes `waiting_prediction` state to container L1.
2. User steps away for 20 minutes. Vercel spins down L1 (or a deploy happens).
3. User types `2-1`. Webhook wakes a fresh container L2. `getState(from)` at `bot.ts:268` returns null.
4. The `if (state && state.action === 'waiting_prediction')` guard at `bot.ts:269` fails.
5. The text `2-1` falls through every regex below (no `/unirse/`, not `unirse XXXXXX`, not a 6-char code, not `ayuda`, not `perfil`, not `hola`) and lands on the fallback at `bot.ts:374-379`.

What the user sees: the generic fallback text that begins with `Parce, no entendí bien. Escribe *menu* para ver las opciones o *ayuda* si tenés dudas.` (the source copy also includes a thinking-face emoji which is preserved in the code but omitted here per the no-emoji doc rule).

What Vercel logs show: `[WA] Incoming from: 573146167334 | type: text`. No error. No warning. Silent loss.

Existing fallback: none. The 10-minute TTL is irrelevant here because the state was wiped before TTL mattered.

Note: even a warm Lambda after exactly 10 minutes behaves the same way because of the lazy TTL check. But the cold-start case happens much more frequently in production than the TTL-expiry case.

### Scenario B: concurrent webhook invocations land on different containers

1. User taps `Confirmar` (`confirm_yes` payload) at t=0. Meta delivers to container L1. L1 reads state OK and begins `handleConfirmPrediction`.
2. WhatsApp retries (for example because the 200 OK did not reach Meta within the acknowledgement window, or the user double-tapped). Meta delivers the same event to container L2 at t=200ms.
3. L2 reads state at `bot.ts:524`. L2 has never seen this phone. `getState` returns null. L2 returns silently.
4. L1 finishes, upserts prediction with `onConflict: "polla_id,user_id,match_id"`. DB wins.

What the user sees in scenario B: in the happy case, the success text arrives from L1 and the duplicate from L2 was a no-op, so the user notices nothing. In the bad case, L1 was slower than L2 (for example L1 was cold and L2 warm), the retry raced ahead, and the user saw the silent-failure branch first, then the success text. Ordering is not guaranteed.

What Vercel logs show: two entries for `confirm_yes`, one with a successful upsert, one with a silent early return. Without structured logging tagging state-miss events, these are indistinguishable from normal traffic.

Existing fallback: the DB upsert is idempotent thanks to the unique constraint on `(polla_id, user_id, match_id)`, so no data corruption. Only UX is at risk.

### Scenario C: Vercel deploy mid-conversation

1. User is in `waiting_join_confirm` state on container L1 (code stored in memory).
2. Deploy rolls out at t=5s.
3. All existing Lambda containers are retired. New containers L2, L3, ... come up with empty `store` Maps.
4. User taps `Sí, unirme` button.
5. `bot.ts:415` runs on L2: `getState` returns null. Handler sends `"Parce, se me perdió el código. Mándalo de nuevo porfa."` and returns.

What the user sees: the polite ask-again text. This is the one branch that at least admits the state miss.

What Vercel logs show: standard request, no error. No trace that state was lost to a deploy.

Existing fallback: only for this specific branch. Every other state-dependent branch in the table above silently no-ops on miss.

### Matrix of state-miss user experience

| Trigger | Line | On miss |
|---|---|---|
| Text `H-A` during prediction | bot.ts:268 | Silent, generic fallback text. Loses the score. |
| Text `si` during join confirm | bot.ts:330 | Silent, generic fallback text. |
| Payload `join_code_yes` | bot.ts:415 | "Parce, se me perdió el código" (explicit recovery). |
| Payload `match_<id>` | bot.ts:497 | Silent return, zero output. |
| Payload `confirm_yes` | bot.ts:524 | Silent return, prediction NOT saved. |
| Payload `confirm_no` | bot.ts:532 | Silent return, zero output. |

The highest-impact miss is `confirm_yes` at `bot.ts:524`: the user actively tapped the confirm button and got nothing, and their prediction is lost.

## 4. Proposed Supabase table

### Table name

`whatsapp_conversation_state`.

Justification: existing convention in the codebase uses `whatsapp_messages` for the message log table. `whatsapp_conversation_state` matches the naming pattern, is self-describing, and avoids the shorter `bot_state` which could collide with future bot features unrelated to the conversation (analytics, session metrics, and so on).

### Columns

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| `phone` | `varchar` | `PRIMARY KEY`, `NOT NULL` | The Meta-delivered phone string. Unique per user. Natural key so we avoid a synthetic id. |
| `action` | `varchar(40)` | `NOT NULL` | The state machine state: `browsing_polla`, `picking_match`, `waiting_prediction`, `confirm_prediction`, `waiting_join_confirm`. |
| `polla_id` | `uuid` | nullable | FK-shaped but kept as plain `uuid` for speed; adding a FK constraint to `pollas` would require ON DELETE handling and blocks fast writes. Nullable because `waiting_join_confirm` does not know the polla. |
| `match_id` | `uuid` | nullable | Same FK-shape choice. |
| `match_index` | `smallint` | nullable | Picker UX counter. |
| `total_matches` | `smallint` | nullable | Picker UX counter. |
| `page` | `smallint` | nullable | Pagination page index (0-based). |
| `predicted_home` | `smallint` | nullable, `CHECK (predicted_home BETWEEN 0 AND 20)` | Pending score home. |
| `predicted_away` | `smallint` | nullable, `CHECK (predicted_away BETWEEN 0 AND 20)` | Pending score away. |
| `join_code` | `varchar(6)` | nullable | 6-char code from the join-code alphabet. Exactly the shape `validateJoinCodeFormat` enforces. |
| `updated_at` | `timestamptz` | `NOT NULL DEFAULT now()` | For debugging and for lazy-cleanup query filters. |
| `expires_at` | `timestamptz` | `NOT NULL` | `now() + interval '10 minutes'` on every write. Used by both the read-time filter and the cleanup job. |

### Indexes

- Primary key on `phone` covers the main lookup (`getState(phone)`). No additional index needed for reads.
- Partial index on `expires_at` for the cleanup path: `CREATE INDEX idx_wa_conv_state_expires ON whatsapp_conversation_state (expires_at)`. The table stays small (bounded by active users in the last 10 minutes), so even a full scan is cheap; the index is cheap insurance.

### RLS policies

- `ALTER TABLE whatsapp_conversation_state ENABLE ROW LEVEL SECURITY;`
- No `FOR SELECT`, `FOR INSERT`, `FOR UPDATE`, or `FOR DELETE` policies for `authenticated` or `anon`. The service role bypasses RLS, so bot writes still work. This mirrors `otp_rate_limits` from migration 006.
- Rationale: this data is conversation scratch space. It is never surfaced to end users via the web app. Locking it down to service-role-only removes any accidental leak path.

### TTL strategy

Three options compared:

1. **Lazy cleanup on read.** `getState` filters `WHERE phone = $1 AND expires_at > now()` and returns null if empty. A background job (or not) deletes expired rows separately.
   - Pro: zero write amplification, simplest code. Matches the current `state.ts` behavior exactly.
   - Con: expired rows accumulate. With bounded active users (say 10k), this is a few hundred rows at most, negligible.
2. **pg_cron periodic delete.** Add a pg_cron job that runs every minute: `DELETE FROM whatsapp_conversation_state WHERE expires_at < now()`.
   - Pro: table stays tidy. Useful if the table ever grows beyond expectations.
   - Con: requires pg_cron extension (Supabase supports it on paid tier). Infra dependency. Overkill for a table that will have at most a few thousand rows.
3. **Trigger-based cleanup on write.** Before INSERT, delete expired rows.
   - Pro: no extension, no background worker.
   - Con: adds a scan to every write path. Scans a small table, so in practice cheap, but conceptually couples the write latency to the cleanup cost.

Recommendation: **option 1 (lazy on read)** for Phase 2. The read filter is `WHERE phone = $1 AND expires_at > now()`, which the primary key satisfies with an index scan. If table size grows past expectations in Phase 3, add pg_cron as an incremental change without touching the read / write code.

Open question for Santiago: confirm the lazy strategy. If he wants the table scrubbed aggressively, we add pg_cron in the same migration.

## 5. Proposed migration SQL

Draft only. File name would be `supabase/migrations/015_whatsapp_conversation_state.sql`. Conventions match the existing migrations (`006_otp_rate_limits.sql` and `014_add_join_code.sql`).

```sql
-- 015_whatsapp_conversation_state.sql - Persistent conversation state for the
-- WhatsApp bot. Replaces the in-memory Map in lib/whatsapp/state.ts that is
-- wiped on every Vercel Lambda cold start. Keyed by phone (E.164 without
-- leading plus, as Meta delivers). Service-role-only access via RLS.

CREATE TABLE IF NOT EXISTS public.whatsapp_conversation_state (
  phone varchar PRIMARY KEY,
  action varchar(40) NOT NULL,
  polla_id uuid,
  match_id uuid,
  match_index smallint,
  total_matches smallint,
  page smallint,
  predicted_home smallint CHECK (predicted_home IS NULL OR predicted_home BETWEEN 0 AND 20),
  predicted_away smallint CHECK (predicted_away IS NULL OR predicted_away BETWEEN 0 AND 20),
  join_code varchar(6),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

-- Cleanup queries filter by expires_at. Partial index kept small so the main
-- PK-by-phone read path stays cache-friendly.
CREATE INDEX IF NOT EXISTS idx_wa_conv_state_expires
  ON public.whatsapp_conversation_state (expires_at);

COMMENT ON TABLE public.whatsapp_conversation_state IS
  'Conversation state for the WhatsApp bot multi-step flows. Survives Lambda
   cold starts. TTL enforced lazily: readers filter expires_at > now().';

COMMENT ON COLUMN public.whatsapp_conversation_state.phone IS
  'Meta-delivered phone string, E.164 without a leading plus (for example
   573146167334). Natural key, one row per active conversation.';

-- RLS: service role only. No policies for authenticated or anon roles, which
-- mirrors otp_rate_limits (migration 006). Service role bypasses RLS for the
-- bot writes, and end users never need to read this scratch data.
ALTER TABLE public.whatsapp_conversation_state ENABLE ROW LEVEL SECURITY;
```

Optional pg_cron cleanup (kept in a separate statement so Santiago can drop it if the project is on a tier without pg_cron). Not recommended for initial rollout.

```sql
-- Optional: uncomment once pg_cron is enabled. Scrubs expired rows every minute.
-- SELECT cron.schedule(
--   'whatsapp_conversation_state_cleanup',
--   '* * * * *',
--   $$ DELETE FROM public.whatsapp_conversation_state WHERE expires_at < now() $$
-- );
```

## 6. Proposed replacement API for state.ts

### Signature plan

Goal: keep the exported names and argument shapes identical so every current caller compiles with the minimum edit. Only the return type changes because reads become async.

| Current | Proposed | Change |
|---|---|---|
| `setState(phone, state): void` | `setState(phone, state): Promise<void>` | Now async. Every caller must add `await`. |
| `getState(phone): ConversationState \| null` | `getState(phone): Promise<ConversationState \| null>` | Now async. Every caller must add `await`. |
| `clearState(phone): void` | `clearState(phone): Promise<void>` | Now async. Every caller must add `await`. |

Keeping the names and arg lists the same is preferred. It isolates the change to the function bodies inside `state.ts` and to adding `await` at call sites, which is a mechanical edit. If we later want to expose a batched / transactional API (for example to read + write atomically in `bot.ts:497`), we can add new functions alongside.

### Callers that must add `await`

All 17 call sites listed in Section 2:

- `lib/whatsapp/bot.ts`: lines 268, 330, 338, 410, 415, 427, 448, 497, 500, 524, 532 (11 call sites).
- `lib/whatsapp/flows.ts`: lines 323, 498, 556, 679, 1260, 1281 (6 call sites).

Every handler that contains these already returns a Promise, so they can `await` without signature changes. The functions in `state.ts` are the only files whose exported types change.

### Error handling

The current in-memory API cannot fail. The Supabase replacement can fail for three reasons: network error, service outage, or a constraint violation. Options:

- **Fail closed**: on error, `getState` returns null, `setState` throws, `clearState` swallows. This is the simplest contract but turns a Supabase blip into the same UX as a cold start (silent loss).
- **Fail open with in-memory fallback**: keep a one-process Map as a hot cache. On Supabase read failure, serve from the Map if present. On Supabase write failure, write to the Map anyway. Advantage: a short Supabase blip during a turn is invisible. Disadvantage: violates the whole point of the migration and complicates reasoning.
- **Retry with short backoff**: one retry at 100ms before giving up. Cheap, handles transient hiccups. Recommended in combination with fail-closed semantics.

Recommendation for Phase 2: **retry once, then fail closed**, and log every state-miss with a structured tag so we can track the rate in production. On `setState` failure, throw, let the outer handler log, and send the user a generic "algo falló, intentá de nuevo" text. On `getState` failure, return null; callers already handle null (badly, but that is a separate Phase 2 improvement).

Open question for Santiago: is the fail-closed UX acceptable during a Supabase outage, or does he want the Map fallback? Recommend fail-closed for Phase 2, add Map fallback in Phase 3 only if incidents prove it necessary.

### Silent-miss branches that should be upgraded in Phase 2

While we are there, the silent-return branches at `bot.ts:497`, `bot.ts:524`, and `bot.ts:532` should emit a short explanatory text, matching the existing pattern at `bot.ts:418-424`. This is a UX improvement that does not depend on the storage backend but becomes more discoverable once state loss is rare enough that each occurrence matters.

## 7. Risks and edge cases

### Race conditions on concurrent webhooks

Meta may retry a webhook or split events across containers. Two invocations for the same phone can read state, each decide to act, and each write. The existing Map code has the same race in principle but one container usually wins.

With Supabase:
- `getState` returns a snapshot.
- Concurrent `setState` becomes "last write wins" at the DB level (primary key on `phone` means a simple UPSERT overwrites).
- For `handleConfirmPrediction`, the DB `UPSERT` on `predictions` with the unique constraint `(polla_id, user_id, match_id)` neutralizes the worst outcome (duplicate insert). The worst the race can do is save the same prediction twice.
- For `handleJoinByCode`, `clearState` happens at the top, then `joinByCode` rate-limits and inserts the participant. Two concurrent `join_code_yes` payloads are safe: the second will hit the "already a member" branch.

No additional locking is proposed for Phase 2. The shape "readers eventually see consistent state, writers do last-write-wins" is acceptable for this bot.

### State key collisions

Keys are raw phone strings. Collisions would require two users to share a phone number, which is impossible at the WhatsApp level. No real risk.

### Active in-memory states at deploy time

In-memory state lives only inside each warm Lambda container. At the moment Phase 2 deploys:
- Whatever is in each container's Map is discarded.
- The new code reads from Supabase, which is empty for every phone.
- Users mid-conversation experience one failure of the Scenario C variety: they tap a button, hit the null-state path, see either the polite ask-again text (`join_code_yes` only) or the silent branches otherwise.

Impact: at most one failed turn per user who happened to be mid-flow at the deploy moment. No data loss for anything persisted in `predictions` or `polla_participants`. Mitigation: deploy during a low-traffic window, or keep the Map as a last-resort fallback for 24 hours after rollout (that would be a conscious Phase 2 scope add).

### Performance: latency per bot turn

Each handled message currently does zero state I/O in the best case and 1 `getState` + 1 `setState` in the worst case. After the migration that becomes 2 Supabase round trips on the worst path.

Round-trip latency from a Vercel US-East Lambda to Supabase is commonly 10-40 ms per query (connection reuse assumed; `createAdminClient` already reuses `@supabase/supabase-js` clients within a Lambda). The bot makes several DB calls per handler anyway (`verifyMemberAndPolla` alone does 2), so adding 1-2 more is 20-80 ms incremental per turn. Well below Meta's webhook acknowledgement timeout.

Worst case scenario: if the Lambda is cold AND the Supabase connection has to be established, the first query pays an extra connection cost. Existing code already does this for the initial user lookup at `bot.ts:235`, so it is not a new failure mode.

Order of magnitude: an extra 30 ms per turn on average, 100 ms p99. The user does not perceive it.

### Bug discovered during audit (not to be fixed in Phase 1)

`bot.ts:497-507` on the `match_<id>` payload calls `setState` without `await`:

```typescript
setState(from, {
  action: "waiting_prediction",
  pollaId: state.pollaId,
  matchId,
});
await handlePronosticar(from, user.id, state.pollaId, matchId);
```

Today this works because `setState` is synchronous. In Phase 2 it becomes a Promise, so the unawaited call becomes a fire-and-forget write that races with `handlePronosticar`. Phase 2 must add `await` here. Not a current bug; calling this out so Phase 2 does not miss it.

Second note: `bot.ts:500` writes `waiting_prediction` without `matchIndex` / `totalMatches`, unlike `flows.ts:556`. Any consumer that expects `matchIndex` when `action === 'waiting_prediction'` would find it missing. Currently no consumer reads those fields on the text-input path, so no user-facing bug, but it is a latent inconsistency worth noting before the migration tightens state shapes.

## 8. Phase 2 scope estimate

### Files that will change

- `lib/whatsapp/state.ts` - full rewrite. Body changes from Map ops to Supabase calls. Roughly 60-90 lines.
- `lib/whatsapp/bot.ts` - mechanical `await` adds at the 11 call sites listed in Section 2. Approximate diff: +11 lines changed.
- `lib/whatsapp/flows.ts` - same at the 6 call sites. +6 lines changed.
- `supabase/migrations/015_whatsapp_conversation_state.sql` - new migration, roughly 25 lines including comments.
- `CLAUDE.md` - update the reference to `lib/whatsapp/state.ts` at line 379 ("In-memory conversation state with 10min TTL") to describe the new Supabase-backed storage.
- `docs/bot-inventory.md` - refresh section 4 (State module) after the rewrite lands.
- `docs/batch-4-audit.md` - leave this doc alone; Phase 2 can stamp it as "implemented".

Optional:
- Add a Vitest unit test for the new state module if the project has any test harness (audit step did not find one; check before assuming).
- Consider extracting a shared `await`-able cache helper if a future feature wants it. Not scope for this phase.

### Approximate lines of code modified

- Pure code: ~80 lines rewritten in `state.ts`, ~17 `await` edits, ~25 lines of SQL, ~5 lines of doc. Total new and changed lines: around 130.
- Tests and documentation: additional 30-50 lines if we add tests.

### Migration step order

1. Write and review the SQL migration file `015_whatsapp_conversation_state.sql`.
2. Apply the migration against the Supabase project using the existing migration flow (`npx supabase db push` or the equivalent already used by Santiago).
3. Verify in the Supabase dashboard that the table exists, RLS is on, and a manual insert succeeds with the service role.
4. Rewrite `lib/whatsapp/state.ts` to call Supabase. Keep the same exported names and argument shapes, change returns to `Promise`.
5. Add `await` at every call site (bot.ts + flows.ts). Run `npx tsc --noEmit` after each file edit per the project's "one file, one test" rule.
6. Manual smoke test locally with a test phone: start a prediction flow, kill the Next.js dev server, restart it, send the score, confirm the bot still remembers the in-flight match.
7. Merge and deploy. Watch Vercel logs and the Supabase query log for anomalies in the first 15 minutes.
8. Update `CLAUDE.md` and `docs/bot-inventory.md` to reflect the new backing store.

### Testing strategy

Local verification:
- Run `npx tsc --noEmit` with zero errors.
- Use the existing webhook test endpoint (`app/api/whatsapp/test-send/`) or Meta's test phone to exercise one full happy path: menu -> mis pollas -> polla -> predecir -> pick match -> type score -> confirm. Watch that the prediction is persisted.
- Kill the dev server between picking the match and typing the score. Restart. Type the score. The bot should still complete the flow because state now lives in Supabase, not memory.
- Repeat for the join-by-code flow: send a 6-char code, kill the server, restart, tap `Sí, unirme`. Flow should still complete.

Production verification (post-deploy):
- Santiago sends one live message to the bot to confirm the webhook still acknowledges.
- Watch Vercel function logs for any `[WA] Error` prefixes in the first 15 minutes.
- Run a Supabase query against `whatsapp_conversation_state` to confirm rows appear and `expires_at` looks right.
- Check `whatsapp_messages` to confirm outbound messages still log.

### Rollback plan

If Phase 2 breaks production:
1. Revert the PR merge (the `state.ts` rewrite and the `await` edits are in a single commit).
2. Leave the migration table in place. It is dormant without callers.
3. Redeploy the previous main.
4. Diagnose on a branch; no need to drop the table.

The migration can be rolled forward any number of times because `CREATE TABLE IF NOT EXISTS` is idempotent, and the code changes are isolated to the three files above.

## 9. Open questions for Santiago

Numbered so they are easy to reply to.

1. **TTL duration.** Current code uses 10 minutes. Do we keep 10 for the Supabase version, or lengthen to 20-30 minutes now that state survives cold starts? A longer TTL reduces Scenario A pain but keeps state rows around longer between rotations.

2. **Fallback behavior when Supabase is unreachable.** Options are:
   - Fail closed (recommended): return null on read, throw on write, log structured error. One failed turn for the user.
   - Fail open with in-memory Map fallback: one container remembers, others do not. Hybrid, more complex.
   - Which does Santiago prefer?

3. **Immediate clear on flow completion or let TTL handle it?** Today only `handleJoinByCode` calls `clearState` on success. `handleConfirmPrediction` leaves the state for the router's `keepState` gate to clear on the next inbound. With Supabase, should every terminal handler call `clearState` explicitly to keep the table clean, or stay consistent with current behavior?

4. **pg_cron cleanup.** The proposal recommends lazy cleanup on read (Section 4). Does Santiago want us to enable pg_cron and add a once-per-minute DELETE from day one, or defer?

5. **Race-condition guarantee.** The current Map has no lock. The Supabase version will be last-write-wins via UPSERT. Is this acceptable for `confirm_yes` specifically? The DB's unique constraint on `predictions` already prevents duplicates, so the answer is almost certainly yes, but worth confirming before Phase 2.

6. **Silent-failure branches.** The audit found three branches that silently return when state is missing (`bot.ts:497`, `bot.ts:524`, `bot.ts:532`). Should Phase 2 add user-facing recovery text there too, or keep that scope for Phase 3?

7. **Latent inconsistency at `bot.ts:500`.** It writes `waiting_prediction` state without `matchIndex` / `totalMatches`. No user-facing bug today. Should Phase 2 harmonize the state write with `flows.ts:556` so any future code can rely on those fields? Low cost, nice to have.

8. **Deploy window.** Phase 2 has a one-deploy blast radius of at most one failed turn per mid-flow user. Does Santiago want to deploy during a specific low-traffic window, or is anytime fine?
