# La Polla: agent contract

Edit agent instructions only here and in `docs/agent-rules.md`; `CLAUDE.md` only
imports this file. Scope: all authorized app work, server logic and migrations
included ("visual changes only" is retired). Generic owner rules (custody, deletion,
verification, commits, tooling) live in the owner global `~/.codex/AGENTS.md`. If you
cannot read it: delete nothing you did not create, stage explicit paths only, and
verify before claiming done.

This file holds the rules that apply everywhere. **Before changing code, data or
settings in any of these areas, read the matching section of
[area rules](docs/agent-rules.md); those rules bind too:**

- **Money and entries:** entries, payments, proofs, raffles, gift pools, pool
  creation, registration closing, scoring, leaderboards, settlement.
- **Picks and saves:** any pick, profile or prize-contact write; the Telegram player
  bot.
- **Auth and login:** login, signup, onboarding, redirects, RLS policies,
  service/admin-client access, and any route, query or page that returns pools,
  invites or campaign drafts to players or the public.
- **Matches and providers:** fixtures, sync, kickoff times, registration-closure
  locks, results, highlights.
- **UI and service worker:** components, media, app updates, draft screens.
- **Tooling:** hooks, the secret scanner, CI.

Player routes: `/inicio`, `/polla/[slug]`, `/futbol`, `/perfil`.

## Run, verify and deploy

```sh
npm ci  # Node >= 22.12, lockfile versions
npm run dev -- --port 3001
npm run validate
npm test
npm run build
npm run test:secrets
npm run test:casa:sql
npm run test:casa:browser
npm run test:e2e
```

- The last four need TruffleHog (set `TRUFFLEHOG_PATH` to an existing binary), Docker
  or installed Chrome; missing tooling is a failed check.
