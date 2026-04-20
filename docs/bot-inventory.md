# Bot Inventory

Audit snapshot of the La Polla WhatsApp bot. Regenerated as part of Batch 4 Phase 1 (Supabase state migration audit). This document is a static map of the current bot surface, not a design spec. For the migration plan see `docs/batch-4-audit.md`.

Scope: every code path reachable from the WhatsApp webhook, every function that reads or writes conversation state, and every helper shared with the web app.

All line numbers are accurate at the time of generation. Paths are relative to the repo root.

## 1. Entry point

**File:** `app/api/whatsapp/webhook/route.ts`

Next.js App Router route handler with `dynamic = "force-dynamic"`. Meta Cloud API (WhatsApp Business) is configured to call this URL.

- `GET` handler: Meta subscription verification. Compares `hub.verify_token` against `META_WA_WEBHOOK_VERIFY_TOKEN`. Returns the `hub.challenge` string on match, `403` otherwise.
- `POST` handler: inbound message delivery. Flow:
  1. Read raw request body as text (required for HMAC).
  2. Verify `X-Hub-Signature-256` against HMAC-SHA256(rawBody, `META_WA_APP_SECRET`) using `timingSafeEqual`. If `META_WA_APP_SECRET` is unset, a warning is logged and verification is skipped (development affordance).
  3. `JSON.parse` the raw body. Reject 400 on parse failure.
  4. If `body.object !== "whatsapp_business_account"`, acknowledge with `{ status: "ok" }` (Meta pings and unrelated events).
  5. Dig into `body.entry[0].changes[0].value.messages[0]`.
  6. If a message is present, call `processIncomingMessage({ from, type, text, interactive, wa_message_id })` and await.
  7. Respond `{ status: "ok" }` in all cases so Meta does not retry.
  8. Any thrown error is logged and returned as `500`.

Notable properties:
- Signature verification uses constant-time compare, buffers must be equal length first.
- Status updates and delivery receipts land here but are filtered out at step 5 (no `messages[0]`).
- The handler awaits `processIncomingMessage` before acknowledging. That coupling matters for the Supabase migration: any added latency per state read or write is paid inside Meta's ~20s webhook timeout.

## 2. Router

**File:** `lib/whatsapp/bot.ts`

Two-level router: text triage in `processIncomingMessage`, payload id dispatch in `routePayload`.

### Exported functions

| Symbol | Signature | Purpose |
|---|---|---|
| `sendTextMessage` | `(to, text) => Promise` | Plain text outbound via Meta Graph API. |
| `sendButtonMessage` | `(to, header, body, buttons) => Promise` | Interactive button message (caps at 3 buttons, 20-char titles). |
| `sendListMessage` | `(to, header, body, buttonText, items) => Promise` | Interactive list (caps at 10 rows). |
| `sendWhatsAppMessage` | `(to, text) => Promise` | Backwards-compatible alias for `sendTextMessage` used by the OTP flow. |
| `processIncomingMessage` | `(message: IncomingMessage) => Promise<void>` | Top-level entry called by the webhook. |

### processIncomingMessage dispatch table

Order matters. First match wins and the function returns.

| Condition | Line | Handler |
|---|---|---|
| Any inbound, a pending OTP row exists for the phone | `bot.ts:210-231` | Inline: `sendCTAButton` with OTP, `markOTPSent`. |
| User lookup by `whatsapp_number` returns no row | `bot.ts:242` | `handleUnknownUser` |
| `type === "interactive"` with `button_reply` or `list_reply` | `bot.ts:248` | `routePayload` with the reply id |
| `type === "text"` and body === `codigo` or `código` (lowercased) | `bot.ts:261` | Inline: `generateOTP`, `sendTextMessage(getOTPMessage)` |
| `type === "text"` and state.action === `waiting_prediction` and body === `cancelar` | `bot.ts:268-281` | `handleCancelPrediction` |
| `type === "text"` and state.action === `waiting_prediction` and body matches `^(\d{1,2})-(\d{1,2})$` (bounds 0 to 20) | `bot.ts:282-307` | `handlePredictionInput` |
| text contains `/unirse/<slug>` or `/pollas/<slug>` | `bot.ts:311-317` | `handleJoinPolla` |
| text matches `^unirse\s+([a-z0-9]{6})$` | `bot.ts:321-325` | `handleJoinByCode` |
| state.action === `waiting_join_confirm` and body is `si` or `sí` or `yes` | `bot.ts:330-336` | `handleJoinByCode` (uses `state.joinCode`) |
| state.action === `waiting_join_confirm` and body === `no` | `bot.ts:337-341` | Inline: `clearState` plus "Listo parce, no te uniste" text |
| text matches `^[abcdefghjklmnpqrstuvwxyz23456789]{6}$` (bare code in the alphabet) | `bot.ts:350-354` | `handleJoinByCodeConfirm` |
| text in `["ayuda","help"]` | `bot.ts:357` | `handleHelp` |
| text in `["perfil","profile"]` | `bot.ts:363` | `handleProfile` |
| text in `["hola","hi","inicio","menu","menú"]` | `bot.ts:369` | `handleMainMenu` |
| any other text | `bot.ts:374-379` | Fallback text |
| any other message type | `bot.ts:382-386` | Fallback text |

