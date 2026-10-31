# WhatsApp player bot through Zernio

Players use La Polla from the official WhatsApp number (the login-link number on
Zernio) with native reply buttons and lists. This is a second transport for
`lib/telegram-player`, alongside the OpenWA relay.

**Status (2026-10-31):** migration 177 applied and the bot is open to every number
(the owner approved it; `WHATSAPP_ZERNIO_BOT_ALLOWED_PHONES` is unset in production).
The literal login phrase still returns the login link. Risk the owner accepted:
WhatsApp's Business Messaging Policy restricts real-money gambling, and a ban on
this number would also take down the WhatsApp login. To close it again, set the
allowlist (or `WHATSAPP_ZERNIO_BOT_ENABLED=false`) and redeploy.

## Configuration

| Variable | Meaning |
| --- | --- |
| `WHATSAPP_ZERNIO_BOT_ENABLED=true` | Enable the official-number player bot. Unset preserves the existing login webhook response. |
| `WHATSAPP_ZERNIO_BOT_ALLOWED_PHONES` | Optional comma-separated E.164 digits. A nonempty malformed list allows nobody. |
| `ZERNIO_API_KEY`, `ZERNIO_WHATSAPP_ACCOUNT_ID`, `ZERNIO_WEBHOOK_SECRET` | Existing server credentials and HMAC verification. |
| `ZERNIO_WHATSAPP_PICKS_FLOW_ID` | Published WhatsApp Flow id for the one-screen 1X2 form. Unset keeps one match per message. Not a secret. |
| `ZERNIO_WHATSAPP_PICKS_FLOW_DRAFT=true` | Testing only: sends the flow as an unpublished draft. |

Existing WhatsApp login settings still govern login links. No templates, new
subscriptions, dependencies, phone numbers or credentials are added.

Migration `177_whatsapp_zernio_bot.sql` adds verified conversation and last inbound
time to migration 176's chat, plus a service-only delivery ledger. New functions explicitly revoke execution from PUBLIC,
anon and authenticated and grant service_role only. New tables have RLS/deny-all.

## UX map

| Screen | Actions |
| --- | --- |
| New account | Type name, then choose pollito; Menú remains available. |
| Home | Pollas disponibles / Mis pollas / Más |
| More | Mis pagos / Mi perfil / Entrar a la web / Ayuda / Menú |
| Available or joined pools | Choose pool; existing pool pages and Más navigation. |
| Pool | Join or free join, proof retry, predict or questions, own picks, table, rules, Menú; availability comes from the shared flow. Web login stays in Más. |
| Payment | Exact SQL price, payment account, prize, send image; Cancelar / Menú. |
| Proof error | Reintentar / Menú; retry asks for the image again, preserving the proof step. |
| Exact score | Type `2-1`, local first; Saltar / Ver todos / Volver a la polla / Menú. |
| 1X2 | With a configured flow and 2+ open matches: one form with every open match (up to 20, pending first) and «Guardar»; a short follow-up offers «Uno por uno» for clients that cannot open forms. Otherwise home win / draw / away win per match. |
| Questions | Choose or type answer; skip / own answers / back / Menú. |
| Own picks or answers | Choose one to edit; table / back / Menú. |
| Table | Existing SQL standings, own rank/points; refresh / back / Menú. |
| Profile | Name / pollito / prize account and shared back navigation; Menú. |
| Notices | Next player action and Menú, only inside the 24-hour window. |

Exact scores use one short typed message per match rather than two goal-selection
steps and network round trips. The existing score parser, locks and save RPC still
validate and save it. Explicit Menú/Hola navigation works during free input.
Numbers and full option titles work outside text steps; letters can select
navigation during text steps without confusing scores, tickets, names or answers.

