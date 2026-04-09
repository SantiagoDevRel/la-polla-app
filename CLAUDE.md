# CLAUDE.md — La Polla App
# Read this file at the start of every session. It contains all context needed to work on this project.

## What this project is
La Polla is a Colombian consumer app for football prediction pools (pollas), timed for the 2026 FIFA World Cup hosted in Colombia. Users create or join pools, predict match scores, and track rankings. No real money is processed by the platform in v1 — admins distribute winnings manually.

## Owner
Santiago Trujillo (GitHub: SantiagoDevRel). Colombian Developer Advocate based between Lisbon and Medellín.

---

## Stack
- **Framework**: Next.js 14 App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS (custom colors: colombia-blue, colombia-yellow, colombia-red)
- **Database**: Supabase (PostgreSQL with RLS enabled on all tables)
- **Auth**: WhatsApp OTP via Meta WhatsApp Cloud API — no passwords, no bypass, no dev mode
- **Bot**: Meta WhatsApp Cloud API webhook
- **Match data**: API-Football via RapidAPI
- **Anti-bot**: Cloudflare Turnstile
- **Deploy target**: Vercel

---

## Project structure
```
app/
  (app)/                  # Authenticated routes (protected by middleware)
    dashboard/page.tsx    # Main dashboard — lists user's pollas
    layout.tsx
    pollas/
      crear/page.tsx      # Create new polla form
      [slug]/page.tsx     # Polla detail: matches, predictions, ranking
  (auth)/                 # Public auth routes
    login/page.tsx
    verify/page.tsx
  api/
    auth/otp/route.ts     # OTP generate + verify
    matches/route.ts      # Match sync
    pollas/route.ts       # GET (list) + POST (create)
    pollas/[slug]/route.ts            # GET polla by slug with participants + matches + predictions
    pollas/[slug]/predictions/route.ts # POST upsert prediction for a match
    whatsapp/send/route.ts
    whatsapp/webhook/route.ts
components/
  polla/PollaCard.tsx
  polla/MatchPredictionCard.tsx
  ui/Button.tsx Input.tsx PhoneInput.tsx
  whatsapp/WhatsAppButton.tsx
lib/
  api-football/client.ts mappers.ts sync.ts
  supabase/admin.ts client.ts middleware.ts server.ts
  utils/otp.ts points.ts
  whatsapp/bot.ts messages.ts
supabase/migrations/001_initial_schema.sql
middleware.ts             # Auth middleware — redirects unauthenticated users to /login
```

---

## Supabase schema (tables + key columns)

### users
`id` uuid PK | `whatsapp_number` varchar(20) UNIQUE | `whatsapp_verified` bool | `email` varchar | `display_name` varchar(100) | `avatar_url` text | `created_at`

### matches
`id` uuid PK | `external_id` varchar(50) UNIQUE (API-Football ID) | `tournament` varchar(50) | `match_day` int | `phase` varchar(30) | `home_team` / `away_team` varchar(60) | `home_team_flag` / `away_team_flag` text | `scheduled_at` timestamptz | `venue` varchar(100) | `home_score` / `away_score` int (null until finished) | `status` ENUM('scheduled','live','finished','cancelled')

### pollas
`id` uuid PK | `slug` varchar(50) UNIQUE | `name` varchar(100) | `description` text | `created_by` uuid → users | `type` ENUM('open','closed') | `status` ENUM('active','finished','cancelled') | `tournament` varchar(50) | `scope` ENUM('full','group_stage','knockouts','custom') | `match_ids` uuid[] (only for scope=custom) | `buy_in_amount` numeric | `currency` varchar(10) DEFAULT 'COP' | `platform_fee_pct` numeric DEFAULT 0.00 | `prize_pool` numeric | `points_exact` int DEFAULT 5 | `points_winner` int DEFAULT 2 | `points_one_team` int DEFAULT 1 | `payment_mode` ENUM('honor','admin_collects','digital_pool') | `starts_at` / `ends_at` timestamptz

### polla_participants
`id` uuid PK | `polla_id` → pollas | `user_id` → users | `role` ENUM('admin','player') | `status` ENUM('pending','approved','rejected') | `paid` bool | `paid_at` timestamptz | `paid_amount` numeric | `payment_note` text | `total_points` int DEFAULT 0 | `rank` int | UNIQUE(polla_id, user_id)

### predictions
`id` uuid PK | `polla_id` → pollas | `user_id` → users | `match_id` → matches | `predicted_home` int | `predicted_away` int | `locked` bool DEFAULT false | `visible` bool DEFAULT false (becomes true when match goes live) | `points_earned` int DEFAULT 0 | UNIQUE(polla_id, user_id, match_id)