### routePayload dispatch table

Triggered only by `interactive` replies. First action is the `keepState` gate at `bot.ts:398-411`: unless the payload matches one of `pred_next_*`, `match_*`, `more_*`, `confirm_yes`, `confirm_no`, `join_code_yes`, `join_code_no`, `rotate_confirm_*`, `rotate_yes_*`, `rotate_no`, the router calls `clearState(from)` before dispatching. This is the primary place state is cleared between turns.

| Payload pattern | Line | Handler |
|---|---|---|
| `join_code_yes` | `bot.ts:414-425` | `handleJoinByCode` using `state.joinCode`, or an error text if state is gone |
| `join_code_no` | `bot.ts:426-433` | `clearState` plus text |
| `rotate_confirm_<pollaId>` | `bot.ts:437-441` | `handleRotateCodeConfirm` |
| `rotate_yes_<pollaId>` | `bot.ts:442-446` | `handleRotateCode` |
| `rotate_no` | `bot.ts:447-451` | `clearState` plus text |
| `menu` | `bot.ts:453` | `handleMainMenu` |
| `menu_mis_pollas` or `mis_pollas` | `bot.ts:459` | `handleMisPollas` |
| `menu_predecir` or `pronosticar` | `bot.ts:464` | `handleMisPollas` (intentional alias so the user picks a polla first) |
| `menu_tabla` or `tabla` | `bot.ts:469` | `handleMisPollas` (same aliasing) |
| `polla_<id>` | `bot.ts:474` | `handlePollaMenu` |
| `pred_<id>` or `pred_next_<id>` | `bot.ts:480` | `handlePronosticar` |
| `more_<pollaId>_<page>` | `bot.ts:487-494` | `handlePronosticar` with `page` |
| `match_<id>` | `bot.ts:496-508` | Reads state to pin `pollaId`, writes new state with `action: "waiting_prediction"`, calls `handlePronosticar(specificMatchId)` |
| `rank_<id>` | `bot.ts:510` | `handleLeaderboard` |
| `results_<id>` | `bot.ts:516` | `handleResults` |
| `confirm_yes` | `bot.ts:523-529` | `handleConfirmPrediction` using state |
| `confirm_no` | `bot.ts:531-537` | Re-enters `handlePronosticar` |
| `menu_ayuda` | `bot.ts:540` | `handleHelp` |
| `help_<topic>` | `bot.ts:545` | `handleHelpTopic` |
| `menu_perfil` or `help_perfil` | `bot.ts:551` | `handleProfile` |
| any other | `bot.ts:556` | `handleMainMenu` |

### Internal helpers in bot.ts

- `callMetaAPI(to, payload)`: POSTs to `https://graph.facebook.com/v21.0/<META_WA_PHONE_NUMBER_ID>/messages`. Logs error status + Meta error body before rethrowing.
- `logMessage(phone, direction, messageType, content)`: inserts a `whatsapp_messages` row via service role. Looks up `user_id` by phone but accepts null. Content is truncated at 1000 chars. Swallows errors.

### Module-level side effects

`bot.ts:36-45` validates `META_WA_ACCESS_TOKEN` and `META_WA_PHONE_NUMBER_ID` at import time and throws if either is missing. This fails the Lambda cold start fast rather than letting every outbound return 404.

## 3. Flows

**File:** `lib/whatsapp/flows.ts`

