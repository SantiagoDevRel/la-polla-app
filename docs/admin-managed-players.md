# Administrator-managed players

Migration **169** registers the 20 fictitious profiles explicitly approved by the
owner on 2026-10-23. It identifies existing profiles by UUID and never creates
replacement users or matches a name. Installation enrolls nobody.

On `/polla/[slug]`, global administrators see **Jugadores de la casa** above the
pool hero. Opening the dropdown reads the current roster; each checkbox controls
one participation in that pool. Private drafts, unpublished/scheduled pools,
closed registrations, pending draws and final pools are read-only. This does not
manage the separate creator-raffle product at `/rifa/[slug]`.

The owner explicitly chose **paid participation with prize eligibility**. Checking
a player records an administrator-approved `pagada` entry at the pool's entry
price. Existing SQL pot, leaderboard and settlement functions include that entry
normally. It does not charge a bank account, upload a receipt, send a message,
create credentials. Administrators are responsible for the
funding they record. Free pools retain a zero amount and their single-entry rule.

Unchecking changes only this selector's entry to `anulada`, excluding it from the
pot and prizes. It preserves the entry UUID, original approval, picks, ticket and
append-only administrator events. Checking again restores the same entry. A raffle
receives the lowest unused ticket; annulled tickets remain owned. Entries created
through another flow, multiple participations and receipt-backed entries are never
modified by this control.

`GET/PATCH /api/casa/admin/pollas/[id]/jugadores` authorize the session and
`users.is_admin` before database access. Writes require `X-Casa-Contract: 2`.
Responses are `private, no-store`; existing `/api/*` and `/polla/*` service-worker
rules use NetworkOnly. SQL repeats the administrator and roster checks, acquires
the existing parent-pool lock and enforces revision fencing. A duplicate retry
returns current state; a stale reversal fails. A lost response triggers a readback,
never a blind write retry. Loading and writes block automatic app updates.

`casa_admin_players` is the server-only roster. `casa_admin_player_events` is the
append-only audit. Both enable RLS with explicit deny policies for player roles.
New RPC execution is granted only to `service_role`. Migration 169 adds only the
audit-backed, receipt-free paid-to-annulled exception to the installed entry guard;
all existing proof, payment correction and final-state checks remain.

## Verification

Migration **170** adds **Ver jugador** to each roster row. The administrator view
at `/admin/pollas/[id]/jugadores/[userId]` retains the real admin session and shows
the selected profile's name and pollito. A paid, selector-managed entry is required
before showing its prediction board; an unenrolled profile gets instructions, and
raffles do not show prediction inputs.

Migration **171** makes a new checkbox selection in a match pool save random
predictions in the same transaction as enrollment. Migration **172** restricts
new random scores to **0-0,1-0,0-1,2-1,1-2,1-1,2-2**;
1X2 uses a home win, draw or away win. Only missing, editable predictions are
filled. Existing values, locked/void matches and prior administrator edits are
preserved. Questions and raffles receive no automatic answers. Installation and
already-selected readbacks create no picks; there is no backfill.

The enrollment event UUID identifies the save request; the existing
`casa_admin_save_player_picks`/`casa_save_picks_v1` writer retains ownership,
revisions, match locks and real actor audit. A save failure rolls back enrollment
and audit together. Duplicate requests never rerandomize, and removal/re-add
retains existing picks. Apply171 before publishing its confirmation text.

The view reuses `PicksBoard`, `QuestionsBoard` and their existing manual-save,
draft-isolation, revision and uncertain-response protocol. Its dedicated GET/PUT
API authorizes the real admin before database access. SQL rechecks the exact roster
and selector-managed paid entry, holds the parent lock against withdrawal, then
calls `casa_save_picks_v1`; match/question locks are unchanged. Each acknowledged
request records its real admin actor in the append-only
`casa_admin_player_pick_events` table. An arbitrary participant, another entry,
receipt-backed entry or withdrawn profile cannot be edited through this view.
Apply migration 170 before publishing this view.

In match pools, the managed-player board offers **Llenar aleatorio**
above the match list. It fills only empty, editable score fields with integers
from the same seven approved pairs, preserving existing values (including zero)
and locked matches. Partial drafts use compatible pairs; an incompatible entered
side is left untouched. Previously saved scores are never rewritten.
It changes the local draft only; **Guardar** still performs the audited save.
In 1X2 pools (including Ofigolazo 5), it fills missing selections with a random
home win, draw or away win, preserving existing selections and locked matches.
The control is unavailable during loading, saving or uncertain/session-expired
states, and absent from ordinary player, question and planning views.

- `npm test -- tests/casa-admin-players-route.test.ts` covers authorization,
  contract, validation, actor spoofing, cache headers and SQL error propagation.
- The required GitHub Actions SQL job runs `node scripts/check-casa-sql.mjs`.
  It replays all migrations in its own network-isolated PostgreSQL 17 container,
  seeds synthetic roster fixtures before migration 169 and runs
  `casa-admin-players-check.sql` plus concurrent duplicate-add and stale-reversal
  checks. It checks real guards, SQL pot changes, preserved picks, raffle ownership
  and payout eligibility. It needs no production snapshot, rows or credentials and
  cannot target a production database. La Polla builds and tests use standard
  GitHub-hosted runners, not the DGX.
- Browser checks cover 320/768/1280 px, 200% text, loading/error/read-only states,
  adding/removing, lost-response recovery, keyboard focus and accessibility.

Apply the migration before publishing the client. Confirm the roster has 20 rows,
all new tables retain RLS, player roles cannot execute the RPCs and no entries were
created by installation. No subscriptions, rollout flags or historical P2P
predictions change.