One to three actions use native reply buttons only when every label fits in 20
characters; otherwise they use a list. Pool choices always use lists with the
complete name: up to 24 characters in the title and the rest first in the
description (72 maximum), followed by price, Colombia close time or entry status.
Names are capped at 80 characters by the existing pool contract. If facts do not
fit beside a long name, the body also shows the full name and facts. Shared
Telegram buttons retain their own text; optional `listRow` metadata supplies the
unabridged name to Zernio. Ordinary screen URLs are omitted; the personal login
CTA still uses the original captured login adapter from Más → Entrar a la web.
Four to ten actions use one list. Longer
menus paginate with Más, Anterior and Menú, never exceeding ten rows. Labels are
unique after truncation except pool names sharing a prefix, whose descriptions
preserve the remainder. Ambiguous typed titles select nothing; opaque ids still
select the exact pool. Truncation/splitting preserve graphemes. Long rules and
standings split without silently removing data. Opaque ids map to stored callbacks,
which the player router revalidates against the database. Concise `compactText`
is presentation from existing source data; Telegram and OpenWA retain their copy.

## One-screen 1X2 form (WhatsApp Flows)

`lib/whatsapp-zernio/pick-flow-json.ts` is the static Flow JSON (version 7.1): an intro,
20 optional radio groups (match label 30 characters, date and current pick in the
description, «Gana local / Empate / Gana visitante») and a footer that completes with
the pool id, each slot's match id and the chosen option. Each message fills the slots
through `flow_action_payload`; unused slots are hidden. Unmarked matches do not change.

The answer arrives as `message.received` with `metadata.flowResponseData` (or
`flowResponseJson`). Identity is still the verified phone; the payload is untrusted
input. Only tokens starting with `lp-picks:` are accepted, then `savePickForm` reloads
the pool, the entry and every match, drops matches outside the pool or already closed,
and saves the rest in one `saveCasaPicks` call (same RPC, locks and audit as the web).
The reply lists what was saved and how many matches closed or are still missing.

Provisioning (published flows are immutable; a JSON change needs a new flow id):

    node tools/secrets.mjs run --vars zernio.env -- node --experimental-strip-types       apps/la-polla/scripts/zernio-pick-flow.mjs create|upload|status|publish [flowId]

with `ZERNIO_WHATSAPP_ACCOUNT_ID` in the environment. Test with the draft flag on the
physical phone, publish, then set `ZERNIO_WHATSAPP_PICKS_FLOW_ID` and remove the draft flag.
Exact-score pools keep the typed `2-1` flow. WhatsApp Web may not open forms; the
«Uno por uno» follow-up covers it.

**Status (2026-10-31): off in production.** Draft flow `990480350128405` was created
without validation errors, but Meta refuses to send it: Zernio returns
`platformError.code 139000` («Integrity requirements not met») for the business
account. That is an account-level block (business verification / account quality in
WhatsApp Manager, or Meta support), not a code issue. Both env vars were removed, so
1X2 pools use the per-match list. If a form send ever fails, `deliverTurn` skips it and
still sends the «Uno por uno» follow-up, so the turn is never stuck.

WhatsApp copy (`compactText`) uses `blocks()`: one fact per line and a blank line
between blocks; the Zernio formatter trims lines and collapses extra blank lines.

## Provider and security contract

The supplied Zernio OpenAPI v1.429.1 was inspected at `sendInboxMessage`,
`WebhookPayloadMessageReceived` and `getWhatsAppMedia`:

- Reply buttons: three maximum, title 20 characters, `payload` returned as reply
  id. WhatsApp ignores URL fields here: links use `interactive.cta_url`.
- Lists: ten total rows; title 24, description 72, id 200; opener 20 characters.
  All interactive bodies use a conservative 1,024-character bound, also documented
  in Meta's [interactive object reference](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/types/InteractiveObject/).
- Button/list ids come from root metadata; quick replies support
  `interactiveMetadata` and root metadata. Attachment captions never become
  commands. Standby, wrong-account, outgoing, stale and future events fail closed.
- Identity comes exclusively from `zernioVerifiedPhone`. BSUID-only users retain
  the native contact request. Text, captions, address-book cards and vCards never
  select an account.