Every exported handler is listed below. For each, the state interactions are the contract the Supabase migration must preserve.

### handleMainMenu(phone, displayName) - `flows.ts:192`

- Trigger: text menu keywords, payload `menu`, default fallback.
- State: does not read or write state. Assumes the router cleared it upstream.
- DB: none.
- Outbound: reply buttons greeting with `Mis Pollas`, `Predecir`, `Ver Tabla`. Uses `needsName(displayName)` to decide whether to address the user by name or as `parcero`.

### handleUnknownUser(phone) - `flows.ts:214`

- Trigger: user row not found.
- State: none.
- DB: none.
- Outbound: welcome text plus CTA to `APP_URL` to sign up.

### handleMisPollas(phone, userId) - `flows.ts:232`

- Trigger: `menu_mis_pollas`, `mis_pollas`, `menu_predecir`, `pronosticar`, `menu_tabla`, `tabla`, and help topics `help_pollas`, `help_predicciones`, `help_tabla`.
- State: does not read or write state.
- DB reads: `polla_participants` for active approved memberships, `pollas` filtered by id and `status='active'`, a second `polla_participants` query to count members per polla.
- Outbound: list message with one row per active polla, or an empty-state CTA.

### handlePollaMenu(phone, userId, pollaId) - `flows.ts:313`

- Trigger: payload `polla_<id>`.
- State writes: `setState(phone, { action: "browsing_polla", pollaId })` at `flows.ts:323`. Written before the outbound so a lost send still leaves a well-formed state row.
- DB reads: `verifyMemberAndPolla` (polla lookup + participant row + optional payment gate).
- Branches:
  - Polla ended: sends buttons `Ver Tabla` + `Resultados` only.
  - Participant role === `admin`: list message with 4 rows including `Rotar código`.
  - Otherwise: reply buttons `Predecir`, `Ver Tabla`, `Resultados`.

### handlePronosticar(phone, userId, pollaId, specificMatchId?, page=0) - `flows.ts:390`

- Trigger: `pred_<id>`, `pred_next_<id>`, `more_<pollaId>_<page>`, `match_<id>` (router sets state first), `confirm_no` (loops back), `help_predicciones` via aliasing.
- Side effect: fire-and-forget `ensureMatchesFresh()` at entry.
- State writes:
  - Path A, list view: `setState(phone, { action: "picking_match", pollaId, page })` at `flows.ts:498`.
  - Path B, prompt view (via `showPredictionPrompt`): `setState(phone, { action: "waiting_prediction", pollaId, matchId, matchIndex, totalMatches })` at `flows.ts:556`.
- DB reads: `matches` filtered either by `polla.match_ids` or `polla.tournament`, `scheduled_at` gated 5 minutes ahead. Then `predictions` for the user-polla to mark already-predicted rows.
- Outbound: list with up to 9 matches plus optional `Ver más partidos` row for pagination, or a prompt asking for a `H-A` score.

### showPredictionPrompt (internal, `flows.ts:542`)

- Used only by `handlePronosticar` and by the router's `match_<id>` branch.
- Writes state `waiting_prediction` (same shape as above) and fetches existing prediction to surface it for overwrite-or-cancel UX.

### handleCancelPrediction(phone, userId, pollaId, matchId) - `flows.ts:609`

- Trigger: text `cancelar` while state.action === `waiting_prediction`.
- State: does not write. Router clears state after the text input branch returns (not applicable here, see Cold-start failure modes in the audit).
- DB reads: `matches` plus `predictions` to format the confirmation.
- Outbound: one text, then re-enters `handlePollaMenu` which rewrites state to `browsing_polla`.

### handlePredictionInput(phone, user, pollaId, matchId, predictedHome, predictedAway) - `flows.ts:645`

- Trigger: text matching `^\d{1,2}-\d{1,2}$` with both parts <= 20, inside `waiting_prediction`.
- State writes: `setState(phone, { action: "confirm_prediction", pollaId, matchId, predictedHome, predictedAway })` at `flows.ts:679`.
- DB reads: `matches` for lock-time check.
- Validation: 5-minute lock gate (`match.status !== 'scheduled'` or within 5 min of kickoff) emits a closed-match text and stops.
- Outbound: reply buttons `Confirmar` / `Cambiar`.

### handleConfirmPrediction(phone, user, state) - `flows.ts:704`