### polla_invites
`id` uuid PK | `polla_id` → pollas | `invited_by` → users | `whatsapp_number` varchar(20) | `token` varchar(64) UNIQUE | `status` ENUM('pending','accepted','expired') | `expires_at` timestamptz DEFAULT now() + 7 days

### whatsapp_messages
`id` uuid PK | `user_id` → users | `direction` ENUM('inbound','outbound') | `message_type` varchar(30) | `content` text | `wa_message_id` varchar(100) | `status` ENUM('sent','delivered','read','failed')

---

## Triggers (critical — do not bypass)
- **on_match_finished**: when match status changes to 'finished', calculates `points_earned` for all predictions of that match, then recalculates `total_points` and `rank` for all polla_participants. When status changes to 'live', sets `visible = true` and `locked = true` on all predictions for that match.
- **check_prediction_lock**: BEFORE INSERT OR UPDATE on predictions — raises exception if match starts in less than 5 minutes. The API route catches this and returns HTTP 409.

## RLS rules (critical — queries must respect these)
- `users`: only own row
- `matches`: SELECT for all, INSERT/UPDATE only via service role (admin client)
- `pollas`: SELECT active only, INSERT by creator, UPDATE by admin participant
- `polla_participants`: SELECT only if you are also a participant in that polla
- `predictions`: SELECT own rows always + all rows when visible=true, INSERT/UPDATE own rows only when locked=false

**Important**: The `pollas` table does NOT have a `participants` array column. Participants live in `polla_participants`. Always query that table separately to get participant data.

---

## Meta WhatsApp Cloud API
- Phone Number ID: `1050091718189402`
- Test number registered: `+573117312391`
- Access Token: stored in `WHATSAPP_ACCESS_TOKEN` env var — currently a temporary EAAT... token. Must be replaced with a System User Token before production deploy.
- Webhook: not yet connected to public URL. Needs ngrok for local dev or Vercel URL for production.
- In development mode, Meta only allows sending messages to pre-registered test numbers. Any other number will be rejected.

## API-Football (RapidAPI)
- Used as the oracle for match results
- World Cup 2026 tournament ID: to be confirmed after tournament starts
- Liga BetPlay (Colombia) ID: 239
- Sync module: `lib/api-football/sync.ts`

## Cloudflare Turnstile
- Test keys configured for localhost (always pass in dev)
- Must be replaced with real site key + secret key before production

---

## Product decisions (do not change without explicit instruction)
- Auth is always WhatsApp OTP. No passwords. No email-only login. No dev bypass.
- Login page has country selector (react-phone-number-input), default +57 (Colombia).
- Pollas can be open or closed. Scope: full tournament, group stage, knockouts, or custom match selection.
- 3 payment modes: `honor` (no upfront, players pay winner directly), `admin_collects` (admin collects and distributes, platform only tracks), `digital_pool` (admin declares total, platform shows who to pay).
- `platform_fee_pct` starts at 0.00. Do not add fee logic unless explicitly requested.
- Predictions lock 5 minutes before match start (enforced by DB trigger, not only frontend).
- Predictions are only visible to other users once the match goes live (visible=true).
- Match results come from API-Football, not from manual admin input.

---

## Environment variables (never hardcode these)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=1050091718189402
WHATSAPP_WEBHOOK_VERIFY_TOKEN=
RAPIDAPI_KEY=
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
```

---

## Current status and what is NOT built yet
As of the start of this session:
- Base setup, Supabase schema, WhatsApp OTP auth, and basic dashboard: DONE
- `app/(app)/pollas/[slug]/page.tsx`: built in current session
- `app/api/pollas/[slug]/route.ts`: built in current session
- `app/api/pollas/[slug]/predictions/route.ts`: built in current session
- WhatsApp bot webhook: built but NOT connected (needs public URL)
- Match import from API-Football: NOT done
- Vercel deploy: NOT done
- System User Token (permanent Meta token): NOT done
- Real Turnstile keys: NOT done

## Pending work in priority order
1. Import World Cup 2026 matches from API-Football
2. Connect WhatsApp webhook (ngrok for dev, then Vercel URL)
3. Vercel deploy
4. Replace temporary Meta access token with System User Token
5. Replace Cloudflare Turnstile test keys with production keys

---

## Code conventions
- All files start with a comment explaining what the file does
- No hardcoded secrets or IDs in source code
- TypeScript strict mode — no `any` unless unavoidable and commented
- Supabase server client for all server-side queries (never use anon client in API routes)
- Supabase admin client only for operations that bypass RLS (match sync, webhook processing)
- Always use `upsert` with `onConflict` for predictions to handle both insert and update in one call
- Error responses always include `{ error: "message" }` and appropriate HTTP status code

## Legal
- The platform does not process real money in v1
- Admins distribute winnings manually
- `payment_mode` field tracks the arrangement but the platform is only a tracker
- Low regulatory risk under current model (no payment processing = outside Coljuegos scope)
