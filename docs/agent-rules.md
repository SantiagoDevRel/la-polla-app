# Agent area rules

[`AGENTS.md`](../AGENTS.md) holds the rules that apply everywhere and says when to
read each section here. These rules are as binding as `AGENTS.md`.

## Money and entries

- Casa contracts and operations are enforced in SQL.
  [Deployment](casa-v2-production.md), [admin rules](casa-admin-rules.md).
- Preserve per-pool exact-score rules, multiple-entry caps, whole-pot first place, tie
  rounding, proof revisions, raffle-draw evidence and settlement outcomes.
- House-balance summaries report all collected gross as retained for
  `house_retained_zero_points` and void outcomes, in both pot modes; existing rules
  decide whether settlement is allowed.
- Never rewrite historical predictions while resolving issues or settling.
- Pool creation is admin-only; creator raffles use the separate allowlisted
  [rifas](rifas.md) flow.
- A $0 gift pool uses **Entrar gratis** via `casa_join_free_v1`: immediate entry and
  picks, no transfer, proof or admin review; retries return one entry.
- An explicit free join completes an old pending reservation, keeping its proof/audit
  history.
- Paid pools keep their payment flow; raffles keep numbered tickets; a gift pool is
  not a raffle.
- Who may pick: `AGENTS.md`. Private campaign drafts and their publication: Auth and
  login.
- A rejected entry is retried in its own row; a failed upload (`anulada`) does not
  count toward the entry cap.
- A failed raffle ticket stays reserved to its owner; never set `ticket_number=NULL`.
- Score all valid picks, pending payments included; the leaderboard counts paid
  entries only; approval reveals earned points without recalculation.
- Registration closure, result verification and regulation/120-minute scoring:
  Matches and providers.

## Picks and saves

- Manual save is the player action; never enable autosave implicitly.
- Pick writes carry stable request UUIDs, entry scope and SQL revisions; player code
  never upserts Casa picks directly.
- A response acknowledges only its own revision; readback fences uncertain writes
  before newer edits. [Saves](save-reliability.md).
- Profile edits (`profile_revision`) and the Quentro prize-contact email form
  (`casa_save_prize_contact_v2`) use the same revision fencing.
- Pick privacy detail: [results and privacy](casa-quentro-results.md). Lock timing
  and who may pick: `AGENTS.md`; registration closure: Matches and providers.
- Telegram player writes reuse `saveCasaPicks` and `proof-server`.
  [Bot](../README.md#bot-de-telegram-para-jugadores-2026-09-15-migración-130).

## Auth and login

- The 2026-04 claim that `auth.uid()` never propagates was disproved (RLS recursion,
  fixed in migration 022; checked locally only). Keep service RPCs and explicit
  filters; changing the access model needs its own audit.
  [History](auth-uid-handoff.md).
- Private campaign drafts stay owner/admin-only and cannot be published through the
  ordinary editor. [Campaigns](casa-private-campaigns.md).
- The P2P invite preview (`/api/pollas/preview`) shows join codes/payment
  instructions only after the token matches that pool; the public slug preview omits
  them; all responses are no-store. Casa pools show their payout account to
  authenticated players without a token.
- Signup stays phone-only.
- Login channels (OTP, WhatsApp link, optional six-digit password under
  `PHONE_PASSWORD_ENABLED`) are server-set; never reactivate one by assumption.
  [Auth details](phone-password.md).
- The Telegram login button stays hidden; its backend is retained.
- Onboarding requires a real display name and a pollito.

## Matches and providers

- Carry time precision through API, boards, pending counters and the editor.
- Auto registration closure uses confirmed kickoffs; with none, the admin supplies a
  fallback that sync replaces once a time is confirmed, precision-only updates
  included. [Checks](urgent-high-fixes.md).
- Closing registration never locks enrolled players' future match picks
  ([rules](casa-admin-rules.md)); manual-question answers do lock at closure. Closed
  pools never reopen automatically.
- ESPN and football-data were removed on 2026-09-13; do not reactivate them or legacy
  polling, or infer coverage from historical notes.
  [Results](../README.md#resultados-api-football).
- Keep the older `upsert_match_safe` signature for compatibility.
- Result verification matches linked rows (`apifootball:<id>` in `external_id` or
  `source_external_ids`) by fixture id, competition and kickoff ±2 h; live sync uses
  id and competition. Unlinked rows match by tournament, both normalized teams and
  kickoff.
- No per-provider direct writes; preserve legacy bracket UUIDs and their predictions.
- Keep the legacy P2P per-pool 120-minute/advance modes and their nonretroactive
  cutoffs; Casa scoring always uses regulation time.
- A cached reread is not independent evidence; never infer regulation scores from an
  initial AET/PEN reading.
- Feed, details and team functions share the SQL quota reservation; no second match
  database, feed or cache.
- Highlights stay read-only and honor provider playback restrictions.
  [Highlights](polla-highlights.md).

## UI and service worker

- Typography: Outfit body/help 15/13 px, Bebas display with positive tracking; dark
  glass and sparse gold.
- `lib/dom/traduccion-segura.ts` exists because Chrome Translate rewrites text nodes;
  its regression must run in CI.
- Background video loads after load/idle from one lite source; slow links keep the
  CSS smoke.
- Serve local pre-sized images; no paid image optimization.
- Background videos under `/videos/` are NetworkOnly in the service worker; never
  precache videos or bulk crests (crests use the runtime cache).
- New builds auto-load only on open/return with no interaction and no unsaved, saving
  or uncertain draft; otherwise the «Actualizar app» notice waits for the user.
- Draft and saving UIs set `data-app-update-blocked`; reloads keep cookies, storage,
  caches and the worker registration.
  [Updates](../README.md#actualizaciones-publicadas).

## Tooling

- The secret scanner reads immutable staged blobs offline, redacts findings and blocks
  if it cannot finish.
- Quality CI keeps the translation regression (UI and service worker) and never
  reuses Windows screenshot baselines.
- Re-verify `main` branch protection after changing CI.