- Trigger: payload `confirm_yes`.
- State reads: expects `state.pollaId`, `state.matchId`, `state.predictedHome`, `state.predictedAway` to be present (caller guarantees the `confirm_prediction` action).
- DB reads: `matches` for re-check of lock window.
- DB writes: upsert into `predictions` with `onConflict: "polla_id,user_id,match_id"`.
- State clear: does not call `clearState` explicitly. Relies on the router's `keepState` gate to clear on the next inbound that is not `pred_next_`, `match_`, etc.
- Outbound: success text with `Siguiente` and `Menú` buttons.

### handleLeaderboard(phone, userId, pollaId) - `flows.ts:782`

- Trigger: payload `rank_<id>`.
- Side effect: `ensureMatchesFresh()`.
- State: none.
- DB reads: `polla_participants` top 5 by rank, `predictions` counts per user, a second round-trip for the caller's rank if they are outside top 5.
- Outbound: formatted table via `formatTablaWA`, plus CTA button to the web.

### handleResults(phone, userId, pollaId) - `flows.ts:879`

- Trigger: payload `results_<id>`.
- Side effect: `ensureMatchesFresh()`.
- State: none.
- DB reads: last 5 finished `matches` filtered by `polla.match_ids` or `polla.tournament`, then user's `predictions` for those matches, then the user's `polla_participants.total_points`.
- Outbound: one text with scores, the user's prediction, and points earned per match.

### handleJoinPolla(phone, user, slug) - `flows.ts:970`

- Trigger: text containing `/unirse/<slug>` or `/pollas/<slug>`.
- State: none.
- DB reads: `pollas` by slug, existing membership check.
- DB writes: `polla_participants` insert on new join (status `approved`, paid depends on `payment_mode === 'digital_pool'`).
- Outbound: welcome + predict buttons, or pay-first CTA for digital pool pollas.

### handleHelp(phone) - `flows.ts:1082`

- Trigger: text `ayuda` or `help`, payload `menu_ayuda`.
- State: none.
- DB: none.
- Outbound: help list with two sections.

### handleHelpTopic(phone, user, topic) - `flows.ts:1136`

- Trigger: payload `help_<topic>`.
- State: none.
- DB: none directly.
- Branches: `help_puntaje` (scoring rules text), `help_crear` (creation CTA), `help_pollas` / `help_predicciones` / `help_tabla` (delegate to `handleMisPollas`), otherwise `handleHelp`.

### handleProfile(phone, userId) - `flows.ts:1187`

- Trigger: text `perfil` or `profile`, payload `menu_perfil` or `help_perfil`.
- State: none.
- DB reads: `users.display_name`, `polla_participants` for active count + best rank, `predictions` for total count.
- Outbound: stats text plus CTA to `/perfil` in the web app.

### handleJoinByCodeConfirm(phone, code) - `flows.ts:1251`

- Trigger: bare 6-char text matching the join-code alphabet.
- Validation: `validateJoinCodeFormat(normalized)` rejects codes that do not match the alphabet exactly.
- State writes: `setState(phone, { action: "waiting_join_confirm", joinCode: normalized })` at `flows.ts:1260`. Note: this is the only flow that writes state without a `pollaId` since the polla is not yet known.
- Outbound: reply buttons `Sí, unirme` / `No`.

### handleJoinByCode(phone, userId, code) - `flows.ts:1276`

- Trigger: explicit `unirse CODIGO` text, `si` / `sí` / `yes` text in confirm state, or payload `join_code_yes`.
- State writes: `clearState(phone)` at the top of the handler (`flows.ts:1281`). This is deliberate: once the join is attempted, the pending code must not linger.
- Delegates to `joinByCode` in `lib/pollas/join.ts`. Translates result discriminant to Spanish copy.

### handleRotateCodeConfirm(phone, userId, pollaId) - `flows.ts:1369`

- Trigger: payload `rotate_confirm_<pollaId>`.
- Admin gate: `assertPollaAdmin` re-checks `polla_participants.role === 'admin'`. Handler returns silently (after a Spanish refusal) if not admin.
- State: none.
- Outbound: reply buttons `Sí, rotar` / `No`.

### handleRotateCode(phone, userId, pollaId) - `flows.ts:1395`

