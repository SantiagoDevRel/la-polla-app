# La Polla ⚽🇨🇴

App de pollas de fútbol. La Casa publica las pollas disponibles; los participantes
se inscriben con un comprobante de pago, pronostican y compiten en el ranking.
El modelo histórico de grupos privados permanece disponible.

Producción: **[lapollacolombiana.com](https://lapollacolombiana.com)**

### Horarios y torneos (2026-09-13)

Sudamericana y Europa League (`europa_2026`, liga 3 de API-Football)
están habilitadas para estadísticas, creación de pollas y sincronización.
Sus logos y escudos son archivos locales; Europa incluye 76 clubes de la temporada.

El calendario de Casa se actualiza **antes** de responder al administrador, aunque
ya tenga partidos guardados. `refreshTournamentSchedule` comparte una reserva SQL
de 15 minutos con `/api/matches` y el cron de descubrimiento existente (cada seis
horas). Desde el 2026-09-13 trae la temporada completa de API-Football, la única
fuente (ver «Calendario» abajo). Las ligas se actualizan independientemente de las
pollas P2P antiguas.
Una actualización fallida o en curso no se presenta como exitosa; el cliente recibe
un aviso y usa `private, no-store`.

Migración **103**: `scheduled_at_confirmed` distingue una fecha provisional de un
pitazo confirmado. Los partidos sin hora fija de API-Football (antes `SCHEDULED` de
football-data y `timeValid=false` de ESPN) conservan la fecha sin convertirla al día
anterior y se muestran como «hora por confirmar».
Una hora confirmada sí se convierte a Colombia. El RPC central conserva identidades de proveedor,
promueve fechas provisionales sin crear otro UUID y rechaza identidades ambiguas;
una observación provisional no reemplaza un horario confirmado. Mantiene compatible
la firma anterior del RPC y no recalcula pronósticos, puntos ni resultados.

El incidente Barcelona–Racing / Atlético–Osasuna se debía a fechas antiguas
`2026-09-16T00:00Z` de football-data guardadas como horas reales, que en Colombia se
veían como martes 15. Los horarios verificados son miércoles 16, 14:30 y 12:00 en
Colombia, respectivamente. La migración corrige esos registros con el mismo RPC.
Los proveedores todavía pueden reprogramar o equivocarse: la reserva no equivale
a una garantía en tiempo real ni a que todos los horarios futuros sean definitivos.

Verificación local:

```powershell
Get-Content -Raw scripts/match-schedule-check.sql | docker exec -i supabase_db_la-polla psql -U postgres -d postgres -X -v ON_ERROR_STOP=1
npm test -- tests/match-schedule.test.ts tests/tournament-availability.test.ts tests/football-media.test.ts
```

Info por polla, cuenta personal de pago, revisión de comprobantes, pozo fijo,
publicación programada y fechas en Colombia: [contrato y pruebas de Casa](docs/casa-admin-rules.md)
(migraciones 104–109; requieren Casa v2).

## Fútbol: calendario, partidos y equipos (API-Football Pro)

La pestaña **Fútbol** (`/futbol`) presenta los diez torneos con sus logos,
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

- Filtros: **Torneos** (lista) y **Equipos** (búsqueda). Buscar un equipo filtra
  los partidos del día y lista hasta seis clubes del catálogo local
  (`lib/teams/crest-coverage.json`, armado en el servidor, sin consultas a la API)
  con enlace a su ficha. La ficha solo carga equipos con partidos en caché de
  los últimos o próximos siete días.
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
- API-Football es la única fuente del vivo (el respaldo ESPN se eliminó el
  2026-09-13). `update_match_live_provider` rechaza lecturas viejas y permite
  correcciones de VAR. Un resultado verificado no se modifica por un tick de vivo.
- Las rutas `/api/football/**` validan sesión antes de leer datos. Las tablas
  `api_football_details` y `api_football_teams` tienen RLS y acceso de servicio.
  Los endpoints y `/futbol/**` usan NetworkOnly; las respuestas son privadas.
- Los logos y fotos de API-Sports son imágenes públicas sin key en el cliente.
  Las alineaciones y el plantel también resuelven la foto por el ID confirmado
  de API-Football cuando falta en las estadísticas; esto no consume consultas
  adicionales a la API. Nunca se mezclan IDs de ESPN/FIFA con los de API-Football.
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
los nueve logos de las competiciones. Todos tienen imágenes locales; las selecciones
conservan sus banderas. `crest-coverage.json` registra el inventario completo
para comprobar faltantes; nunca se importa en el cliente.

`TeamCrest` comparte la resolución en Fútbol, Casa, el creador y las vistas
históricas. `crest-overrides.json` corrige identidades revisadas: Club Brugge
tenía una URL histórica de Espanyol; Recoleta usa el escudo actual. La excepción
de Brugge se aplica al nombre del club, para no cambiar el logo de Espanyol.

Los escudos se muestran sin placas blancas. Sportivo Trinidense tiene una
variante transparente de ESPN. Champions, Premier, Bundesliga y Libertadores
usan las variantes `500-dark` de ESPN, descargadas a 192 px desde su CDN.
Serie A usa [el vector de su marca](https://commons.wikimedia.org/wiki/File:Serie_A.svg),
con el rectángulo de fondo eliminado y el texto claro; sus trazados y colores
del símbolo se conservan. Ligue 1 y Sudamericana tienen tratamiento monocromo
claro mediante `getTournamentLogoClassName`. `league-logo-overrides.json` y
`crest-overrides.json` conservan estas decisiones cuando se regenera el catálogo.

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

## Resultados API-Football

API-Football es la **única** fuente de calendario, vivo y resultados desde el
2026-09-13; ESPN y football-data se eliminaron del código. El cierre automático
cubre BetPlay, Libertadores, Sudamericana, Champions, Europa League, Premier,
Ligue 1, Bundesliga, La Liga y Serie A.
Guarda el marcador de **90 minutos + adición**; el 1X2 se deriva de ese marcador.
Alargue y penales se conservan aparte para los modos de puntaje existentes.

Configuración server-side, después de aplicar las migraciones 092 y 093:

```dotenv
# Obtener la clave en https://dashboard.api-football.com/profile?access
API_FOOTBALL_KEY=<clave privada>
```

`API_FOOTBALL_FINALS_ENABLED` ya no se lee: sin `API_FOOTBALL_KEY` no hay verificación.

El plan gratuito acepta `/fixtures?date=YYYY-MM-DD` para fechas actuales aunque
rechace pedir la temporada completa. La integración consulta hoy/ayer en UTC,
filtra los nueve torneos y comparte una caché de 20 minutos. Solo consulta cuando
un partido vinculado a una polla necesita resultado. Una reserva atómica en la
DB limita esta integración a **80 solicitudes/día UTC**, sin reintentos HTTP;
quedan 20 de las 100 gratuitas para otras consultas. Con dos fechas activas y
uso continuo puede alcanzar el límite (histórico del plan Free; con Pro rigen los
topes de la sección Fútbol). No hay otra fuente: al agotarse la cuota la verificación
espera al siguiente tick o a la resolución manual.

El cron existente `/api/matches/sync-live` ejecuta la verificación. Se exigen ambos
equipos, torneo y horario para identificar un partido. Una discrepancia bloquea
el cierre; sin corroboración se requieren dos respuestas nuevas del proveedor
(releer la caché no cuenta). La verificación y la resolución administrativa
pasan por `finalize_verified_match_result` → `finalize_match_result` (093),
sin escribir pronósticos directamente ni importar partidos duplicados.
El resultado verificado es inmutable para los syncs: el candado de fila serializa
actualizaciones en vivo y cierres. La importación se serializa por identidad
normalizada para evitar duplicados entre proveedores concurrentes. La DB no cuenta
como una segunda fuente de su propio proveedor.

Filas vinculadas (`apifootball:<id>` en `external_id` o `source_external_ids`) se
emparejan por id de fixture + competición + saque ±2 h; las demás, por nombres. Los
puntos usan `score.fulltime` (90'); `goals` es el marcador de 120' y `score.penalty`
la tanda. Un snapshot `regulation_*` distinto veta el cierre.

`/admin/discrepancias` acepta `{source:"api-football"}` (confirma la última lectura
en caché, sin gastar cuota) o `{source:"manual",home,away}`; `espn` y `fd` responden 400.

**Calendario (desde 2026-09-13, solo API-Football):** el creador ofrece
«Próximos 10 días», «30 días» y «Toda la temporada», agrupados por fecha en hora de
Colombia. La temporada completa de cada liga se importa desde API-Football
(`lib/api-football/calendar.ts`, 1 solicitud por liga) y el cron la refresca por
diferencias. **Actualizar calendario** fuerza ese refresco. Los partidos sin hora
fija muestran «hora por confirmar». Un partido aplazado (PST) cuyo saque sigue en
el futuro se muestra con la hora que trae API-Football y se puede elegir; uno con
fecha vieja no entra hasta que el proveedor publique la nueva.

Desde la migración **118** los partidos provisionales se pueden meter en pollas con
cierre automático: el cierre usa su hora provisional (la misma del candado de
pronósticos) y se recalcula solo cada vez que el calendario confirma o reprograma
un partido de la polla, o cuando se vincula un partido. Nunca reabre una polla cuyo
cierre ya pasó. Regresión: `scripts/casa-auto-close-check.sql` (encadenada con la
migración en una transacción que termina en ROLLBACK; ver el encabezado del script).
Corte: `docs/af-cutover-today.md`. La fila `app_config.data_provider_mode` quedó en la
DB pero ningún código la lee: no hay vuelta a ESPN/football-data.

**Escudos:** TeamCrest usa el catálogo estático WebP. Una URL histórica de ESPN
es identidad, nunca imagen; el proxy `/api/teams/crest` se eliminó el 2026-09-13.
No usa keys, DB ni Image Optimization de Vercel.
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
  Los partidos se agrupan en semanas plegables de lunes a domingo («Esta semana»,
  «Próxima semana», «Semana del…»), cerradas al entrar, y **Buscar equipo** filtra
  la lista cargada y abre las semanas con resultados. Cada fila muestra la jornada.
  El modo de puntaje se elige con «Acierta ganador del partido» o «Acierta marcador
  exacto», el mismo texto que ven los jugadores.
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

### Resolver y repartir sin el bot (2026-09-12)

- **Polla manual:** al abrir su card en `/admin/pollas` aparecen sus preguntas.
  Cada una se resuelve eligiendo la opción correcta o escribiendo la respuesta
  libre; al guardar se repuntúa la polla completa y se indica cuántas faltan.
- **Rifa:** la misma card pide el número que salió y dice en el momento si esa
  boleta se vendió o no, antes de repartir.
- Los comandos `/resolver`, `/respuesta` y `/numero` del bot siguen vigentes y
  escriben exactamente lo mismo, con los mismos guardas: una pregunta ya
  resuelta no se sobrescribe (`resolved_at IS NULL`) y el número respeta el
  rango de boletas. Ninguna de las dos vías toca una polla repartida,
  anulada o eliminada.

### Reparto del pozo: solo el ganador (migración 096)

`supabase/migrations/096_casa_pozo_solo_ganador.sql` deja el reparto en una
sola regla. **Aplicada en producción el 2026-09-12** (verificada comparando
`md5(prosrc)` de la función en prod contra la del entorno local creada desde
este mismo archivo: idénticas). Es `CREATE OR REPLACE`, así que re-aplicarla no
rompe nada. La regla:

- El pozo (`casa_polla_pot.prize_cop`) va COMPLETO al puntaje más alto. Nunca
  hay segundo ni tercer puesto: `casa_payouts.place` siempre es 1.
- Si varios empatan arriba, se divide en partes iguales entre ellos. Los pesos
  sueltos del redondeo también van a los ganadores, en orden estable por
  `user_id`, así que la suma de `casa_payouts` es exactamente el pozo.
- Sin ganador no se reparte y no se escribe ningún pago: si nadie sumó puntos,
  o si la boleta sorteada no la compró nadie, el reparto falla con un mensaje
  que explica qué pasó. Qué hacer con esa plata lo decide la casa, no el código.

Regresión: `scripts/casa-settle-check.sql` arma pollas de prueba en un Supabase
LOCAL y verifica los cinco casos con `ASSERT` — ganador único (quien no pagó no
entra), empate con sobrante de redondeo, nadie con puntos, rifa cuya boleta no
se vendió y doble reparto. Se corre así, y no toca datos reales:

```bash
docker exec -i supabase_db_la-polla psql -U postgres -d postgres < scripts/casa-settle-check.sql
```

## Partidos, tabla e imágenes

`/casa` muestra **Pollas disponibles** y **Pollas cerradas**, estas últimas
comprimidas inicialmente. Cada polla muestra todos sus torneos, resueltos desde
los partidos asociados, solo con sus logos. Cada tarjeta de pollas abiertas o
cerradas indica qué hay que acertar: «Acierta ganador del partido» (1X2) o
«Acierta marcador exacto». El detalle arranca con un hero compacto (logos,
nombre, estado, modo de puntaje, pozo y entrada, Entrar + Compartir) para que las
pestañas **Partidos / Tabla / Info** se vean sin bajar; cambiar de pestaña
conserva los pronósticos sin guardar. Info agrupa las reglas en desplegables
cerrados con viñetas cortas; con premio fijo explica desde cuántas inscripciones
crece el pozo y cuánto suma cada persona adicional (cifras calculadas en SQL). La tabla muestra posiciones,
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

> **Actualización 2026-09-13:** el dueño aprobó y paga **Vercel Pro** (team
> `santiago-prod`), **Supabase Pro con compute Small** y **API-Football Pro**
> para producción. Esos planes no se discuten; lo demás de esta sección sigue
> vigente (nada de servicios, upgrades ni add-ons nuevos sin aprobación).

- **Vercel** plan Pro — los partidos se siguen sincronizando con pg_cron de
  Supabase (`/api/matches/discover` cada 6 h, `/api/matches/sync-live` cada
  minuto) y los crons `/api/cron/*` corren desde GitHub Actions.
- **Supabase** plan Pro, compute Small (org Pro compartida con otros
  proyectos). Schema y queries siguen diseñadas para gastar poco.
- **API-Football** plan Pro aprobado por el dueño — cuota reservada en SQL
  antes de cada consulta (ver sección Fútbol).
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
- **API-Football** — única fuente de calendario, vivo y resultados (desde 2026-09-13)
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
# sb_secret_..., solo servidor: IP real en los límites de Supabase Auth
SUPABASE_SECRET_KEY=

# Meta WhatsApp Cloud API
META_WA_ACCESS_TOKEN=
META_WA_PHONE_NUMBER_ID=
META_WA_WEBHOOK_VERIFY_TOKEN=
META_WA_APP_SECRET=

# Cloudflare Turnstile (test keys para dev: 1x00000000000000000000AA / 1x0000000000000000000000000000000AA)
NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY=
CLOUDFLARE_TURNSTILE_SECRET_KEY=

# API-Football (server-only)
API_FOOTBALL_KEY=

# Cron / admin (server-only)
CRON_SECRET=

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
# WhatsApp: apagado. El número anterior del bot ahora es de otra app.
# Solo con un número propio: WHATSAPP_OUTBOUND_ENABLED=true y
# NEXT_PUBLIC_WHATSAPP_BOT_NUMBER=<E.164 sin +>.
WHATSAPP_OUTBOUND_ENABLED=
NEXT_PUBLIC_WHATSAPP_BOT_NUMBER=

# Login alternativo por Telegram (bot PÚBLICO, distinto del bot admin).
# Las tres o ninguna: con alguna vacía el canal queda apagado.
TELEGRAM_LOGIN_BOT_TOKEN=
TELEGRAM_LOGIN_WEBHOOK_SECRET=            # 32-256 caracteres [A-Za-z0-9_-]
NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_USERNAME=  # sin @
# Opcional. Vacío = cuentas que ya existían (SMS) solo entran por SMS.
# true = el dueño acepta el riesgo del número reciclado (ver «Login por Telegram»).
TELEGRAM_LOGIN_ALLOW_EXISTING_ACCOUNTS=
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

- **Login por SMS (principal)**: número → `/api/auth/start-otp` (Supabase `signInWithOtp`, hoy Twilio Verify) → código → `/api/auth/verify-otp` deja la sesión en cookies `sb-<ref>-auth-token` (hoy sin `HttpOnly` ni `Secure`, default de `@supabase/ssr`; ver «Estado en producción»). Sin contraseña. Usuarios nuevos pasan por `/onboarding` (nombre + pollito).
- **SMS por LabsMobile (preparado, apagado)**: `app/api/auth/sms-hook` es el Send SMS Hook de Supabase Auth. Supabase genera y valida el código; el hook solo lo entrega con `lib/sms/labsmobile.ts` (SMS plano, nunca el endpoint 2FA del proveedor) y lo registra en `sms_entregas` (migración 088). LabsMobile avisa la entrega en `/api/sms/ack`, protegido con `SMS_ACK_SECRET`. Mientras `hook_send_sms_enabled=false`, Supabase sigue enviando por Twilio Verify.
- **Login por Telegram (alternativa, 2026-09-13)**: si el SMS no llega, `/login` ofrece «Recibe tu código por Telegram». Ver la sección siguiente.

#### Login por Telegram

Bot **público y separado** del panel de admin. El bot nunca acepta un número escrito:

1. `/login` → «Abrir Telegram» (`t.me/<bot>?start=login`, o `login_en` en chickenpicks.app).
2. El bot (`/start` o `/login`) muestra un teclado con **Compartir mi número** (`request_contact`). Solo acepta el contacto propio: chat privado, `contact.user_id === from.id`, sin reenvío. Número → E.164 con `toE164` (`lib/auth/phone.ts`).
3. `telegram_login_issue` (migración 115) emite un **código de 6 dígitos** y un **enlace de un solo uso** (`/api/auth/telegram-link?t=…`). En la base solo hay HMAC-SHA256 con pepper del servidor (derivado del token del bot); el hash del código incluye el teléfono. Vence en 10 min; emitir uno nuevo invalida el anterior; canjear código o enlace invalida ambos; 5 fallos matan el token.
4. La persona escribe el código en `/login` → `/api/auth/telegram-verify` (POST JSON same-origin, 5 intentos / 15 min por teléfono en `otp_rate_limits`). El enlace también funciona, pero si se abre dentro de Telegram la sesión queda en el navegador de Telegram: el código es la vía recomendada.
   - **El GET del enlace no abre sesión.** Muestra «Vas a entrar con +57 ••• ••• 4567» (y avisa si ese navegador ya tiene una sesión que se cerraría) con un botón que hace un POST de formulario al mismo endpoint. El POST exige prueba positiva de mismo origen (`Sec-Fetch-Site: same-origin` u `Origin` del mismo host). Así, un enlace ajeno reenviado por chat no deja a nadie dentro de la cuenta de otro sin ver el número, y un escáner o una vista previa no queman el token (`telegram_login_peek_link` solo lee).
5. La sesión se crea con `lib/auth/phone-session.ts`, el mismo mecanismo del magic-link (`generateLink` + `verifyOtp` con `signOut({scope:'local'})` previo), **solo si la cuenta de Telegram está autorizada** para esa cuenta (`lib/auth/telegram-login/identity.ts`, tabla `telegram_login_identities`). `login_event` con `method: 'telegram'`.

**Número reciclado.** Telegram prueba que el número está asociado HOY a esa cuenta de Telegram, no quién tiene hoy la SIM: no es un espejo del SMS. Si la operadora reasigna un número y el dueño anterior lo conserva en Telegram, podría entrar a la cuenta que el dueño nuevo creó por SMS. Por eso:

| Estado del teléfono | Telegram |
|---|---|
| Sin cuenta | Crea la cuenta y queda vinculada a esa cuenta de Telegram |
| Cuenta vinculada a esta cuenta de Telegram | Entra |
| Cuenta vinculada a otra cuenta de Telegram | Nunca: el bot no emite código y pide usar el SMS |
| Cuenta existente sin vínculo (creada por SMS) | Solo SMS, salvo `TELEGRAM_LOGIN_ALLOW_EXISTING_ACCOUNTS=true`: entonces la primera cuenta de Telegram que entra queda vinculada y las demás no. Esa primera vez sigue expuesta al número reciclado; el login queda en `/avisos` de la cuenta |

El bot revisa el estado antes de emitir (`telegram_login_identity_status`) y el canje lo vuelve a decidir con la cuenta ya resuelta (`telegram_login_authorize`, que vincula de forma atómica). Rechazo → `409 sms_only`, sin tocar la cuenta ni las cookies del navegador.

Topes de emisión: 3 / 15 min y 10 / día, por teléfono y por cuenta de Telegram. El bot solo le dice a quien comparte SU contacto si ese número debe usar el SMS; nunca responde sobre números ajenos.

| Archivo | Rol |
|---|---|
| `app/api/telegram/login/route.ts` | Webhook. 503 sin configuración (sin leer body ni DB); header `X-Telegram-Bot-Api-Secret-Token` en tiempo constante antes del body |
| `lib/auth/telegram-login/*` | Configuración, clasificación de updates, hashes, textos del bot, canje |
| `app/api/auth/telegram-verify/route.ts` · `telegram-link/route.ts` | Canje de código / enlace (`no-store`; el GET del enlace solo confirma, el POST same-origin canjea; HEAD 405) |
| `lib/auth/telegram-login/identity.ts` | Qué cuenta de Telegram puede entrar a qué cuenta (número reciclado) |
| `app/(auth)/login/page.tsx` → `LoginClient.tsx` | El servidor decide si el canal está completo y solo pasa el usuario del bot |
| `scripts/telegram-login-set-webhook.mjs` | `setWebhook` (`allowed_updates: ["message"]`) + comandos. `--dry-run` primero |
| `scripts/telegram-login-check.sql` | Regresión SQL contra Supabase local (transacción revertida) |

Activación (dueño): crear el bot en @BotFather → cargar las tres variables en Vercel (Production) → aplicar la migración 115 → redeploy → `node --env-file=.env.local scripts/telegram-login-set-webhook.mjs`. Pruebas: `npm test -- tests/telegram-login.test.ts`.

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

Cada login exitoso (SMS, magic-link o Telegram) genera una notificación tipo `login_event` con device + ciudad+país (de los headers de Vercel). Aparece en el feed de avisos del usuario.

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
    whatsapp/webhook, matches/{discover,sync-live}, admin/...
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
5. Confirmá `SUPABASE_SECRET_KEY` (sb_secret_) y la IP real en Supabase Auth
   (ver «IP real en Supabase Auth»)

### Estado en producción (2026-09-13)

Foto de lo que quedó activo antes del lanzamiento. Producción:
`dpl_4kJdLw97EdCV9Y3ftz1ADtgsMTYX` (`main` 7d9ca5a); los merges posteriores del
mismo día (#73, #74 y la corrección de monitoreo) solo tocan documentación. Toda la configuración de
Auth se lee y cambia con la Management API
(`GET`/`PATCH /v1/projects/<ref>/config/auth`) usando un token con permisos
del proyecto. Nunca pegues secretos en el PATCH desde la terminal; léelos de
un archivo.

| Pieza | Estado | Cómo se apaga o se prende |
|---|---|---|
| IP real en Auth (`Sb-Forwarded-For`) | **Activa.** `security_sb_forwarded_for_enabled=true` y `SUPABASE_SECRET_KEY` en Production. Los logs de Auth muestran la IP del usuario en `remote_addr` | Apagar: PATCH `{"security_sb_forwarded_for_enabled": false}`. Sin la env, `auth-ip` cae a anon sin cabecera |
| SMS por LabsMobile (Send SMS Hook) | **Configurado y apagado.** URI `https://lapollacolombiana.com/api/auth/sms-hook` y secreto guardados en Auth; `sms_provider` sigue siendo `twilio_verify`; `sms_otp_exp=600` | Prender: PATCH `{"hook_send_sms_enabled": true}`. Rollback: PATCH `{"hook_send_sms_enabled": false}`, que vuelve a Twilio al instante sin deploy |
| Login por Telegram | **Activo.** Bot `@LaPollaColombianaAccesoBot`, webhook en `/api/telegram/login` (`allowed_updates: ["message"]`), migración 115 aplicada, `TELEGRAM_LOGIN_ALLOW_EXISTING_ACCOUNTS=true` | Apagar: quitar una de las tres variables `TELEGRAM_LOGIN_*` en Vercel y redeploy (la opción desaparece de `/login` y el webhook responde 503) |
| Captcha de Auth | **Apagada** (`security_captcha_enabled=false`). Pendiente, ver «IP real en Supabase Auth» | — |
| Backup | **Activo.** Runner del DGX fijado a `main` 7d9ca5a (checkout detached): backup a las 00:10, 06:10, 12:10 y 18:10 y verify a las 03:40 (hora de Bogotá). Cada corrida escribe en `backup_runs` (migración 117). `backup-freshness.yml` está programado cada hora y manda correo si hay atraso (ojo: GitHub corre los `schedule` de este repo con horas de retraso, ver «Crons de GitHub Actions»). El PC baja los snapshots con la tarea programada `La Polla backup pull` | Detalle en `ops/backup/README.md`. Si cambian `ops/backup` o `scripts/export-backup.ts`, en el DGX hay que repetir `git fetch`, `checkout` y `npm ci` |
| Planes | Vercel Pro, Supabase Pro compute Small, API-Football Pro (vence 2026-10-09) | — |
| Monitoreo | **Uptime en Sentry, sin aviso conectado.** Monitor «Uptime Monitoring for https://lapollacolombiana.com» (proyecto `santi-apps`, entorno `production`): `HEAD /api/app-version` cada 5 min, timeout 10 s, abre incidente tras 3 fallos y lo cierra con 1 éxito. **No tiene ninguna alerta (workflow) conectada**, así que un incidente no le avisa a nadie: hay que abrir Sentry para verlo. No hay SDK de Sentry en el código ni integración en Vercel. Los errores de la app se revisan en los logs de Vercel y en los correos de alerta (discrepancias, backup atrasado, SMS fallido o tardío) | Conectar el aviso: en Sentry → Monitors → Alerts, crear una alerta conectada a este monitor que mande email. Apagar: botón Disable en la edición del monitor |

**Prueba de LabsMobile del 2026-09-13.** Con el hook prendido se mandó un solo
SMS real: Supabase llamó al hook (200) y LabsMobile lo aceptó a las 16:10:41Z.
Como a los 8 minutos no había acuse, el hook se apagó (16:18:48Z). El acuse
llegó después: `handset` / `DELIVERED` a las 16:44:03Z, **2.002 s de demora**
(`sms_entregas.demora_seg`). La ruta funciona de punta a punta, pero un código
que vence a los 600 s no sirve con esa latencia. Antes de volver a prender el
hook hay que confirmar con LabsMobile, en horario hábil, que la ruta a Colombia
entrega en segundos (primer envío en revisión manual, domingo o cola) y repetir
la prueba exigiendo acuse `handset` en menos de 60 s.

Alertas de SMS que hay hoy: cuando llega el acuse, `aplicar_sms_ack` marca
`alertado_at` y `/api/sms/ack` manda correo si el SMS falló (`ko`) o tardó
más de 120 s (así salió el aviso de las 16:44:43Z). **El vigía de silencio
(`revisarSilencios` en `lib/sms/entregas.ts`, 5 min sin acuse) no tiene cron
conectado**: si LabsMobile nunca manda acuse, nadie se entera. Antes de
prender el hook, conecta ese vigía a un cron.

**Cookies de sesión.** En producción, las cookies `sb-<ref>-auth-token` salen
sin `HttpOnly` ni `Secure`. Es el default de `@supabase/ssr` y pasa igual con
SMS, magic-link y Telegram. Pendiente revisar `cookieOptions` antes del
lanzamiento.

### IP real en Supabase Auth

Supabase Auth limita `/auth/v1/otp` y `/auth/v1/verify` por IP (30 cada
5 minutos). El login los llama desde Vercel, así que sin más configuración
todos los usuarios comparten las IPs de salida de Vercel y un pico de logins
agota el cupo de todos. `lib/supabase/auth-ip.ts` manda la IP del usuario en
`Sb-Forwarded-For` ([doc](https://supabase.com/docs/guides/auth/rate-limits#ip-address-forwarding)).
Supabase la respeta solo con las dos condiciones:

1. **Env en Vercel** (Production y Preview), server-only:
   `SUPABASE_SECRET_KEY=sb_secret_...` (Dashboard → Settings → API Keys →
   Secret keys; conviene una key propia para esto, rotable sola). Redeploy.
2. **Después del deploy**, activar el reenvío en el proyecto:

   ```bash
   curl -X PATCH "https://api.supabase.com/v1/projects/$PROJECT_REF/config/auth"      -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"      -H "Content-Type: application/json"      -d '{"security_sb_forwarded_for_enabled": true}'
   ```

   o Dashboard → Authentication → Rate Limits → IP Address Forwarding.

Qué pasa con cada configuración incompleta:

- **Sin la env:** anon key sin cabecera, como antes, con un `warn` en logs.
- **Sin el flag:** Supabase ignora la cabecera.
- **Con una key que Supabase rechaza** (revocada, rotada, de otro proyecto o
  mal copiada): el gateway responde 401 `Invalid API key` antes de llegar a
  Auth. `fetchWithAnonFallback` repite esa llamada una vez con la anon key sin
  cabecera y deja un `console.error` con `[auth-ip] Supabase rechazó
  SUPABASE_SECRET_KEY`. El login sigue funcionando, pero sin IP real, hasta
  corregir la env y volver a desplegar. Cada llamada suma un viaje extra.
  Rotar esa key: crear la nueva, actualizar Vercel, desplegar y solo después
  revocar la vieja.

**Smoke test en Preview antes de poner la env en Production:** con la env en
Preview y el deploy listo, pide un código real desde `/login` del Preview,
ingrésalo y confirma que entras a `/casa`. En los logs de ese deploy no debe
aparecer `[auth-ip] Supabase rechazó`. Si aparece, la key está mal.

Verificación: en los logs de Auth, `/otp` y `/verify` pasan de mostrar IPs de
AWS (`3.236.x`, `54.82.x`) a las IPs de los usuarios.

**Pendiente antes de producción: captcha de Auth.** `/auth/v1/otp` acepta
llamadas directas con la anon key pública, así que el tope diario, el de IP y
el de teléfono de `start-otp` no frenan a quien llame a Supabase directo. Solo
lo frenan los límites de Supabase (`rate_limit_otp` 30 cada 5 min por IP,
`rate_limit_sms_sent` 300 por hora para todo el proyecto). Un script con
números rotados puede gastar 300 SMS por hora y dejar sin login a todos
(2026-09-13: `security_captcha_enabled=false`, `disable_signup=false`).
Plan, en este orden:

1. La secret key funcionando en Production (arriba) y verificada en logs.
2. En un proyecto de Supabase de prueba (Preview usa el mismo proyecto que
   producción, así que ahí no sirve), activar la captcha de Auth
   (`security_captcha_enabled`, proveedor y secret) y confirmar dos cosas:
   `start-otp`, `verify-otp` y `wa-magic` siguen funcionando, porque GoTrue se
   salta la captcha con credenciales de admin (`verifyCaptcha` en
   `internal/api/middleware.go`), y un `POST /auth/v1/otp` directo con la anon
   key responde `captcha_failed`. `/verify` no pide captcha; el refresh de
   `/token` está exento.
3. Recién ahí activarla en producción.

Con captcha activa, la repetición con anon key de una secret key rechazada
ya no salva `/otp`: ese caso también exige el smoke test de Preview. La
alternativa es un Send SMS Hook que valide contra `otp_rate_limits`.

Los helpers devuelven solo `client.auth`; para datos siguen
`lib/supabase/server.ts` y `lib/supabase/admin.ts`. Prueba local: GoTrue con
`GOTRUE_SECURITY_SB_FORWARDED_FOR_ENABLED=true` registra `remote_addr` con la
IP reenviada y separa los baldes de `/verify` por esa IP; login completo con y
sin la env deja la misma cookie `sb-<ref>-auth-token` y `/casa` responde 200.
Unitarias: `npm test -- tests/auth-real-ip.test.ts`.

### Crons de GitHub Actions (`/api/cron/*`)

| Workflow | Ruta | Horario |
|---|---|---|
| `match-reminders.yml` | `/api/cron/match-reminders` | diario 13:00 UTC |
| `admin-discrepancies-email.yml` | `/api/cron/admin-discrepancies-email` | diario 13:00 UTC |
| `cleanup-payout-proofs.yml` | `/api/cron/cleanup-payout-proofs` | **solo manual** (pendiente de aprobación del dueño) |
| `backup-freshness.yml` | `/api/cron/backup-freshness` | cada hora, minuto 17 |

- **Los `schedule` de GitHub llegan tarde en este repo.** `match-reminders` y
  `admin-discrepancies-email` (13:00 UTC) arrancaron entre las 15:54 y las
  16:48 UTC del 2026-09-10 al 2026-09-13: casi 3 a 4 h de retraso. GitHub
  no garantiza la hora y puede saltarse corridas con carga alta.
  `backup-freshness.yml` llegó a `main` a las 15:45 UTC del 2026-09-13 y, a
  las 18:37 UTC, sus horarios de las 16:17, 17:17 y 18:17 seguían sin correr
  (solo había corridas manuales). En la práctica, un backup atrasado puede
  avisar varias horas después del umbral de 7 h. Si eso no alcanza, dispara la
  misma ruta desde un segundo lugar (pg_cron + pg_net o un cron de Vercel,
  que Pro permite) con `CRON_SECRET`.

- `backup-freshness` lee `public.backup_runs` (migración 117, la llena el
  backup del DGX) y le escribe a `ADMIN_ALERT_EMAIL` (o `FEEDBACK_NOTIFY_EMAIL`)
  «Backup de La Polla atrasado» si el último backup bueno pasa de
  `BACKUP_MAX_AGE_HOURS` (7) o la última verificación de
  `BACKUP_VERIFY_MAX_AGE_HOURS` (30). La primera verificación tiene margen:
  sin filas `kind=verify` y con el primer backup bueno de 30 h o menos, no
  alerta. Responde `{ok, stale, age_hours,
  verify_stale, verify_age_hours, sent}`; 502 si Resend falla, 500 si la tabla
  no existe. Detalle: `ops/backup/README.md`.

- El middleware exime `/api/cron/` (con barra final) del gate de sesión; cada
  handler se protege solo con `requireCronSecret(request)`
  (`lib/auth/cron-secret.ts`): `Authorization: Bearer $CRON_SECRET`, comparación
  en tiempo constante, 403 si no coincide y 500 si falta la variable. Ruta nueva
  bajo `app/api/cron/` sin esa llamada = test rojo (`tests/cron-auth.test.ts`).
- El `CRON_SECRET` del repo en GitHub debe ser igual al de Vercel. Un 403 en el
  workflow significa que no coinciden.
- Los workflows fallan ante cualquier status que no sea 2xx o sin `"ok": true`,
  con `--max-time 90` y sin reintentos, e imprimen solo contadores.
- `admin-discrepancies-email` responde **502** `{error:"email send failed"}` si
  Resend rechaza el envío (key revocada, sin cuota, dominio sin verificar):
  el SDK no lanza excepción, así que el handler revisa el `error` devuelto.
  El detalle del proveedor queda solo en el log de Vercel
  (`tests/cron-admin-discrepancies-email.test.ts`).
- Verificación después de un deploy: `curl -X POST https://lapollacolombiana.com/api/cron/match-reminders`
  sin header debe dar **403** (nunca 307), y `gh workflow run match-reminders.yml`
  debe terminar en verde.
- Limpiar comprobantes a mano: `gh workflow run cleanup-payout-proofs.yml -f confirm=BORRAR`.
  Borra de forma irreversible; confirma antes que el backup los tenga.

---

## Tags de seguridad / rollback

- `pre-wompi-removal` — antes de eliminar el flujo Wompi/digital_pool

Para revertir cualquier deploy: `git revert <sha> && git push origin main`.

---

## Backup y restore

El plan free de Supabase no incluye backups automáticos y pausa los
proyectos inactivos, así que la copia de los datos vive afuera:

```bash
npx tsx scripts/export-backup.ts       # dump completo (solo lectura)
npx tsx scripts/verify-backup.ts       # sha256 de tablas, auth, Storage y esquema, offline
npx tsx scripts/restore-backup-sql.ts  # genera el .sql para psql contra Supabase local
npx tsx scripts/restore-backup.ts      # dry run por default; escribe solo en local
```

Deja `backups/<fecha>/` con todas las tablas de `public`, `auth` (+ SQL de
restore con los mismos uuid), los archivos de Storage (paginados y cruzados
contra `storage.objects`), las migraciones del repo, el esquema vivo de prod
(`schema/live`) y un `RESUMEN.md` con la tabla final de cada polla en texto
plano. Se escribe en `<fecha>.partial/` y se renombra al terminar. `backups/`
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
visibles. Al abrir la app o regresar, una versión nueva se carga automáticamente
si no hubo interacción ni hay ediciones pendientes. Se vuelve a comprobar esto
después de instalar el worker para no perder cambios hechos durante la espera.
`PicksBoard` y `QuestionsBoard` exponen `data-app-update-blocked` mientras tienen
pronósticos sin guardar o están guardando; también se protege la edición de campos.
Durante el uso activo se muestra un aviso inferior con «Actualizar app». Su X
lo oculta hasta la próxima entrada; solo desaparece definitivamente al actualizar.
No hay botón permanente en Perfil. Un guard por par de builds en `sessionStorage`
evita bucles si el CDN devuelve temporalmente el HTML anterior.
La recarga conserva cookies y almacenamiento,
comprueba conexión y actualiza el worker sin desregistrarlo ni vaciar cachés.
Vercel aporta `VERCEL_DEPLOYMENT_ID`/`VERCEL_URL`; para probar dos builds locales,
usar `APP_BUILD_ID` distinto en cada `npm run build`. No requiere proveedor adicional.

### Rendimiento de medios y shell (2026-09-10)

`AppBackground` pinta primero `.lp-humo`, tres gradientes CSS animados que no
descargan archivos. Login conserva ese humo y no solicita video; onboarding
mantiene el video que ya tenía. En el shell autenticado,
`lib/background-connection.ts` mantiene la conducta existente: ahorro de
datos/2G/3G queda en humo y las demás conexiones rotan los cinco MP4 lite.
La política escucha `connection.change`; el humo pausa sus animaciones cuando
el clip ya cubre la pantalla. Los modales prefieren también el MP4 lite y
conservan WebM como fallback.

El proxy deja pasar MP4/WebM como archivos públicos y sus headers permiten
reutilizarlos sin revalidar durante un día. El worker manda esas solicitudes
a la red para no leer posibles respuestas HTML de un cache anterior; el cache
HTTP del navegador conserva el soporte de rangos. Serwist guarda los escudos
con hash en `lp-team-crests` y el arte mutable en `lp-art` mediante SWR. Del directorio
público, el precache solo incluye manifest e iconos de 192/512; los chunks de
más de 256 KiB se guardan al usarse y los stubs estáticos de `app/api/**` no
entran porque ningún browser los solicita. Los masters MP4 de edición permanecen
en el repo pero `.vercelignore` evita subirlos. `TOURNAMENT_ICONS` entrega las
variantes de 96 px para sus usos pequeños.

PostHog se importa después de `load` + idle. Encola las transiciones que ocurran
mientras carga y conserva pageviews y autocapture de clics una vez inicializado;
una visita que termine antes de esa carga diferida no alcanza a reportarse. Replay,
encuestas, flags, mapas de calor, dead clicks, métricas de performance y
dependencias remotas quedan apagados. `/` y el retorno autenticado desde login entran directo a
`/casa`, sin el salto intermedio por `/inicio`.

### Correo de contacto

`info@lapollacolombiana.com` recibe mediante el plan gratuito de
[Forward Email](https://forwardemail.net/en/faq) y reenvía al Gmail del administrador.
Los DNS siguen en Vercel: MX `mx1.forwardemail.net` (10) y `mx2.forwardemail.net`
(20), configuración de alias en TXT cifrado y SPF de Forward Email. Solo se
configura `info`, sin catch-all. El destino personal no se publica en el repositorio
ni en el TXT en texto plano. Las páginas de soporte, privacidad y eliminación
de cuenta muestran esta dirección. La entrega a Gmail y la verificación de la
cuenta se comprobaron el 9 de septiembre de 2026. El envío como `info` no forma
parte de este reenvío; la configuración de Resend en `send.*` permanece separada.


### Casa v2: premios y comprobantes (implementación 2026-09-12)

El contrato v2 separa pozo y objeto, conserva las boletas fallidas para su dueño,
identifica cada comprobante en las aprobaciones y registra desempate/evidencia/entrega.
Migraciones 097–102; activación explícita `legacy → paused → v2`. No activar ni
revertir a ciegas. Procedimiento, límites, pruebas y despliegue en
[docs/casa-v2-production.md](docs/casa-v2-production.md). La descripción histórica
de 096 arriba no es el contrato de liquidación una vez activado v2.

### Comprobantes comprimidos en el navegador (2026-09-13)

`components/casa/PagarForm.tsx` prepara la imagen UNA vez al elegirla
(`lib/casa/prepare-proof.ts`) y calcula el SHA-256 sobre lo que sube. El
servidor (`verifyCasaUpload`), el SQL 098 y el bucket no cambian.

- Hasta 300 KB se sube el original sin decodificar. Por encima: JPEG 0,82
  (0,72 si sigue pasando de 300 KB), lado largo 1600 px, lado corto mínimo
  720 px y máximo 4 MP (`lib/casa/proof-image.ts`). Fondo blanco, orientación
  EXIF aplicada y salida sin EXIF ni GPS. Si ahorra menos del 10 % o no hay
  reducción legible, se sube el original. Entrada hasta 20 MB; subida hasta 8 MB.
- Candidatos `[preparado, original válido]`. Ante `UPLOAD_IN_PROGRESS` o
  `REQUEST_CONFLICT` (y `PROOF_IN_REVIEW`/`ALREADY_PAID`, que reconocen un
  intento ya confirmado) `lib/casa/proof-submit.ts` prueba el siguiente: así se
  retoman cargas del cliente anterior o de otro dispositivo, también con la
  inscripción cerrada. sessionStorage guarda `sourceSha256` del original y
  acepta registros viejos con solo `sha256`. Con la inscripción cerrada nunca
  se marca como fallado un intento guardado.
- Foto del premio (`CrearPollaForm`): se reduce a menos de 1 MB antes del
  `FormData`; la función de Vercel corta el cuerpo en 4,5 MB.
- Telegram: si `sendPhoto` falla, el admin recibe el texto con los mismos botones.
- Pruebas: `npm test -- tests/casa-proof-image.test.ts tests/telegram-proof-notify.test.ts`.
  E2E local (Supabase en Docker): `node scripts/casa-v2-local-env.mjs build <puerto>`,
  `... start <puerto>` y `CASA_ORIGIN=http://localhost:<puerto> node scripts/casa-proof-compression-browser-check.mjs`
  (captura 1179×2556, determinismo, recuperación tras cierre, registro anterior,
  EXIF girado, foto del premio y HEIC ilegible).
- Falta validar en dispositivos reales (iPhone Safari con HEIC y EXIF, Android
  de gama media con fotos de 50 MP) y la legibilidad con comprobantes reales.
