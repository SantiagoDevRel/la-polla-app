# OpenWA stack on the DGX

Runs the WhatsApp player bot gateway: OpenWA (WhatsApp Web) and the relay that talks
to La Polla on Vercel. Design and security: [docs/whatsapp-openwa-bot.md](../../docs/whatsapp-openwa-bot.md).

Everything uses its own names (`lapolla-openwa*` containers, network and volume),
so other DGX stacks are not touched. OpenWA listens only on `127.0.0.1:2785`.

## Files

| File | In Git | Purpose |
| --- | --- | --- |
| `docker-compose.yml` | yes | OpenWA 0.26.0 and the relay, both pinned by digest. |
| `relay.mjs` | yes | Webhook receiver, reply sender and notice poller. Node 22, no dependencies. |
| `setup.mjs` | yes | Session, scoped key, webhook and pairing commands. |
| `relay.env` | no | Written by `setup.mjs init`, mode 600. |
| `~/.agent-secrets/la-polla-openwa.env` | no | `WHATSAPP_OPENWA_RELAY_SECRET`, same value as Vercel. |

## First install

From the environment repository on the laptop:

```bash
node tools/secrets.mjs push la-polla-openwa.env       # relay secret to the DGX store
scp -r apps/la-polla/ops/whatsapp-openwa spark:~/apps/la-polla-openwa
```

On the DGX, in `~/apps/la-polla-openwa`:

```bash
docker compose pull
docker compose up -d openwa          # wait until healthy
node setup.mjs init                  # session, operator key, webhook secret → relay.env
docker compose up -d relay           # the webhook host must resolve before the next step
node setup.mjs webhook               # OpenWA → http://relay:8787/openwa
node setup.mjs test-webhook          # expects success and status 200
node setup.mjs start                 # session waits for a QR or a pairing code
```

## Link the number

Needs the bot SIM in a phone with WhatsApp active.

```bash
node setup.mjs pair 573001234567     # prints an 8-character code
```

On the phone: WhatsApp → Linked devices → Link a device → Link with phone number
instead, and type the code. `node setup.mjs qr qr.png` saves a QR image instead.
`node setup.mjs status` shows `ready` once linked.

Then follow "Turning it on" in the design doc (Vercel flag and allowlist).

## Operation

| Task | Command |
| --- | --- |
| Status | `node setup.mjs status` and `docker compose ps` |
| Relay health | `curl -s 127.0.0.1:2785/api/health/ready` (OpenWA); the relay reports `{ok, pending}` on its own `/health` inside the network |
| Logs | `docker compose logs --tail 100 relay` (no phone numbers or text) |
| Pause the bot | `node setup.mjs stop`, or `docker compose stop` |
| Resume | `docker compose start`, then `node setup.mjs start` |
| Update the relay | copy the new `relay.mjs`, then `docker compose restart relay` |
| Rotate the relay secret | new value in Vercel and in `~/.agent-secrets/la-polla-openwa.env`, redeploy, `docker compose up -d relay` |

The panel is available through an SSH tunnel: `ssh -L 2785:127.0.0.1:2785 spark`,
then `http://127.0.0.1:2785`.

Never run `docker compose down -v`: the volume `lapolla-openwa-data` holds the
linked WhatsApp session and the admin key. Losing it means linking the number again.