- Trigger: payload `rotate_yes_<pollaId>`.
- Admin gate: same `assertPollaAdmin` as above (defense in depth so a forged `rotate_yes_` payload cannot bypass confirm).
- Delegates to `rotateJoinCode(admin, pollaId)` in `lib/pollas/rotate-code.ts`.
- Outbound: new code text plus CTA button.

### Helper: assertPollaAdmin (internal, `flows.ts:1335`)

- Verifies polla exists and that `(user, polla)` is `role: 'admin'`. Returns `null` after sending a Spanish refusal, or `{ polla }`. Logic is byte-identical to the web rotate route.

### Helper: verifyMemberAndPolla (internal, `flows.ts:146`)

- Verifies polla exists, caller is an approved participant, and (for `payment_mode: 'digital_pool'`) payment is approved. Sends the appropriate refusal text and returns null on failure.

### Constants and maps in flows.ts

- `APP_URL`: env `NEXT_PUBLIC_APP_URL` with `https://la-polla.vercel.app` fallback.
- `FOOTER`: static footer string used across interactive messages.
- `PAGE_SIZE`: 9 rows per list page (1 slot reserved for the `Ver más partidos` row).
- `TRN_LABELS`: tournament label lookup for `worldcup_2026`, `champions_2025`, `liga_betplay_2025`.
- `TEAM_FLAG_MAP`: country name to flag lookup used by `getTeamFlag`, normalized via `trim().toLowerCase()`.

## 4. State module

**File:** `lib/whatsapp/state.ts`

### ConversationState shape (internal interface)

- `action: string`
- `pollaId?: string`
- `matchId?: string`
- `matchIndex?: number`
- `totalMatches?: number`
- `page?: number`
- `predictedHome?: number`
- `predictedAway?: number`
- `joinCode?: string`
- `expires: number`

### Exported API

| Function | Signature | Behavior |
|---|---|---|
| `setState` | `(phone: string, state: Omit<ConversationState, "expires">) => void` | `store.set(phone, { ...state, expires: Date.now() + 600_000 })`. Synchronous. Overwrites any prior state for the phone. |
| `getState` | `(phone: string) => ConversationState \| null` | Reads, returns null if absent. If `expires` is in the past, deletes the entry and returns null (lazy expiry). |
| `clearState` | `(phone: string) => void` | `store.delete(phone)`. Synchronous. No-op when absent. |

### Storage mechanism

In-process `Map<string, ConversationState>` declared as `const store = new Map(...)` at module top level (`state.ts:27`). One Map per Node process.

### Key format

The key is the raw phone number string passed in by the webhook (Meta delivers E.164 without a leading plus, for Colombia typically `57<national number>`). No normalization is applied. Callers pass `message.from` directly.

### Lifetime

- Per-Lambda-instance. Vercel runs one Node process per Lambda container; the Map is reset on cold start.
- Entries TTL at `Date.now() + 600_000` (10 minutes) from last write. TTL is checked only on read, never proactively swept. In a warm Lambda the Map could accumulate stale entries between reads, bounded by active users times state writes per turn.
- Not shared across Lambda instances. Two concurrent invocations of the same webhook for the same phone can land on different containers and see different states.

## 5. Every call site of state.ts

All call sites live in `lib/whatsapp/bot.ts` and `lib/whatsapp/flows.ts`. Listed in file order.

### lib/whatsapp/bot.ts

#### bot.ts:268 - `getState(from)` inside text prediction branch

- Reads: full state object. Expects `state.action === 'waiting_prediction'` and `state.pollaId`. Accesses `state.matchId!` (non-null assertion) when dispatching to `handlePredictionInput` / `handleCancelPrediction`.
- Missing behavior: if state is null, the `if (state && state.action === ...)` guard skips the branch, and the message falls through to later branches (join link, bare code, keyword, fallback). Typically the user then sees the generic fallback text because their `H-A` text matches nothing else. **User experience: silent loss of the score they just typed.**

#### bot.ts:330 - `getState(from)` inside join-confirm text branch

- Reads: expects `state.action === 'waiting_join_confirm'` and `state.joinCode`.
- Missing behavior: branch skipped. `si`/`no` text then falls through to the bare-code regex (which will not match "si"), the menu keyword list, and finally the fallback. **User experience: the user typed `si` expecting a join and gets a generic "no entendí bien" reply.**

#### bot.ts:338 - `clearState(from)` on join-confirm "no"

- Writes: deletes key. Safe no-op if missing.

