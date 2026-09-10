# La Polla ⚽🇨🇴

App de pollas de fútbol. La Casa publica las pollas disponibles; los participantes
se inscriben con un comprobante de pago, pronostican y compiten en el ranking.
El modelo histórico de grupos privados permanece disponible.

Producción: **[lapollacolombiana.com](https://lapollacolombiana.com)**

## Fútbol: calendario, partidos y equipos (API-Football Pro)

La pestaña **Fútbol** (`/futbol`) presenta los nueve torneos con sus logos,
escudos, marcadores y acceso al detalle. El partido muestra goles, jugadas,
estadísticas, titulares y suplentes. Tocar un escudo abre la ficha del club:
plantel por posición, fotos, dorsales, edades, resultados, próximos partidos
e información e imagen del estadio. Desde el plantel se abre la última alineación.
Las estadísticas individuales se consultan dentro de cada alineación.
La ficha del club usa Próximos (inicial), Pasados, Plantel y Club en una barra
horizontal. El partido presenta ambos equipos con nombre y escudo centrados,
enlaces «Ver equipo» y marcador central, tomando como referencia la navegación
de [365Scores](https://www.365scores.com/es). Estadísticas agrupa General,
Ataque, Pases y Defensa; Más conserva métricas desconocidas del proveedor.
Las alineaciones permiten alternar Titulares/Suplentes además del equipo.

La propuesta visual se trabajó en [Lovable](https://lovable.dev/projects/4c4f70a0-dc3c-48d1-93af-6907944caabf)
con referencias de Tribuna Caliente. Conserva Bebas Neue/Outfit, vidrio oscuro,
controles con texto visible y secciones que se abren bajo demanda.

Aplicar las migraciones **092–095** en orden. Con las variables de abajo,
`/status` detecta automáticamente el plan: no hay un flag de Pro en el cliente.
El mes aprobado el 9 de septiembre de 2026 vence el 9 de octubre de 2026;
la autoridad es la fecha que devuelve el proveedor. Al vencer, las reservas
vuelven a los límites gratuitos y el detalle conserva la última información.

- Calendario de Fútbol: ±6 días, agrupados por **día de Colombia** (dos feeds UTC).
  Los equipos agregan sus últimos cinco y próximos cinco partidos, filtrados
  a los nueve torneos. No se fija un año de temporada para estas consultas.
- Pro: límite propio de 7.000 llamadas/día UTC frente a las 7.500 contratadas.
  El detalle y los equipos paran a las 6.000 para reservar capacidad a resultados.
  Un calendario cercano se comparte durante 60 segundos; el detalle activo,
  60 segundos; equipos y partidos finalizados, una hora. Cada ficha de equipo
  reserva cuatro llamadas antes de consultar. No se multiplican por espectador.
- El cliente actualiza el marcador cada 30 segundos y el calendario cada minuto;
  pausa las consultas con la pestaña oculta. Esto es actualización periódica,
  no streaming. La caché compartida decide si hace falta consultar al proveedor.
- API-Football es la fuente principal del vivo Pro. ESPN cubre partidos sin una
  observación reciente. `update_match_live_provider` serializa ambos: rechaza
  lecturas viejas, protege tres minutos la fuente principal y permite correcciones
  de VAR. Un resultado verificado no se modifica por un tick de vivo.
- Las rutas `/api/football/**` validan sesión antes de leer datos. Las tablas
  `api_football_details` y `api_football_teams` tienen RLS y acceso de servicio.
  Los endpoints y `/futbol/**` usan NetworkOnly; las respuestas son privadas.
- Los logos y fotos de API-Sports son imágenes públicas sin key en el cliente.
  Se cargan bajo demanda, con respaldo local para logos y dorsal/icono cuando
  falla una foto. Se evita Image Optimization. La cobertura de fotos, alineaciones
  y estadísticas depende del partido; los datos ausentes no se inventan.

Código: `lib/api-football/{account,feed,details,teams,live}.ts`,
`components/football/`, `app/api/football/`, `app/(app)/futbol/`.
Pruebas del modelo: `npm test -- tests/api-football-detail.test.ts`.

### Cobertura de escudos y logos

El detalle del partido abre **Estadísticas** por defecto. La barra horizontal
ofrece Estadísticas, Alineaciones y Resumen, con navegación por teclado y
etiquetas completas. Resumen contiene todos los eventos en una lista con scroll
interno cuando supera 55 % de la pantalla (máximo 28 rem); los goles llevan un
balón y las tarjetas, cambios y estadísticas tienen íconos acompañados de texto.
Los enlaces de última alineación conservan su apertura directa en Alineaciones.

La navegación presenta **ESTADÍSTICAS** con un balón clásico blanco y negro. El calendario usa un único
selector de fecha con el mes completo («Septiembre 08»), dentro de la ventana
vigente de seis días antes/después; no presenta atajos Ayer/Hoy/Mañana ni meses
numéricos ambiguos. El valor enviado a la API sigue siendo ISO.

La creación es exclusivamente administrativa (`/admin/pollas/crear`). Los
enlaces antiguos a `/pollas/crear` redirigen directamente a `/casa`, sin aviso
de transición ni formulario para jugadores. El POST P2P continúa bloqueado.

El catálogo incluye **258 clubes de las temporadas actuales**, los **280 nombres
de equipos observados en 3.515 partidos históricos** (incluidas selecciones) y
los nueve logos de API-Football. Todos tienen imágenes locales; las selecciones
conservan sus banderas. `crest-coverage.json` registra el inventario completo
para comprobar faltantes; nunca se importa en el cliente.

`TeamCrest` comparte la resolución en Fútbol, Casa, el creador y las vistas
históricas. `crest-overrides.json` corrige identidades revisadas: Club Brugge
tenía una URL histórica de Espanyol; Recoleta usa el escudo actual. La excepción
de Brugge se aplica al nombre del club, para no cambiar el logo de Espanyol.

Actualizar al incorporar equipos/temporadas:

```bash
node --experimental-strip-types scripts/bake-team-crests.mjs
npm test -- tests/football-media.test.ts
```

El script verifica la temporada vigente con `/leagues`, inventaría `/teams`
para los nueve torneos (18 llamadas con Pro), lee los partidos paginados y
genera WebP de hasta 96 px. No escribe en la DB ni elimina assets anteriores.
`--inventory <json> --fixtures <json>` permite repetir un inventario auditado
sin más consultas. Aborta ante imágenes vacías, clubes sin escudo o imágenes
idénticas para IDs de clubes diferentes. Los logos quedan en `league-logos.json`.
Revisar visualmente cualquier proveedor nuevo o cambio de identidad antes de
publicar: una imagen válida puede pertenecer al club equivocado.

Los escudos se sirven desde el mismo origen y entran a la caché al usarlos;
no se descargan cientos de imágenes durante la instalación del service worker.
Los proveedores se conservan como respaldo. Las restricciones preexistentes
de la app nativa iOS en las pantallas históricas permanecen separadas de la web.

## Resultados y alternativa gratuita

El cierre automático incorpora API-Football para BetPlay, Libertadores,
Sudamericana, Champions, Premier, Ligue 1, Bundesliga, La Liga y Serie A.
Guarda el marcador de **90 minutos + adición**; el 1X2 se deriva de ese marcador.
Alargue y penales se conservan aparte para los modos de puntaje existentes.

Configuración server-side, después de aplicar las migraciones 092 y 093:

```dotenv
# Obtener la clave en https://dashboard.api-football.com/profile?access
API_FOOTBALL_KEY=<clave privada>
API_FOOTBALL_FINALS_ENABLED=true
```

El plan gratuito acepta `/fixtures?date=YYYY-MM-DD` para fechas actuales aunque
rechace pedir la temporada completa. La integración consulta hoy/ayer en UTC,
filtra los nueve torneos y comparte una caché de 20 minutos. Solo consulta cuando
un partido vinculado a una polla necesita resultado. Una reserva atómica en la
DB limita esta integración a **80 solicitudes/día UTC**, sin reintentos HTTP;
quedan 20 de las 100 gratuitas para otras consultas. Con dos fechas activas y
uso continuo puede alcanzar el límite; ESPN/football-data siguen disponibles.

El cron existente `/api/matches/sync-live` ejecuta la verificación. Se exigen ambos
equipos, torneo y horario para identificar un partido. Una discrepancia bloquea
el cierre; sin corroboración se requieren dos respuestas nuevas del proveedor
(releer la caché no cuenta). Los tres proveedores y la resolución administrativa
pasan por `finalize_verified_match_result` → `finalize_match_result` (093),
sin escribir pronósticos directamente ni importar partidos duplicados.
El resultado verificado es inmutable para los syncs: el candado de fila serializa
actualizaciones en vivo y cierres. La importación se serializa por identidad
normalizada para evitar duplicados entre proveedores concurrentes. La DB no cuenta
como una segunda fuente de su propio proveedor.

Con Pro, API-Football aporta el vivo principal y ESPN actúa como respaldo;
en Free se conserva el vivo de ESPN. API-Football y football-data aportan
confirmación y resultados.
Un snapshot de 90 minutos solo se captura del estado explícito de fin reglamentario;
un resultado viejo o de alargue de otro proveedor nunca se convierte en ese snapshot.
football-data se interpreta según su [contrato de periodos](https://docs.football-data.org/general/v4/overtime.html):
extraTime suma solo goles del alargue y fullTime puede incluir la tanda.

**Calendario:** el creador muestra los próximos 10 días que ya están en la DB.
Si una liga está vacía, **Traer el calendario** importa los próximos 60 días
con ESPN y vuelve a consultar. Esto no consume la cuota de API-Football.

**Escudos:** TeamCrest usa el catálogo estático WebP. Para un club nuevo cuyo
escudo ESPN aún no esté horneado, usa el endpoint público de imágenes
`GET /api/teams/crest?espn=<id>` (ID numérico, host fijo, PNG de hasta 512 KiB,
caché compartida). No usa keys, DB ni Image Optimization de Vercel.
Para actualizar el catálogo: `node --experimental-strip-types scripts/bake-team-crests.mjs`.

Regresión de concurrencia: aplicar 093 en el PostgreSQL local de Supabase y ejecutar
`node scripts/test-result-concurrency.mjs`. Crea y retira solo sus fixtures sintéticos;
no ejecutarlo contra producción.

Diagnóstico (solo lectura, acceso de servicio):

```sql
SELECT request_day, requests_used, last_attempt_at FROM api_football_budget;
SELECT fixture_date, fetched_at, jsonb_array_length(fixtures) AS fixtures
FROM api_football_cache ORDER BY fixture_date DESC;
```

Pruebas: `npm test -- lib/api-football/results.test.ts tests/api-football-cache.test.ts tests/api-football-verification.test.ts`.

## Directorio de administración

En `/admin`, **Buscar un usuario** abre una lista con nombres y teléfonos.
Puedes buscar por cualquiera de los dos; al bajar se cargan más usuarios en
grupos de 50. El botón **Hacer admin** conserva la asignación de acceso global.
`GET /api/admin/promote?directory=1&page=0` sirve este directorio únicamente
a administradores autenticados, con respuestas privadas sin caché. La búsqueda
viaja codificada con `encodeURIComponent` en el header `X-User-Search` para no
incluir teléfonos en URLs. El panel
`/admin/*` y las API también usan `NetworkOnly` en el service worker.

## Crear y administrar pollas

- `/admin/pollas/crear`: formulario independiente para crear una polla.
  Puedes combinar hasta 30 partidos de distintas ligas; cambiar el torneo
  visible conserva la selección. Cada liga muestra su cantidad de elegidos y
  el resumen permite quitar partidos. El cierre automático usa el primer
  partido de toda la selección, sin importar qué liga estás mirando.
- `/admin/pollas`: una card desplegable por polla, con su cantidad de pagos
  pendientes. Al abrirla puedes ver cada comprobante y aprobar o rechazar el
  pago. Los conteos se actualizan cada 30 segundos mientras el panel está visible;
  la cola se carga por polla en páginas de 25.
- `GET /api/casa/admin/entries?summary=1`: conteos completos, solo administradores.
  `?pollaId=<uuid>`: comprobantes de esa polla, con respuestas privadas
  sin caché y URLs firmadas para las imágenes. La siguiente página usa
  `&cursor=<nextCursor>`; así revisar pagos desde otra sesión no salta filas.
- Compartir incluye el nombre, el valor de entrada y el enlace público directo.
- **Eliminar polla** aparece al final del detalle y en cada card administrativa.
  Exige rol de administrador y un clic de confirmación, sin escribir el nombre. Archiva con `archived_at`
  y `archived_by`: conserva pagos, pronósticos, estado y premios; no hace
  devoluciones ni transferencias. El enlace archivado responde 404.

Aplicar `supabase/migrations/091_casa_archive_and_lifecycle_guards.sql` antes
de desplegar. El bloqueo de la fila de la polla serializa revisiones de pagos,
archivo y reparto, también para Telegram. No permite repartir con comprobantes
pendientes ni cambiar inscripciones después del reparto o del archivo.

## Partidos, tabla e imágenes

`/casa` muestra **Pollas disponibles** y **Pollas cerradas**, estas últimas
comprimidas inicialmente. Cada polla muestra todos sus torneos, resueltos desde
los partidos asociados. El detalle tiene pestañas **Partidos / Tabla**; cambiar
de pestaña conserva los pronósticos sin guardar. La tabla muestra posiciones,
nombres, avatares y puntos sin el antiguo límite visual de 20 jugadores.

La tabla se actualiza cada 30 segundos mientras está visible mediante
`GET /api/casa/pollas/[slug]/leaderboard` (autenticación y `private, no-store`).
Los pagos en revisión pueden pronosticar dentro del plazo. El RPC SQL de tabla
incluye únicamente pagos aprobados, con los puntos de sus pronósticos válidos.
La cuenta para recibir premios se configura opcionalmente en `/perfil`; la
transferencia al ganador sigue siendo manual.

Los torneos usan variantes locales de 96 px. Los escudos usan
`components/match/TeamCrest.tsx`, un catálogo local con procedencia en
`public/team-crests/README.md` y respaldo del proveedor. Para actualizar las
copias sin añadir servicios ni dependencias:
`node --experimental-strip-types scripts/bake-team-crests.mjs`.
La navegación conserva los íconos y añade **Pollas / Perfil**. La Polla usa
español incluso con una antigua cookie de inglés; `chickenpicks.app` conserva
su idioma por dominio y sus páginas SEO.

Los datos históricos están respaldados; consulta
[docs/backup-restore.md](docs/backup-restore.md).

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

- **Next.js 16** App Router + TypeScript
- **Supabase** (PostgreSQL + Auth + RLS) — phone+password con OTP de WhatsApp solo en el primer login
- **Meta WhatsApp Cloud API** — bot conversacional para predecir/ver tabla, OTP de signup, recovery de clave
- **football-data.org** — fuente de fixtures y resultados (UCL + Mundial 2026)
- **Cloudflare Turnstile** — anti-bot en el flujo OTP (validado server-side)
- **Tailwind CSS** + **Framer Motion** + **lucide-react**
- **@serwist/next** — PWA instalable + service worker
- **Vitest** — unit tests (111 cubriendo helpers críticos)
- **Vercel** — deploy target con auto-deploy desde `main`

## Primeros pasos

### 1. Clonar e instalar

Requiere Node.js 22.12 o superior (Capacitor 8 y Vite 8).

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
npm run validate    # tsc --noEmit && eslint .
npm test            # vitest unit tests (111 tests)
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

## Backup y restore

El plan free de Supabase no incluye backups automáticos y pausa los
proyectos inactivos, así que la copia de los datos vive afuera:

```bash
npx tsx scripts/export-backup.ts    # dump completo (solo lectura)
npx tsx scripts/verify-backup.ts    # sha256 + filas, 100% offline
npx tsx scripts/restore-backup.ts   # dry run por default
```

Deja `backups/<fecha>/` con todas las tablas de `public`, `auth` (+ SQL de
restore con los mismos uuid), los archivos de Storage, las migraciones y un
`RESUMEN.md` con la tabla final de cada polla en texto plano. `backups/`
está en `.gitignore`: **lleva teléfonos y este repo es público.**

Guía completa: [docs/backup-restore.md](docs/backup-restore.md).

---

## Pendiente / Roadmap

- **`auth.uid()` raíz** — el JWT de SSR no llega al PostgREST → `auth.uid()` devuelve NULL. El workaround: 46 archivos usan `createAdminClient()` con filtros `.eq("user_id", user.id)` manuales. Ver `docs/auth-uid-handoff.md`.
- Optional: husky pre-commit hook + GitHub Actions CI cuando entren colaboradores.

---

## Legal

La plataforma no procesa pagos reales. El campo `payment_mode` solo registra el acuerdo entre participantes. El modelo actual está fuera del alcance regulatorio de Coljuegos por no involucrar procesamiento de dinero.

---

Construido con ☕ en Medellín / Lisboa por [@SantiagoDevRel](https://github.com/SantiagoDevRel)

### Mis pollas en Casa y Perfil (2026-09-09)

`components/casa/MyPollas.tsx` muestra las inscripciones reales del usuario,
con contador, estado de pago, búsqueda y páginas de cinco cuando hay muchas.
En `/casa`, el orden es Pollas abiertas, Mis pollas y Pollas cerradas. Las tres
empiezan cerradas, comparten título/subtítulo y contienen sus tarjetas dentro de
`PollaSection`. En Perfil, Mis pollas permanece abierta. Las inscripciones pendientes o pagadas se
muestran una vez por polla y se excluyen del listado para nuevas inscripciones.
Las rechazadas/anuladas y los borradores/archivados no se cuentan como participación.
El historial finalizado se conserva después de las participaciones actuales.

`lib/casa/my-pollas.ts` pagina las lecturas por usuario y deduplica entradas
de rifas sin cambiar datos. `/api/casa/mis-pollas` valida la sesión antes de
leer y devuelve solo nombres, destino, estado y torneos, con `private, no-store`.
Casa usa el mismo helper en el servidor; Perfil usa el endpoint. No se crean
inscripciones de demostración: cero es un resultado real; un fallo tiene su
propio estado con reintento. No se tocan pronósticos ni el modelo P2P histórico.

### Actualizaciones publicadas

`/api/app-version` devuelve únicamente el identificador público del build con
`Cache-Control: no-store`, sin consultar sesión ni base de datos. `SWAutoReload`
compara ese ID al abrir, volver a la pestaña, recuperar conexión y cada dos minutos
visibles. Una diferencia muestra «Actualizar app»; el usuario decide cuándo recargar.
Perfil incluye el mismo botón manual. La recarga conserva cookies y almacenamiento,
comprueba conexión y actualiza el worker sin desregistrarlo ni vaciar cachés.
Vercel aporta `VERCEL_DEPLOYMENT_ID`/`VERCEL_URL`; para probar dos builds locales,
usar `APP_BUILD_ID` distinto en cada `npm run build`. No requiere proveedor adicional.
