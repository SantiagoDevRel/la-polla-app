# WhatsApp player bot (OpenWA)

Players use La Polla from a WhatsApp chat: create an account, join pools, send the
payment proof, predict, and see tables and payments. It reuses the Telegram player
bot screens and rules (`lib/telegram-player`); only the transport is different.

**Status (2026-10-31): native poll menus implemented, pending review/deployment;
the bot remains disabled.** Production answers 404 until
`WHATSAPP_OPENWA_BOT_ENABLED=true`. It still needs a dedicated SIM. Never use the
Zernio number: it serves the live WhatsApp login link.

## How it works

```
Player WhatsApp ──► OpenWA (DGX, whatsapp-web.js, 127.0.0.1:2785)
                      │ webhook message.received / poll.vote, X-OpenWA-Signature
                      ▼
                    relay (DGX, ops/whatsapp-openwa/relay.mjs)
                      │ signed body, x-lapolla-timestamp + x-lapolla-signature
                      ▼
                    POST /api/whatsapp/openwa (Vercel) ──► lib/whatsapp-player/handler.ts
                      │ { outcome, replies: [{ to, text, poll? }] }
                      ▼
                    relay sends text + single-answer poll, then signs poll-sent ack

Approval or gift notice ──► whatsapp_bot_outbox ──► relay polls
                            POST /api/whatsapp/openwa/outbox (claim, ack)
```

- WhatsApp Web has no reply buttons or lists, but OpenWA 0.26.0 supports native
  polls. Each menu sends concise text (`Screen.compactText` when available) and
  one single-answer poll with the button labels. There are 2–12 unique options,
  at most 100 UTF-16 code units each; the title is at most 255. Large menus use
  nine content options per page plus Anterior / Más / Menú. Menú is always present.
- The same text lists numbered choices. During typed number flows (ticket, score,
  account, free answer), it uses letters; typed goal digits 0–9 still work. Exact
  titles and «menú» remain usable without voting. `poll-menu.ts` renders and saves
  the complete source menu, current page and a fresh nonce in `whatsapp_bot_chats`.
- A stored option is only a Telegram callback string. The Telegram flows validate
  it again against the database (visible pool, match of that pool, entry state).
- Proof images up to 3 MB arrive inline in the webhook. They are staged in
  `whatsapp_bot_media` for at most 2 hours, read back by id and phone, and go
  through the same `proof-server` contract as Telegram.
- Notices (payment approved or rejected, invite gift) go only to numbers that
  already wrote to the bot. The relay claims them every 30 seconds. A notice does
  not replace the options of an active text/proof flow. Its delayed acknowledgement
  cannot restore an older poll menu over the player's newer menu.

## Native poll protocol (verified read-only in the running 0.26.0 container)

- `POST /api/sessions/:sessionId/messages/send-poll`: `{chatId, name, options:
  string[], allowMultipleAnswers: false}`. Uses the existing scoped operator key
  and stable `idempotency-key`; success returns `{messageId, timestamp}`. The
  relay uses this WhatsApp `messageId`, not an internal database row id.
  If sending resolves c.us to @lid, the serialized message key supplies the
  actual private chat id stored with the acknowledgement.
- Webhook subscription: `message.received` and `poll.vote` via
  `POST /api/sessions/:sessionId/webhooks` (or `PUT .../webhooks/:webhookId`).
  `poll.vote.data` contains `{pollMessageId, chatId, voterId, selectedOptions:
  string[], pollName?, timestamp, timestampMs}`; options are texts, not indices.
- Before forwarding a vote, the relay checks `GET /api/sessions/:sessionId` for
  its own phone. For an `@lid` voter, it uses the read-only
  `GET /api/sessions/:sessionId/contacts/:contactId/phone` (`{contactId, phone}`)
  only to exclude self-votes. Unresolved self-checks fail closed; typed input
  remains available. The signed vote adds `selfChecked: true, fromMe: false`.
- After sending a poll, the relay signs
  `POST /api/whatsapp/openwa/poll-sent` with `{pollMessageId, chatId, nonce}`.
  The app finds the server-generated menu by nonce and stores its phone and
  options in `whatsapp_bot_polls`. A stale acknowledgement returns `{ok:false}`.
  Ack retries reuse the same poll id and never create another poll.
- A vote's account comes **only** from that stored mapping. Neither `voterId`
  (including `@lid`), `pollName` nor option text can select an account. SQL locks
  the poll and chat, checks the current nonce/options, exact private chat and
  30-minute expiry, and consumes only the first valid vote. Replays use a hash of
  poll id + option + timestampMs (timestamp seconds as fallback); later option
  changes are ignored even when their timestamp differs. The handler checks the
  nonce again and dispatches through the shared Telegram flows.

## Security