#### bot.ts:410 - `clearState(from)` in router `keepState` gate

- Writes: deletes key when the incoming payload is not in the keep-list. Safe no-op.

#### bot.ts:415 - `getState(from)` inside `join_code_yes` payload branch

- Reads: expects `state.action === 'waiting_join_confirm'` and `state.joinCode`.
- Missing behavior: handler sends `"Parce, se me perdió el código. Mándalo de nuevo porfa."` and returns (`bot.ts:418-424`). This is the only branch that explicitly surfaces a state-miss to the user. **User experience: a polite ask to resend.**

#### bot.ts:427 - `clearState(from)` on `join_code_no` payload

- Writes: safe no-op.

#### bot.ts:448 - `clearState(from)` on `rotate_no` payload

- Writes: safe no-op.

#### bot.ts:497-507 - `getState(from)` and `setState(from, ...)` on `match_<id>` payload

- Reads: requires `state.pollaId` to be set (must have been `picking_match` or `browsing_polla`).
- Writes: `setState(from, { action: "waiting_prediction", pollaId: state.pollaId, matchId })` at `bot.ts:500`.
- Missing behavior: if state is null or `state.pollaId` is missing, the handler returns silently without sending any message. **User experience: the user tapped a match button and nothing happens. No error text, no recovery path. This is the worst silent-failure site.**

#### bot.ts:524 - `getState(from)` on `confirm_yes` payload

- Reads: expects `state.action === 'confirm_prediction'` and `state.pollaId` (plus `matchId`, `predictedHome`, `predictedAway` asserted by `handleConfirmPrediction`).
- Missing behavior: guard fails, handler returns silently. **User experience: user tapped `Confirmar` and nothing happens.** The prediction is not saved. This is a high-impact silent loss.

#### bot.ts:532 - `getState(from)` on `confirm_no` payload

- Reads: expects `state.pollaId`.
- Missing behavior: guard fails, handler returns silently. **User experience: user tapped `Cambiar` and nothing happens.**

### lib/whatsapp/flows.ts

#### flows.ts:323 - `setState` with `action: 'browsing_polla'`

- Writes: `{ action, pollaId }`. Called on entry to the polla menu.
- Missing-read impact: none here, it is a write.

#### flows.ts:498 - `setState` with `action: 'picking_match'`

- Writes: `{ action, pollaId, page }`. Called when rendering the match list.

#### flows.ts:556 - `setState` with `action: 'waiting_prediction'`

- Writes: `{ action, pollaId, matchId, matchIndex, totalMatches }`. Called from `showPredictionPrompt` after a specific match is picked or auto-selected.

#### flows.ts:679 - `setState` with `action: 'confirm_prediction'`

- Writes: `{ action, pollaId, matchId, predictedHome, predictedAway }`. Called after a valid score is received.

#### flows.ts:1260 - `setState` with `action: 'waiting_join_confirm'`

- Writes: `{ action, joinCode }`. The only state write without `pollaId`.

#### flows.ts:1281 - `clearState(phone)`

- Writes: deletes key at the top of `handleJoinByCode`. Ensures the pending code is consumed exactly once.

### Summary of state keys per action

| action | Keys written | Keys read | Writer line | Reader lines |
|---|---|---|---|---|
| `browsing_polla` | pollaId | pollaId | flows.ts:323 | bot.ts:497 |
| `picking_match` | pollaId, page | pollaId | flows.ts:498 | bot.ts:497 |
| `waiting_prediction` | pollaId, matchId, matchIndex?, totalMatches? | pollaId, matchId | flows.ts:556, bot.ts:500 | bot.ts:268 |
| `confirm_prediction` | pollaId, matchId, predictedHome, predictedAway | pollaId, matchId, predictedHome, predictedAway | flows.ts:679 | bot.ts:524 |
| `waiting_join_confirm` | joinCode | joinCode | flows.ts:1260 | bot.ts:330, bot.ts:415 |

## 6. Helper modules referenced elsewhere

### lib/users/needs-name.ts

Purpose: one-liner predicate used by `/onboarding` (web) and `handleMainMenu` (bot) to decide whether the stored `display_name` is usable as a greeting or whether the user still needs to set a real name.

