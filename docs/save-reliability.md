# Save confirmations and recovery

Manual **Guardar** remains the player action. Existing layouts, pool rules,
gift entry, payment proof, and provisional fixture behavior are preserved.
This change does not enable autosave or modify historical P2P predictions.

## Picks: migration 164

`saveCasaPicks` is the shared web/Telegram writer. It calls `casa_save_picks_v1`;
no player code directly upserts Casa picks. New browsers send a stable request UUID,
entry UUID and expected revision. SQL authorizes the owner and entry, rejects stale
versions, and returns one exact saved/rejected result for every submitted target.
Incomplete and closed targets remain visibly unsaved. Saved counts and locked cards
use confirmed values. A response for draft A cannot acknowledge a newer draft B.

`casa_pick_save_state` stores one row per entry, with the revision and last operation.
RLS denies client access; the new RPCs are service-only. A completed operation replays
its original result after closure. Reusing its UUID with another input fails.
Meaningful direct value writes invalidate the revision; scoring and timestamps do not.
Pool SHARE/NOWAIT locks let different players save together while retaining exclusion
against administrative settlement. Entry lock waits are bounded. Target lifecycle
errors have a stable SQL hint; global authorization/operation failures abort the batch.

Lost responses trigger a bounded, read-only state check. A retry uses the same UUID
and version. The client keeps drafts and uncertain operations in sessionStorage,
scoped by authenticated user, pool and entry, with a versioned schema and 24-hour TTL.
Storage records only edited targets and their confirmed baseline. Readback refreshes
untouched targets, preserving actual edits; a restored conflicting edit requires review.
Storage failure does not claim a server failure. Unsaved or uncertain drafts block
app updates. Explicit discard only removes local drafts after uncertainty resolves.

## Profile, prize contact and feedback: migrations 165–166

Profile acknowledgements return the affected row. New PATCH requests include owner
and `profile_revision`; SQL UPDATE compares both. The trigger advances revisions for
editable changes and prevents callers from resetting the fence. A fresh read that
already matches needs no PATCH. Explicit retries retain the same owner, body and
revision. After an uncertain PATCH, readback must match the
owner and fields **and** show an advanced revision before releasing a newer edit.

Quentro uses `casa_save_prize_contact_v2`, request UUID and contact revision. The
original writer retains campaign, paid-entry, winner and delivery checks. Both
writers serialize by owner/pool, and actual writes advance the revision. Replaying
an operation cannot reopen editing after delivery or settlement. Stored email alone
does not prove that an in-flight request has completed.

Feedback has a nullable per-user request UUID with a unique index. A retry returns
the same report; mismatched content never replaces it. Provider notifications run
after the primary response and abort at eight seconds. WhatsApp stays disabled.
Free entry uses its existing idempotent RPC and exact owner/pool/entry confirmation;
its recovery GET never enrolls anyone.

All requests have deadlines, require JSON acknowledgements and use no-store. Session
expiry offers login while preserving the active draft. A changed account is a
separate precondition and offers account review in Profile. Auth-sensitive APIs return
JSON401 instead of redirecting writes to an HTML login page.

## Compatibility and verification

Older bundles retain their existing response fields and can continue manual saves.
Account deletion requires a confirmed owner; old clients must reopen Profile first.
They lack the new client version/owner metadata, so their user-intent ordering and
account-recovery guarantees are limited. No forced reload is introduced. Database
revisions still observe legacy writes. Ship migrations 164–166 before the application;
do not change Casa rollout flags, subscriptions or provider configuration.

Run `npm run validate`, `npm test`, `npm run build`, `npm run test:casa:sql` and
`npm run test:casa:browser`. SQL checks replay the complete migration history in a
new network-isolated container, prove stale-write rejection and simultaneous players,
and retain administrative exclusion. Browser regressions use real React components,
compiled CSS/fonts and synthetic requests; they do not alter real accounts.
Inspect 320/768/1280 px, breakpoint edges and 200% text, including recovery states.
