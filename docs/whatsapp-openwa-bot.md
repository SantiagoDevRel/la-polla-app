# WhatsApp player bot (OpenWA)

Players use La Polla from a WhatsApp chat: create an account, join pools, send the
payment proof, predict, and see tables and payments. It reuses the Telegram player
bot screens and rules (`lib/telegram-player`); only the transport is different.

**Status (2026-10-29): shipped disabled.** Production answers 404 until
`WHATSAPP_OPENWA_BOT_ENABLED=true`. It still needs a dedicated SIM. Never use the
Zernio number: it serves the live WhatsApp login link.

## How it works

```
Player WhatsApp ──► OpenWA (DGX, whatsapp-web.js, 127.0.0.1:2785)
                      │ webhook message.received, X-OpenWA-Signature
                      ▼
                    relay (DGX, ops/whatsapp-openwa/relay.mjs)
                      │ same body, x-lapolla-timestamp + x-lapolla-signature
                      ▼
                    POST /api/whatsapp/openwa (Vercel) ──► lib/whatsapp-player/handler.ts
                      │ { outcome, replies: [{ to, text }] }
                      ▼
                    relay sends each reply through OpenWA send-text, in order

Approval or gift notice ──► whatsapp_bot_outbox ──► relay polls
                            POST /api/whatsapp/openwa/outbox (claim, ack)
```

- WhatsApp Web has no buttons. Each Telegram button becomes a numbered option.
  While the bot expects typed text that may be a number (ticket, score, Nequi
  account, free answer), options use letters instead. Goal buttons 0–9 become
  plain digit replies. `lib/whatsapp-player/format.ts` renders the screens;
  `whatsapp_bot_chats.menu` stores what each key means.
- A stored option is only a Telegram callback string. The Telegram flows validate
  it again against the database (visible pool, match of that pool, entry state).
- Proof images up to 3 MB arrive inline in the webhook. They are staged in
  `whatsapp_bot_media` for at most 2 hours, read back by id and phone, and go
  through the same `proof-server` contract as Telegram.
- Notices (payment approved or rejected, invite gift) go only to numbers that
  already wrote to the bot. The relay claims them every 30 seconds.

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
- The four `whatsapp_bot_*` tables (migration 176) are service-role only: RLS with
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

1. Get a SIM for the bot number and activate WhatsApp on a phone. Tigo sells a new
   prepaid eSIM line online (`compras.tigo.com.co/esim`, 2026-10-29); its checkout
   only opens from a Colombian IP. The Z Flip4 test phone supports eSIM.
2. On the DGX, follow [ops/whatsapp-openwa/README.md](../ops/whatsapp-openwa/README.md)
   up to `node setup.mjs pair <number>`, and link the device.
3. In Vercel production, set `WHATSAPP_OPENWA_ALLOWED_PHONES` to the owner's
   number and `WHATSAPP_OPENWA_BOT_ENABLED=true`, then redeploy.
4. Write "hola" to the bot number. Check the welcome, a pool, a proof and a
   pick. Then remove the allowlist and redeploy.

Turning it off: unset `WHATSAPP_OPENWA_BOT_ENABLED` and redeploy, or stop the
DGX stack (`docker compose stop`). Pending notices expire after 2 days.

## Tests

- `tests/whatsapp-player.test.ts`: formatting, menus, sender identity,
  deduplication, rate limit, proof staging, notices and the relay.
- `tests/whatsapp-openwa-route.test.ts`: 404 while off, signature before parsing,
  size limit, outbox claim and ack.
- 2026-10-29 local run against the Docker Supabase: new number → account → name →
  pollito → open pools → join → proof (`pendiente`, stored) → picks 2-1 and 0-3
  through `casa_save_picks_v1` → duplicate id ignored → approval notice claimed and
  acknowledged.
