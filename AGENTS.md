# La Polla: agent contract

Edit instructions here. `CLAUDE.md` imports this file and contains no second contract.
This applies to authorized application work, including server logic and migrations.
The old "visual changes only" restriction is retired.

## Run and verify

Use Node.js 22.12 or newer and the versions in `package-lock.json`.

```sh
npm ci
npm run dev -- --port 3001
npm run validate
npm test
npm run build
npm run test:secrets
npm run test:casa:sql
npm run test:casa:browser
npm run test:e2e
```

The last four commands require TruffleHog, Docker, or installed Chrome as appropriate.
Set `TRUFFLEHOG_PATH` to an existing binary. Clone-only hook setup:
`git config core.hooksPath .githooks`. Preserve an existing shared hooks configuration;
the owner's shared worktree hook already calls the staged scanner.
Never unset `GIT_INDEX_FILE`; partial commits select a temporary index.
The scanner reads immutable staged blobs, runs offline, redacts findings, and blocks
if it cannot finish. Missing tooling is a failed check.

Quality CI runs for pull requests and pushes to `main`. Its aggregate check is
**Quality gate**; require it on `main` and verify branch enforcement independently.
Linux does not reuse Windows screenshot baselines.
See [verification and changes](docs/urgent-high-fixes.md).

## Scope, custody, and delivery

- Preserve uncommitted work and stay in your assigned branch/worktree. Stage explicit
  paths only. Do not use `git add .`, force Git, or change branches without context.
- Never delete resources you did not create. Destructive cleanup needs specific owner
  authorization. Historical P2P `predictions` are protected: no data edits, scoring,
  deduplication, migration, or deletion without an explicit instruction in this thread.
- When replacing your own files, branches, URLs, or deployments, verify the replacement,
  retire the old resource in the same task, and verify it is no longer accessible.
- Append migrations; no unrecorded production SQL patches. A code change does not
  authorize changing rollout flags, subscriptions, keys, or unrelated rows.
- Keep temporary reports, prompts, screenshots, exports, and requirement contracts in
  Downloads. Before multi-requirement work, record each request and evidence there.
- Commit and push your verified work. An agreed PR includes merge and deployment to
  the existing target, followed by production checks. Do not publish others' changes.
- Before each commit, run the owner's staged-secret-scan and change-guard tools.
  Closing a batch also requires `change-guard --requirements <contract.json>`.
- Do not buy services, add-ons, or upgrades without authorization. Use existing resources.
  Reserve provider quota in SQL; keep new recurring costs visible.

## Authorization and privacy

- Validate `auth.getUser()` before database access. Admin authority is `users.is_admin`,
  not a phone list. Service/admin keys stay server-side and out of logs and bundles.
- RLS remains enabled with explicit policies. Enumerate columns; never `select("*")`
  for user data. Admin-client reads must explicitly authorize and scope the user/pool.
- The 2026-04 auth incident was RLS recursion, fixed in migration 022. The claim that
  `auth.uid()` never propagates was disproved. Keep existing service RPCs and filters;
  replacing the access model requires its own audit. [Historical handoff](docs/auth-uid-handoff.md).
- `/api/*` with authentication uses NetworkOnly and private/no-store responses. Never
  cache a user's session or serve authenticated content as an offline fallback.
- Private campaign drafts remain owner/admin-only and cannot be published through the
  ordinary editor. Player APIs must not reveal their content.
- Invite preview exposes join codes/payment instructions only after matching the token
  to the same pool. A public slug preview omits those fields. All responses are no-store.
- Redact phone numbers, identifiers, and free text in logs using `lib/log.ts`.
- Preserve host-only cookies, apex redirects, and refresh cookies on every auth redirect.
  Never `signOut()` on mount. [Auth details](docs/phone-password.md).

## Current product

- Player routes are `/inicio`, `/polla/[slug]`, `/futbol`, and `/perfil`. Creation is
  administrative; creator raffles use the separate allowlisted flow in [rifas](docs/rifas.md).
- Login uses the server-configured OTP channel, a WhatsApp deep link when configured,
  and an optional six-digit password under `PHONE_PASSWORD_ENABLED`. Telegram's backend
  is retained, but its login button is hidden. Do not reactivate a channel by assumption.
- New users must choose a real display name and a pollito. `users.avatar_url` stores
  a catalog key, not a URL; render it through `UserAvatar`/pollito helpers.
- A $0 gift pool uses **Entrar gratis**, immediate enrollment and immediate picks;
  no transfer, proof, or admin review. Use the existing `casa_join_free_v1` RPC. Retries
  return one entry. An explicit join completes an old pending reservation without
  deleting its proof/audit history. Paid pools keep their payment flow. Raffles retain
  their numbered-ticket flow; a free gift pool is not a raffle.
- Pending paid entries with submitted proof may predict; unpaid reservations cannot.
  Rejected/void entries must remain recoverable. Match and manual drafts use revision
  acknowledgements: response A must not claim a newer edit B was saved. Manual
  saving remains the action; do not enable autosave implicitly. New pick writes
  use `casa_save_picks_v1`, stable request UUIDs, entry scope and SQL revisions.
  Readback must fence uncertain writes before allowing newer edits. Profile and
  Quentro have matching version guards. [Save protocol](docs/save-reliability.md).