- The webhook checks HMAC before parsing, processes ALTA/BAJA first, then the
  enabled/allowlisted bot, otherwise the original login reply. The literal phrase
  `dame el link para entrar a la polla` and Entrar a la web retain the original
  login token, expiry, rate limit and content through a captured delivery adapter.
- Attachment URLs must be exactly the authenticated Zernio HTTPS media proxy,
  pinned to the configured account. No redirects, arbitrary hosts or extra query
  fields. Bearer keys never go to user-supplied hosts or Meta CDN URLs.
- Downloads stop at 3 MiB, including streams without Content-Length. MIME and
  magic bytes are checked. Actual image bytes decide JPG/PNG/WEBP, including PNG
  named JPG. Migration 176's staging size is preserved. PDF remains rejected:
  `ProofContentType`, the web join MIME enum, SQL proof RPCs (098/131), storage
  MIME allowlist and upload signature verifier accept only JPG/PNG/WEBP; admin
  review renders an image. The bot asks for a screenshot. No converter,
  dependency, migration or expanded proof contract is introduced.
- Media staging is phone-scoped and expires after two hours when read. Proofs
  still use `beginCasaProof` / `confirmCasaProof`. Picks use the existing Casa save
  RPC. Historical P2P predictions remain untouched.
- SQL serializes turns per phone and atomically caps inbound at 20/minute.
  Provider message ids dedupe envelope redeliveries. Interrupted processing is
  never reexecuted with uncertain business writes. Prepared replies retry with
  the same bodies and provider idempotency keys.
- Review event keys include entry, attempt, review time and decision; referral
  gifts use the credit event id. A notice preserves the active input menu; its
  opaque buttons resolve the stored delivery menu before entering the shared
  router. Every send checks the strict 24-hour boundary, including retries.
  Outside the window, skip without templates. OpenWA still serves its users
  when no eligible Zernio chat exists.

## Acceptance ledger and handoff

Claude owns review, final gates, commit, deployment and physical-phone acceptance.
This implementer does not commit, push, open PRs, change flags, write production
or apply migrations. This polish stays in `feat/whatsapp-zernio-polish`.

The polish standardizes **Pollas disponibles** in shared player copy (the old
typed command remains an alias), shortens payment/proof/pick/profile/help/review
copy and keeps Menú on every non-home screen. Tables, rules and own picks retain
their underlying data. Regression flows cover paid/free entry with both exact
scores and 1X2, proof rejection/retry and upload recovery, edits, standings,
joined-pool lists, payments, profile and help. Rendering on a real phone remains
Claude's release acceptance.

| Brief requirement | Implementation and evidence |
| --- | --- |
| Register, name, pollito; see pools; join; proof; predict/change; table | Shared router and `handler.ts`; Telegram flow regressions. |
| Real buttons, lists, pagination, limits, truncation, links, typed fallback | `format.ts`; `tests/whatsapp-zernio-format.test.ts`. |
| HMAC → preference → verified bot → original login | Route regression tests, including byte-identical off responses. |
| Sender-only identity; BSUID native contact request | Inbound/route tests plus existing username-login tests. |
| Server download; allowlist, cap, MIME/magic; existing proof path; retry | `media.ts`, channel, shared `entry.ts`; media/handler tests. |
| Notices only <24 h; idempotent; no templates | `notify.ts`, `delivery.ts`, migration 177; window/delivery tests. |
| Default-off flags and allowlist | `config.ts` and unit tests. |
| Reuse 176; free migration number; RLS/grants | Migration 177 and static SQL assertions. No database application. |
| Colombia tú, concise copy, chick, menu escape | Renderer and optional shared `compactText`. |
| No secrets/PII, production writes, commits, dependencies or logic fork | Scoped working diff and DGX verification. |
| Existing WhatsApp/Telegram tests and DGX build | Exact commands/results in the final handoff. |

Real provider rendering/delivery, a live signed media event, runtime execution of
migration 177, production configuration and physical-phone acceptance remain the
orchestrator's release checks. SQL tests here inspect the migration contract,
not a running PostgreSQL instance. Notice delivery is best effort like Telegram;
provider failures preserve the prepared body for the same source event's retry.