- **Identity** is the sender number that WhatsApp verified: `<digits>@c.us`, or
  the `senderPhone` OpenWA resolves for an `@lid` sender. Text, captions and
  shared contacts never select an account. An unresolved `@lid` gets an
  explanation and touches no account.
- A number without an account gets one in the chat
  (`resolveAccountForVerifiedPhone`, same as SMS and Telegram), then name and
  pollito. Like SMS, whoever controls the number controls the account; a recycled
  number inherits it.
- The relay signs `<timestamp>.<raw body>` with `WHATSAPP_OPENWA_RELAY_SECRET`
  (HMAC-SHA256). The routes check it before parsing, within ±5 minutes.
  `whatsapp_bot_inbound` processes each WhatsApp message id once and caps a number
  at 20 messages per minute.
- The `whatsapp_bot_*` tables (migrations 176 and 178) are service-role only: RLS with
  deny-all, no grants to `anon` or `authenticated`. The claim and ack functions
  revoke `EXECUTE` from `PUBLIC`, `anon` and `authenticated`.
- OpenWA listens only on the DGX loopback. The relay uses an operator key scoped to
  the bot session. OpenWA keeps messages for 7 days. Logs carry no phone numbers
  or message text.
- **Platform risk:** OpenWA automates WhatsApp Web, which WhatsApp's terms do not
  allow. WhatsApp can ban the number at any time. Telegram, SMS and the web stay
  the supported channels.

## Configuration

| Where | Name | Purpose |
| --- | --- | --- |
| Vercel (production) | `WHATSAPP_OPENWA_BOT_ENABLED` | `true` turns the routes and notices on. Unset means 404. |
| Vercel (production) | `WHATSAPP_OPENWA_RELAY_SECRET` | Shared with the relay, at least 32 characters. |
| Vercel (optional) | `WHATSAPP_OPENWA_ALLOWED_PHONES` | Comma-separated digits. When set, the bot answers only these numbers, for testing in production. |
| DGX `~/.agent-secrets/la-polla-openwa.env` | `WHATSAPP_OPENWA_RELAY_SECRET` | Same value as Vercel. |
| DGX `ops/whatsapp-openwa/relay.env` | `OPENWA_SESSION_ID`, `OPENWA_API_KEY`, `OPENWA_WEBHOOK_SECRET` | Written by `node setup.mjs init`, mode 600. |

The secrets never go into the repository. Changing the relay secret means
updating both places and redeploying.

## Turning it on

1. After review, apply `178_whatsapp_openwa_polls.sql` and deploy the app and relay
   together while the flag stays off. Migration 178 has **not** been applied by
   this implementation. Re-register the webhook with the updated
   `node setup.mjs webhook` so it includes `poll.vote`; no extra poll flag or
   dependency is needed.
2. Get a SIM for the bot number and activate WhatsApp on a phone. Tigo sells a new
   prepaid eSIM line online (`compras.tigo.com.co/esim`, 2026-10-29); its checkout
   only opens from a Colombian IP. The Z Flip4 test phone supports eSIM.
3. On the DGX, follow [ops/whatsapp-openwa/README.md](../ops/whatsapp-openwa/README.md)
   up to `node setup.mjs pair <number>`, and link the device.
4. With the owner's go-ahead, in Vercel production set `WHATSAPP_OPENWA_ALLOWED_PHONES` to the owner's
   number and `WHATSAPP_OPENWA_BOT_ENABLED=true`, then redeploy.
5. Write "hola" to the bot number. Check onboarding, all poll pages, one-tap
   choices, duplicate/changed votes, own votes and typed number/letter/title
   fallback; then a pool, proof and pick. Only after that smoke and the owner's
   approval, remove the allowlist and redeploy. Real WhatsApp delivery, @lid
   resolution and vote events remain unverified until the dedicated SIM is linked.

Turning it off: unset `WHATSAPP_OPENWA_BOT_ENABLED` and redeploy, or stop the
DGX stack (`docker compose stop`). Pending notices expire after 2 days.

## Tests

- `tests/whatsapp-player.test.ts`: formatting, menus, sender identity,
  deduplication, rate limit, proof staging, notices and the relay.
- `tests/whatsapp-openwa-route.test.ts`: 404 while off, signature before parsing,
  size limit, outbox claim/ack and signed poll-sent registration.
- `tests/whatsapp-openwa-polls.test.ts`: compact rendering, pagination/limits,
  typed fallback, stored vote identity, @lid, self-votes, expired/consumed votes,
  relay payloads and HMAC-signed vote/ack forwarding. Database claims are mocked;
  production migration execution is not implied by unit results.
- 2026-10-29 local run against the Docker Supabase: new number → account → name →
  pollito → open pools → join → proof (`pendiente`, stored) → picks 2-1 and 0-3
  through `casa_save_picks_v1` → duplicate id ignored → approval notice claimed and
  acknowledged.