- Keep an existing `core.hooksPath` (the owner's worktree hook runs the scanner);
  if empty, use `.githooks`. Never unset `GIT_INDEX_FILE` (partial commits select a
  temporary index).
- `main` requires **Quality gate** (verified 2026-10-08; re-verify before relying on
  it). Linux CI never reuses Windows screenshot baselines.
  [Checks](docs/urgent-high-fixes.md).
- Keep the deny-all `.vercelignore` allowlist; add `!/path` for any new top-level path
  the build or runtime reads.

## Data and money

- Historical P2P `predictions`: no edits, scoring or rescoring, deduplication,
  migration or deletion without an explicit owner instruction in this thread.
- Migrations are append-only: new numbered files, never edits to applied ones; no
  unrecorded production SQL patches.
- Code work never authorizes changing rollout flags, subscriptions, keys or unrelated
  rows. Buy no services, add-ons or upgrades without owner authorization.
- RLS stays enabled with explicit policies. Every new `public` table enables RLS
  (deny-all if service-only), adds policies and grants each needed role explicitly
  (Supabase stops automatic grants on 2026-10-30; a missing grant returns 42501). New
  `SECURITY DEFINER` functions set `search_path` and revoke `EXECUTE` from `PUBLIC`,
  `anon` and `authenticated` before granting roles.
- All money comes from SQL RPCs; never recalculate it in TypeScript. Never activate
  or revert Casa v2 implicitly.
- Suspended, postponed, cancelled or abandoned matches in active pools open a case in
  `/admin/issues`; nothing is voided or cancelled automatically or settled with open
  issues.
- Reserve provider quota in SQL before provider calls; keep new recurring costs
  visible.
- Public repo: never track `backups/`, phone numbers, receipts or personal data.
  [Backups](docs/backup-restore.md).

## Auth and privacy

- Validate `auth.getUser()` (not `getSession()`) before database access. Admin
  authority is `users.is_admin`, never a phone list. Admin-client reads authorize
  first and scope the user/pool.
- Never `select("*")` on user data; enumerate columns.
- Player and public reads never return private campaign drafts. The P2P invite
  preview (`/api/pollas/preview`) returns join codes and payment instructions only
  for a token of that same pool.
- `NEVER_CACHE_PATHS` in `app/sw.ts` keeps `/api/*`, auth pages and money/state
  pages NetworkOnly; add new ones there (some authenticated pages are still missing).
  New or changed authenticated APIs with user or money data return
  `private, no-store`; some existing routes do not, so never assume either. Never
  serve a session or authenticated content as an offline fallback.
- New SEO, legal or support pages go in `PUBLIC_NO_AUTH_PREFIXES`/`_EXACT`
  (`lib/supabase/middleware.ts`) or they redirect to login; never list login,
  onboarding, join or invite routes there.
- Service/admin keys stay server-side (never `NEXT_PUBLIC_`), out of logs and
  bundles. Redact phones, identifiers and free text with `lib/log.ts`.
- Every `/api/cron/*` handler starts with `requireCronSecret`; keep
  `tests/cron-auth.test.ts` covering it.
- Keep host-only cookies, `redirectWithCookies` on every auth redirect, and the
  permanent 308s in `proxy.ts` (www to apex; `/casa` to `/inicio`, `/casa/<rest>` to
  `/polla/<rest>`, query intact, `/casa/admin` excluded). Never `signOut()` on mount.
- Telegram bot: resolve the sender through the linked identity; callback data is
  untrusted; no LLM handles identity, proofs or picks.

## Matches and picks

- API-Football is the only fixture, live and result source. Fixture writes go only
  through `upsert_match_safe`; never match by tournament and time alone; no TBD
  placeholder batches.
- `scheduled_at_confirmed=false` is an unknown time, not midnight: show its UTC
  calendar date (never shift it to Colombia time) and "Hora por confirmar"; never
  correct it by adding hours.
- Picks lock when a match is live, elapsed > 0, verified or void, and five minutes
  before a confirmed kickoff; unknown-time fixtures stay includable in pools and
  predictable until evidence of play.
- Finalize through the verified-result RPCs; score regulation time (always in Casa;
  legacy P2P pools that enabled the per-pool 120-minute/advance mode keep it).
- Only entries with status `pagada` (including $0 gift, courtesy and invite entries)
  and `pendiente` entries with an uploaded proof may write picks; unpaid reservations
  cannot.
- Picks are written only through `saveCasaPicks`/`casa_save_picks_v1`. Others' picks
  stay private until real match start or question edit lock, enforced in SQL and
  `getDistribution`, never only in CSS.
- `users.avatar_url` stores a pollito key, not a URL; render it through
  `UserAvatar`/pollito helpers.

## UI

- Read the [design system](docs/design-system.md) and reuse its components and
  tokens. Copy: neutral Spanish (Colombia) in tú, no emoji.
- Inspect at 320/768/1280 px, breakpoint edges and 200% text.
- Keep `lib/dom/traduccion-segura.ts` in `<head>` before hydration.

## Open decisions

Keep each owner idea here until the owner accepts or declines it; before closing a
task, ask about pending ones in one line.

- Creator-raffle defaults (`rifa_settings`: link-only listing, 30-minute
  reservations, three active per creator; no creation fee) await confirmation.
- Claude Design/Lovable work: undecided; spend no credits implicitly.
- Recording settlement automatically after the last verified match: undecided; the
  administrator confirmation stays.
- Supabase Auth CAPTCHA activation and host coverage: verify provider settings; never
  infer activation from the client widget.
  [CAPTCHA](README.md#captcha-de-auth-turnstile).
- Participation ideas (match rooms, licensed broadcasts): open; buy no retransmission
  services.
- Low participation per pool (2026-10-08): research on the owner's machine at
  `~/Downloads/research/2026-10-07-la-polla-engagement/` suggests targeted UI fixes,
  no WhatsApp bot for now (Meta requires a gambling license) and no prepaid balance.
  It flags that paid online pools need a Coljuegos concession and raffles an
  authorized operator. Undecided; implement nothing without approval.
- Declined, do not re-propose: the embedded Claude admin chat (2026-09-13).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