- Score all valid picks, including pending payments; the leaderboard counts paid
  entries only. Approval reveals previously earned points without recalculation.
- Other players' picks stay private until real match start or question edit lock.
  Enforce this in SQL and `getDistribution`, never only in CSS. See
  [results and privacy](docs/casa-quentro-results.md).
- Telegram player writes share `saveCasaPicks` and `proof-server`. Resolve the sender
  through their linked Telegram identity; callback data is untrusted. No LLM handles
  identity, proofs, or picks. [Bot contract](README.md#bot-de-telegram-para-jugadores-2026-09-15-migración-130).
- Every `/api/cron/*` handler starts with `requireCronSecret`; preserve the cron-auth
  coverage test. Keep signup phone-only and `/casa` to `/polla` redirects as permanent
  308 redirects for existing links.
- Casa contracts/operations are enforced by SQL. Do not activate or revert v2 implicitly.
  [Deployment](docs/casa-v2-production.md), [admin rules](docs/casa-admin-rules.md).
- All money comes from SQL RPCs, never recalculated in TypeScript. Preserve exact-score
  rules per pool, multiple-entry caps, whole-pot first place, tie rounding, proof
  revisions, draw evidence, and settlement outcomes. Zero-points terminal outcomes
  account for all retained gross; existing rules determine whether settlement is allowed.
- Voided/postponed matches in active pools use admin issues; do not automatically cancel,
  settle with open issues, or rewrite historical predictions.

## Matches and timing

- `scheduled_at_confirmed=false` is an unknown time, not a midnight kickoff. Display
  the UTC calendar date and "Hora por confirmar". Never correct it by adding hours.
- Unknown-time fixtures may be included and predicted until evidence of play. Live,
  elapsed > 0, verified, or void matches lock. Confirmed times lock five minutes before
  kickoff. Carry precision through API, boards, pending counters, and the editor.
- Auto registration closure uses confirmed kickoff times. With none confirmed, the
  administrator supplies a fallback closure. Sync replaces it when a time is confirmed,
  including a precision-only update. Closed pools never reopen automatically.
- API-Football is the current calendar/live/result source; legacy adapters are retained
  for compatibility. Do not reactivate legacy polling or infer current coverage from
  historical notes. [Coverage/quota](README.md), [results](docs/polla-highlights.md).
- Every fixture writer uses `upsert_match_safe`. Identity includes tournament, both
  normalized teams, and time; never tournament/time alone. No per-provider direct writes
  or new TBD placeholder batches. Preserve legacy bracket UUIDs and their predictions.
- Finalize through the verified-result RPCs. Score regulation time; preserve per-pool
  120-minute/advance exceptions and their nonretroactive cutoffs. Cached rereads are not
  independent evidence. Never infer regulation scores from an initial AET/PEN reading.
- Shared feed/details/team functions reserve quota before provider requests. Do not add
  a second match database, feed, or cache. Highlights remain read-only and honor provider
  playback restrictions. [Highlights](docs/polla-highlights.md).

## UI and tools

- Read [design system](docs/design-system.md) and the installed React Best Practices
  skill before React changes. Read current Next guides in `node_modules/next/dist/docs/`.
- Keep `lib/dom/traduccion-segura.ts` in `<head>` before React hydration. Chrome page
  translation rewrites text nodes; the translation regression must run in CI.
- React UI only. Reuse shared components/tokens: Outfit body/help 15/13 px,
  Bebas display with positive tracking. Preserve role typography, wrapping, contrast,
  touch targets, dark glass, and sparse gold. Spanish Colombia, **tú**, neutral wording;
  no UI emoji. GitHub content and newly written documentation are English.
- Render, inspect, correct, and reinspect changes at 320/768/1280 px, relevant breakpoint
  edges, and 200% zoom. Inspect whole screens, states, overflow, and computed fonts.
- Video backgrounds load after load/idle; one lite source. Preserve CSS smoke for slow
  connections. Local sized images avoid paid image optimization. Do not recache videos
  or bulk crests. App updates require a user action and respect unsaved-draft blockers.
- Use installed tools; do not install a dependency without first explaining why.
  Vercel uses CLI or the dedicated browser, never Vercel MCP. Retain the deny-all
  `.vercelignore` allowlist and check sensitive paths after deployment.
- A listed tool is not proof it is connected. Verify tool/CLI/browser availability
  per client. Reviews use `ai-pack` and `ai-chat claude` with read-only scope; browser
  regression uses an isolated Playwright context. Close only resources you created.

## Open decisions

- Creator-raffle defaults still need owner confirmation: link-only listing, 30-minute
  reservations, free creation, and three active raffles per creator.
- Optional Claude Design/Lovable work remains undecided; no credits may be spent implicitly.
- Recording settlement automatically after the last verified match remains undecided;
  the current administrator confirmation stays in place.
- Supabase Auth CAPTCHA activation and host coverage require verifying provider settings;
  do not infer activation from the client widget.
- Further participation ideas, including match rooms or licensed broadcasts, remain open.
  The embedded Claude admin chat remains declined. Do not buy retransmission services.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