Exports:
- `needsName(displayName: string | null | undefined): boolean` - true when display name is missing, blank, or matches `^\d{8,15}$` after stripping an optional leading `+`. This covers raw-phone fallbacks such as `573146167334` and `+573146167334`.
- `DISPLAY_NAME_MIN = 2`, `DISPLAY_NAME_MAX = 50` - validation bounds mirrored in the zod schema at `app/api/users/me`.
- `isValidDisplayName(candidate: string): boolean` - returns true when the candidate passes trim, length bounds, and is not itself phone-shaped.

Consumed by:
- `lib/whatsapp/flows.ts:195` (inside `handleMainMenu`).
- `app/onboarding/*` (web), enforcing the same gate.

### lib/pollas/rotate-code.ts

Purpose: atomically rotate a polla's `join_code` to a fresh value. Shared by `app/api/pollas/[slug]/rotate-code/route.ts` (web) and `handleRotateCode` (bot) so the two surfaces do not drift on behavior.

Exports:
- `rotateJoinCode(admin: SupabaseClient, pollaId: string): Promise<RotateJoinCodeResult>` where `RotateJoinCodeResult` is `{ ok: true, code: string } | { ok: false, reason: "generation_failed" | "update_failed" }`.

Behavior:
- Calls `generateUniqueJoinCode(admin)` from `join-code.ts`. On throw, returns `generation_failed`.
- Updates `pollas.join_code` for `pollaId` via the admin client. On error, returns `update_failed`.
- Does NOT check admin permissions. Callers must verify `polla_participants.role === 'admin'` themselves (both current callers do).

### lib/pollas/join-code.ts

Purpose: generate and validate the 6-character join code that lets a user enter a polla without an invite link.

Alphabet: `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (32 chars, excludes `0`, `O`, `I`, `1`). Uppercase only.

Exports:
- `generateJoinCode(): string` - pure generator, 6 random chars from the alphabet. No DB check. Used by `scripts/backfill-join-codes.ts` and indirectly via `generateUniqueJoinCode`.
- `generateUniqueJoinCode(supabase: SupabaseClient, maxAttempts = 10): Promise<string>` - retries `generateJoinCode` until the candidate does not collide with `pollas.join_code`. Throws after `maxAttempts` retries.
- `validateJoinCodeFormat(code: string): boolean` - regex match against `^[ALPHABET]{6}$`. Case-sensitive; callers must normalize to uppercase first.
- `JOIN_CODE_ALPHABET: string` - exported for bot regex construction and for tests.
- `JOIN_CODE_LENGTH: number` - exported constant = 6.

Consumed by:
- `lib/pollas/rotate-code.ts` (see above).
- `lib/pollas/join.ts` (the shared join-by-code helper used by both the web route and the bot).
- `lib/whatsapp/flows.ts:1253` (format validation inside `handleJoinByCodeConfirm`).
- `scripts/backfill-join-codes.ts`.
- Implicit: the bare-code regex in `bot.ts:350` mirrors this alphabet.

### lib/pollas/join.ts (discovered during audit)

Not listed in the task but sits between `handleJoinByCode` and the database. Exported `joinByCode` enforces format, rate limit (`otp_rate_limits` with `attempt_type='join_code'`), polla lookup, active status, existing-membership check, and participant insert. Returns a discriminated union. Used by `app/api/pollas/join-by-code/route.ts` and by `lib/whatsapp/flows.ts:1282`.

## Appendix: files in scope

| File | Lines | Role |
|---|---|---|
| `app/api/whatsapp/webhook/route.ts` | 110 | Entry point, HMAC verify, dispatch |
| `lib/whatsapp/bot.ts` | 559 | Router, Meta API client, message logging |
| `lib/whatsapp/flows.ts` | 1429 | All conversation flows |
| `lib/whatsapp/state.ts` | 46 | In-memory conversation state |
| `lib/whatsapp/interactive.ts` | n/a | Button / list / CTA helpers (used by bot.ts + flows.ts) |
| `lib/whatsapp/messages.ts` | n/a | OTP message template |
| `lib/whatsapp/tabla.ts` | n/a | Leaderboard formatting |
| `lib/users/needs-name.ts` | 46 | Shared display-name predicate |
| `lib/pollas/rotate-code.ts` | 45 | Shared join-code rotation |
| `lib/pollas/join-code.ts` | 66 | Join-code generation + validation |
| `lib/pollas/join.ts` | 102 | Shared join-by-code business logic |
