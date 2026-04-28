# La Polla ⚽🇨🇴

App de pollas (predicciones de fútbol) para el Mundial Colombia 2026 y otras competencias. Crea grupos privados con tus amigos, predice marcadores, y compite en un ranking en tiempo real.

Producción: **[lapollacolombiana.com](https://lapollacolombiana.com)**

## Filosofía: free-tier punta a punta

La Polla es **gratis para todos** y se mantiene sobre planes gratuitos
de cada proveedor. Esto es una restricción dura, no una preferencia:

- **Vercel** plan Hobby — sin crons pagos, sin Edge Config, sin
  `maxDuration` > 60s. Sync de partidos es lazy (disparado por
  requests reales) en vez de cron — ver `lib/matches/ensure-fresh.ts`.
- **Supabase** plan free — 500 MB DB / 50k MAU. Schema y queries
  diseñadas dentro de esos límites.
- **football-data.org** plan free — 10 req/min. La sync usa filtro
  `dateFrom/dateTo` chico + throttle adaptativo.
- **Twilio Verify** — pay-as-you-go con presupuesto controlado por
  `TWILIO_MONTHLY_BUDGET_USD`.
- **Meta WhatsApp Cloud API**, **Resend** — free tiers.

Antes de agregar un servicio, verificá que tenga free-tier viable. Si
una limitación bloquea un feature, listá el tradeoff y dejá que el
usuario decida — no asumas que pagar está OK. Mismo principio en
`CLAUDE.md` para sesiones con Claude.

## Stack

- **Next.js 14** App Router + TypeScript
- **Supabase** (PostgreSQL + Auth + RLS) — phone+password con OTP de WhatsApp solo en el primer login
- **Meta WhatsApp Cloud API** — bot conversacional para predecir/ver tabla, OTP de signup, recovery de clave
- **football-data.org** — fuente de fixtures y resultados (UCL + Mundial 2026)
- **Cloudflare Turnstile** — anti-bot en el flujo OTP (validado server-side)
- **Tailwind CSS** + **Framer Motion** + **lucide-react**
- **@serwist/next** — PWA instalable + service worker
- **Vitest** — unit tests (41 cubriendo helpers críticos)
- **Vercel** — deploy target con auto-deploy desde `main`

## Primeros pasos

### 1. Clonar e instalar

```bash
git clone https://github.com/SantiagoDevRel/la-polla-app
cd la-polla-app
npm install
```

### 2. Variables de entorno

```bash
cp .env.example .env.local
```

Llenar en `.env.local`:

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Meta WhatsApp Cloud API
META_WA_ACCESS_TOKEN=
META_WA_PHONE_NUMBER_ID=
META_WA_WEBHOOK_VERIFY_TOKEN=
META_WA_APP_SECRET=

# Cloudflare Turnstile (test keys para dev: 1x00000000000000000000AA / 1x0000000000000000000000000000000AA)
NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY=
CLOUDFLARE_TURNSTILE_SECRET_KEY=

# football-data.org
FOOTBALL_DATA_KEY=

# Cron / admin (server-only)
CRON_SECRET=

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_WHATSAPP_BOT_NUMBER=573117312391
```

### 3. Supabase migrations

Aplicar todo `supabase/migrations/*.sql` en orden. Si usas Supabase CLI: `supabase db push`. Si trabajas vía dashboard, copiá y pegá cada archivo en el SQL Editor.

### 4. Correr en local

```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

### Validación pre-commit (manual)

```bash
npm run validate    # tsc --noEmit && next lint
npm test            # vitest unit tests (41 tests)
```

---

## Cómo funciona

### Auth

- **Primera vez (registro)**: número de teléfono → OTP por WhatsApp → crear contraseña (4+ caracteres, alfanumérica) → completar onboarding (nombre + pollito).
- **Login normal**: número + contraseña, sin pasar por el bot ni Turnstile (el rate-limit cubre brute-force).
- **Olvidé clave**: link en `/login/password` regresa al flujo OTP. Validar el código resetea la clave a un valor temporal y vuelve a forzar `/set-password`.

Detalle: el server NUNCA ve la contraseña HMAC-derivada del teléfono — usa una random temp pwd entre el OTP success y la creación de la real. La sesión se mantiene viva al cambiar la clave (usa `supabase.auth.updateUser`, no admin API).

### Pollas

Una polla es un grupo PRIVADO de pronósticos (`type='closed'` siempre). El creador configura:
- Torneo (Mundial 2026, UCL 2024-25, etc.)
- Alcance (torneo completo, fase de grupos, eliminatorias, partidos custom)
- Modo de pago: `admin_collects` (organizador recoge en Nequi/efectivo) o `pay_winner` (todos pagan al ganador al final)
- Monto de entrada en COP
- Distribución de premios (porcentaje o monto fijo, configurable después)

Para entrar a una polla ajena:
- **Link de invitación** del organizador (`pollas.invite_token`)
- **Código de 6 caracteres** del organizador, usable desde la app o desde el bot

### Pronósticos

- Cada participante predice el marcador exacto de cada partido.
- Los pronósticos se cierran 5 min antes del kickoff (trigger DB `check_prediction_lock`).
- Los pronósticos ajenos son invisibles hasta que el partido pase a `live`.
- Sistema de 5 niveles:
  - Marcador exacto → 5 pts (configurable por polla)
  - Ganador correcto + misma diferencia de gol → 3 pts
  - Ganador correcto solamente → 2 pts
  - Acertar el marcador de un solo equipo → 1 pt
  - Nada → 0

### Sistema de puntos

El trigger `on_match_finished` recalcula puntos cuando el partido pasa a `finished`. El ranking dentro de cada polla usa `RANK()` window function (empates comparten posición). El recálculo se replica en TS (`lib/scoring.ts`) para casos manuales.

### WhatsApp bot

`/api/whatsapp/webhook` recibe inbound del bot. Comportamientos:
- Mensajes "hola", "menu", "muestrame el menu" → menú principal
- Código de 6 caracteres → confirma + agrega a la polla
- Link de polla → "esa polla es privada, pedile el código al admin"
- Estado de conversación persistido en `whatsapp_conversation_state` (TTL 10 min) para flujos multi-paso (predecir, etc.)

Botones interactivos vía Meta Cloud API (button + list messages, CTA URL).

### Login events en /avisos

Cada login exitoso (password u OTP) genera una notificación tipo `login_event` con device + ciudad+país (de los headers de Vercel). Aparece en el feed de avisos del usuario.

---

## Estructura del proyecto

```
app/
  (app)/              # Rutas autenticadas
    inicio/           # Home: hero, en vivo, próximos, podio, rivales
    pollas/           # Lista de pollas + crear (wizard 3 pasos) + detalle
    perfil/           # Perfil + cambiar clave
    avisos/           # Feed de notificaciones (incluye login events)
    invites/polla/    # Landing de invite (con preview)
    admin/matches/    # Sync manual de partidos (admin only)
  (auth)/             # Rutas públicas / pre-onboarded
    login/            # Phone input → check-phone → password o bot-OTP
    login/password/   # Phone+password input
    set-password/     # Crear o resetear clave (mandatory post-OTP)
    verify/           # Backward-compat: ingresa código del bot
    onboarding/       # Nombre + pollito
  api/
    auth/check-phone, login-password, set-password, otp, login-poll, login-wait
    pollas/, pollas/[slug]/{join,predictions,payments,...}
    whatsapp/webhook, matches/sync, admin/...
  sw.ts               # Service worker source (Serwist genera /public/sw.js)
components/
  polla/              # PollaCard, PaymentsList, OrganizerPanel, etc.
  inicio/             # PodiumCarousel, GreetingHero, RivalChip, etc.
  shared/             # WhatsAppBubble (header de inicio), TournamentBadge
  avisos/             # AvisosList con tipos + iconos
  ui/                 # PhoneInput, Toast, Button, etc.
lib/
  auth/               # phone, turnstile, login-event, user-agent, rate-limit, admin
  db/columns.ts       # Listas explícitas — evita select("*")
  log.ts              # redactPhone/Id/Text para no leakear PII en logs
  whatsapp/           # bot, flows, menu-intent, interactive, state, bot-phone
  matches/, pollas/, scoring.ts, notifications.ts
supabase/migrations/  # 001 → 020. Append-only. Cada uno está documentado.
```

---

## Deploy

`main` se auto-despliega en Vercel. Para forzar prod manual: `vercel --prod`.

Después de un deploy nuevo:
1. Verificá que `npm run validate` pasa antes de pushear
2. Confirmá envs en Vercel → Settings → Environment Variables (incluido `CLOUDFLARE_TURNSTILE_SECRET_KEY` que ahora se valida server-side)
3. Confirmá que el webhook de Meta apunta a `https://lapollacolombiana.com/api/whatsapp/webhook`
4. Confirmá Site URL de Supabase → Auth en `lapollacolombiana.com`

---

## Tags de seguridad / rollback

- `pre-wompi-removal` — antes de eliminar el flujo Wompi/digital_pool

Para revertir cualquier deploy: `git revert <sha> && git push origin main`.

---

## Pendiente / Roadmap

- **`auth.uid()` raíz** — el JWT de SSR no llega al PostgREST → `auth.uid()` devuelve NULL. El workaround: 46 archivos usan `createAdminClient()` con filtros `.eq("user_id", user.id)` manuales. Ver `docs/auth-uid-handoff.md`.
- Optional: husky pre-commit hook + GitHub Actions CI cuando entren colaboradores.
- Optional: error reporting (Sentry/Axiom) cuando el volumen lo justifique.

---

## Legal

La plataforma no procesa pagos reales. El campo `payment_mode` solo registra el acuerdo entre participantes. El modelo actual está fuera del alcance regulatorio de Coljuegos por no involucrar procesamiento de dinero.

---

Construido con ☕ en Medellín / Lisboa por [@SantiagoDevRel](https://github.com/SantiagoDevRel)
