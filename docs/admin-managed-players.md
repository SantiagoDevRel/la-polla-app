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
create credentials or fill any picks. Administrators are responsible for the
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
