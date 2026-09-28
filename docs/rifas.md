# Rifas de creadores habilitados (migración 157)

Implementación de [`docs/rifas-spec.md`](rifas-spec.md). **Todo detrás de
`RIFAS_ENABLED`** (apagado por defecto): sin el flag no existe ninguna pantalla,
ruta, pestaña ni cookie de rifas. **La migración 157 no está aplicada en
producción.** Aplicarla y prender el flag requieren el OK explícito del dueño.

## Qué es

Un administrador habilita a ciertos usuarios como **creadores de rifas**. Cada
creador arma SUS rifas (hasta 100 números, 00–99), comparte el enlace por
WhatsApp y revisa los comprobantes. **El dinero va directo a la cuenta del
creador y nunca pasa por La Polla.** La rifa es la puerta de entrada: cada
comprador que abre el enlace sin cuenta y se registra queda atribuido a esa
rifa (embudo rifa → cuenta → polla).

## Rutas

| Ruta | Quién | Qué |
|---|---|---|
| `/admin/rifas` | `users.is_admin` | Creadores (buscar, habilitar, quitar), todas las rifas con reportes (ocultar/mostrar) y embudo |
| Perfil → «Mis rifas» | Creador habilitado | «Crear mi rifa» + sus rifas con comprobantes pendientes. A quien no tiene permiso no se le dibuja nada |
| `/rifas/crear` | Creador habilitado | Formulario. Sin permiso: 404 |
| `/rifa/<slug>` | Cualquiera (Pública) · creador y admins (Privada) | Tablero, reservar, pagar, comprobante, resultado. Sin sesión: tablero y registro al elegir |
| `/rifa/<slug>/gestionar` | Solo el creador | Comprobantes, tablero con nombres, venta por fuera, liberar, resultado, compartir, imagen, foto del premio, actividad |
| `/inicio?tab=rifas` | Con sesión | Pestañas **POLLAS \| RIFAS** (POLLAS por defecto): mis números, creadas por mí, abiertas por enlace |

API: `/api/rifas/**` y `/api/admin/rifas`. Todas validan la sesión antes de tocar
la base y mandan a SQL el uuid de la sesión como actor (nunca un dato del cliente).

En la **app iOS no aparece nada de rifas** (rifas con dinero: guía 5.3 del App
Store), igual que los demás módulos de pagos.

## Por qué tablas propias (`rifa_*`) y no `casa_*`

Casa asume que La Polla cobra y reparte. Escribir en `casa_entries` dispara el
conteo de invitados (`casa_referral_sync`), los guards de v2
(`casa_v2_write_guard`), el pozo 70/30 y `casa_payouts`, la cola de
`/admin/pollas/recibos` y los avisos de Telegram a los administradores. Nada de
eso aplica cuando cobra un tercero, y mezclarlo le daría a un creador acceso a
flujos de la casa o metería dinero ajeno en la contabilidad de Casa. Las rifas
de Casa (`casa_pollas.kind='rifa'`) **no se tocaron**. Se reutiliza **código**,
no filas.

## Inventario de reutilización

| Pieza existente | Uso en rifas |
|---|---|
| `lib/casa/uploads.ts` (`signedCasaUpload`, `verifyCasaUpload`) | **Tal cual.** Carga firmada inmutable y verificación de bytes/SHA-256/firma de tipo en el bucket `rifa-proofs` |
| `lib/casa/prepare-proof.ts` (`prepareImageUpload`, `PROOF_PREPARE_OPTIONS`, `PRIZE_IMAGE_PREPARE_OPTIONS`) | **Tal cual.** Compresión determinista del comprobante y de la foto del premio |
| `lib/casa/upload-client.ts` (`uploadSignedFile`) | **Tal cual** |
| `lib/casa/payout-proofs.ts` (`matchesImageSignature`) | **Tal cual** para la foto del premio |
| `components/casa/CopiarDato.tsx` | **Tal cual** (cuenta del creador, enlace, cuenta del ganador) |
| `components/casa/ColombiaDateTimeField.tsx`, `lib/time/colombia.ts` | **Tal cual.** Fechas en hora de Colombia |
| `components/casa/PayoutAccountButton.tsx` + `PayoutDefaultEditor` | **Generalizado:** props `note`, `label`, `onSaved`, `className` (en rifas paga el creador, no La Polla). Casa sigue igual por defecto |
| `lib/telegram-player/notify.ts` | **Generalizado:** `notifyRifaByTelegram` (avisos a comprador y creador si tienen Telegram vinculado) |
| `/api/admin/promote?directory=1` (búsqueda por `X-User-Search`) | **Tal cual** para buscar creadores |
| `components/street/*`, `PollaSection`, `lp-*`, `components/ui/PhoneInput` | **Tal cual** |
| `CASA_LOCAL_TEST` en `next.config.mjs` | **Tal cual** para el build local |
| `users.default_payout_*` (052/053) | **Tal cual:** cuenta de cobro del comprador cuando el premio es dinero |
| `casa_pollas.kind='rifa'`, `Boletas.tsx`, `tickets`, `ResolverPolla` | **No se reutilizan:** modelo de un solo operador (la casa), una boleta por comprobante y sorteo liquidado por Casa. Sirvieron de referencia |
| `app/api/share-card` | **No se reutiliza:** edge sin fuentes de marca. La imagen de historia es una ruta nueva en Node con Bebas + Outfit |
| Tablero, reserva atómica, venta por fuera, resultado con número no vendido, embudo, pestañas, panel del creador | **Nuevo** |

## Modelo de datos (migración 157)

| Tabla | Para qué |
|---|---|
| `rifa_settings` | **Única fila con las decisiones configurables** (ver abajo) |
| `rifa_creators` | Permiso: `granted_by/at`, `revoked_by/at`. Historial en `rifa_events` |
| `rifas` | La rifa: premio (`dinero` COP o `texto`), `number_count` 2–100, `price_cop`, lotería, `digits_rule`, `draw_at` (= cierre), `visibility` (`privada` por defecto), cuenta de cobro, estado, resultado, `hidden_*` |
| `rifa_tickets` | Un número tomado. Estados `reservado` → `en_revision` → `pagado`, o `liberado` (historial). `origin` `app`/`fuera`. **Índice único parcial `(rifa_id, number) WHERE state <> 'liberado'`** |
| `rifa_proofs` | Comprobante: cubre todos los números reservados del comprador (una transferencia); `amount_cop` calculado en SQL |
| `rifa_draws` | Historial público de sorteos (ganador, volver a jugar, desierta) |
| `rifa_events` | Auditoría sin nombres ni celulares (asignar/quitar creador, reservas, vencimientos, aprobar, rechazar, revertir con motivo, ventas por fuera, liberar, resultado, ocultar, reportes) |
| `rifa_reports` | «Reportar rifa» |
| `rifa_visits`, `rifa_link_views`, `rifa_signups` | Pestaña RIFAS («abiertas por enlace») y embudo |

Estados visibles del tablero: **Libre** (fondo claro), **Reservado** (verde
claro, borde punteado, reloj), **Pagado** (verde oscuro, chulo). El creador ve
además **En revisión** (borde de puntos, documento). Cada estado se distingue
por color **y** por forma/ícono, y el lector de pantalla lo anuncia en palabras.

**Reglas de SQL (todas `SECURITY DEFINER`, `search_path` fijo, `EXECUTE` solo `service_role`):**

- `rifa_reserve_v1`: bloquea la rifa (`FOR UPDATE`), barre vencidas, valida
  rango, visibilidad, cierre, cuenta de cobro si el premio es dinero, tope por
  comprador, y reserva **todo o nada**. Número tomado → `NUMBER_TAKEN` con el
  número en el mensaje. El índice único es la red de fondo.
- Vencimiento **perezoso** (sin cron): una reserva de la app sin comprobante
  vence a los `reservation_minutes`. Las lecturas la muestran libre y las
  escrituras la marcan `liberado` (`vencida`) bajo el bloqueo. Subir un
  comprobante extiende la reserva como máximo reserva + ventana de carga
  (reintentar no retiene el número indefinidamente).
- Solo el **creador** aprueba, rechaza (con motivo), revierte (con motivo,
  auditado), vende por fuera, libera, escribe el resultado y cambia la
  visibilidad. **Un administrador de La Polla no puede** (`CREATOR_ONLY`): puede
  ocultar la rifa y ver reportes.
- Privada → Pública solo si el creador sigue habilitado; Pública → Privada solo
  sin números tomados.
- Después de `draw_at` no hay reservas, ventas por fuera ni comprobantes
  **nuevos** (evita pagar solo si ganó). **El tablero queda congelado para el
  creador (`DRAW_LOCKED`)**: ya conoce el número, así que solo puede **aprobar**
  comprobantes en revisión; no puede rechazar, revertir, liberar ni marcar
  pagada una venta por fuera. Sin esto podía quitarle el premio al ganador o
  «vender» el número ganador después del sorteo (revisión de lógica, 28-sep).
- Resultado: solo después del sorteo. Pagado → ganador. Con comprobante en
  revisión → `PENDING_WINNER` (aprobarlo; si el pago no llegó, soporte vía
  «Reportar rifa»). **Reservado sin pago a la hora del sorteo = no vendido.** Si
  no se vendió (o está fuera del rango de la rifa) → el creador **debe** elegir
  `volver_a_jugar` (nueva fecha/lotería, máximo 3 veces, `REPLAY_LIMIT`) o
  `desierta`; queda en el historial público. Nunca queda en silencio.
- Una rifa oculta por administración no recibe comprobantes nuevos.
- Quitar el permiso de creador impide crear rifas nuevas; las activas siguen.

## Decisiones por defecto (confirmar con el dueño)

Todas en `rifa_settings` (una fila; cambiar = un `UPDATE`, sin deploy):

| Decisión | Valor | Dónde |
|---|---|---|
| Listado de rifas de terceros | **Solo por enlace** + las mías (`listing_mode='enlace'`; `'publico'` ya está programado) | `rifa_settings.listing_mode` |
| Vencimiento de una reserva sin comprobante | **30 min** | `rifa_settings.reservation_minutes` |
| Ventana para subir el archivo | 15 min | `rifa_settings.upload_minutes` |
| Número ganador no vendido | El creador elige **volver a jugar** o **desierta** | `rifa_set_result_v1` |
| Cobro de La Polla por rifa | **Gratis** (no existe ningún cargo en el modelo) | — |
| Rifas activas por creador | 3 | `rifa_settings.max_active_rifas_per_creator` |
| Números sin pago confirmado por comprador y rifa | 10 | `rifa_settings.max_pending_numbers_per_buyer` |
| Reportes por usuario al día | 10 | `rifa_settings.max_reports_per_user_day` |
| Visibilidad al crear | Privada | `rifas.visibility` DEFAULT |

## Privacidad (Ley 1581) y seguridad

- Nombres y celulares de compradores **solo** en `rifa_creator_view_v1`, que
  exige ser el creador. El tablero público, la pestaña RIFAS, el panel de admin y
  la imagen de historia muestran estados, nunca personas (prueba K de
  `scripts/rifas-check.sql`).
- La cuenta de cobro del creador solo se entrega a quien tiene números por pagar.
- Comprobantes en el bucket privado `rifa-proofs`; URL firmada de 5 min solo para
  el creador y el dueño del comprobante (ni un admin). Foto del premio en
  `rifa-media` privado; firma solo para quien puede ver la rifa.
- RLS en todas las tablas nuevas, **deny-all para `anon`/`authenticated` en
  todas, incluida `rifas`**: un `SELECT` directo exponía la cuenta de pago de
  cada rifa Pública y armaba el listado que el modo «solo por enlace» prohíbe.
  El servidor lee con service role y RPC.
- `/rifa/<slug>` y `/rifas/*` son `NetworkOnly` en el service worker.
- Ninguna imagen usa `next/image`.
- Avisos: al comprador (aprobado/rechazado) y al creador (comprobante nuevo) por
  Telegram si tiene cuenta vinculada; si no, lo ve al abrir la rifa. **WhatsApp
  saliente sigue apagado**: compartir y escribirle al ganador abren `wa.me` en el
  teléfono del creador.

## Embudo rifa → cuenta → polla

1. `proxy.ts` pone la cookie httpOnly `lp_rifa=<slug>.<ms>` a quien abre
   `/rifa/<slug>` **sin sesión** (primer enlace, 30 días, solo navegaciones).
2. La página cuenta la visita anónima (`rifa_link_views`).
3. Al elegir un número va a `/login?returnTo=/rifa/<slug>` (lo elegido se
   recupera después del login).
4. Con sesión, la página llama `POST /api/rifas/<slug>/visto`: guarda la visita
   y, si hay cookie, `rifa_record_signup_v1` atribuye la cuenta **solo si
   `auth.users.created_at` es posterior** a la visita; borra la cookie.
5. `/admin/rifas` → Embudo: visitas → cuentas nuevas → reservaron → pagaron →
   entraron a una polla (participación viva de Casa después del registro).

## Imagen para historia

`GET /api/rifas/<slug>/historia?plantilla=neutra|club&club=<clave>`: PNG
1080×1920, solo el creador. Nombre, premio, tablero con los tomados marcados
(chulo sobre verde), fecha y hora en Colombia, lotería, valor y el enlace. Dos
plantillas: **La Polla** (marca, oscuro y oro) y **Colores de club** (franjas de
camiseta + pollito del catálogo de `docs/pollito-clubes.md`, **sin escudos**).
Fuentes Bebas Neue y Outfit 600 en `assets/fonts` (OFL, licencias incluidas).
Escudos a elección del creador y QR quedan como siguiente paso. Satori (next/og)
no decodifica WebP: el logo y los pollitos van como PNG de paleta en
`assets/rifas-story/` (`scripts/bake-rifa-story-assets.py`, ~410 KB).

## Pruebas

| Prueba | Qué cubre |
|---|---|
| `scripts/rifas-check.sql` (ROLLBACK) | A–M: permisos (asignar solo admin, crear sin permiso, `authenticated`/`anon` no ejecutan RPC ni leen tablas, RLS de Privada), reservar, comprobante, aprobar solo el creador (ni un admin), rechazo, vencimiento, venta por fuera y aparición al registrarse, visibilidad, revertir con auditoría, resultado (no vendido/pendiente/ganador), privacidad, ocultar/reportar, embudo |
| `scripts/rifas-concurrency-check.mjs` | Sesiones reales: A retiene el 07 y B espera el bloqueo y recibe `NUMBER_TAKEN`; ráfaga de 12 por el 42 → 1 gana; conjuntos solapados todo o nada; venta por fuera vs app; INSERT sin bloqueo choca con el índice |
| `tests/rifas-routes.test.ts`, `tests/rifas-shared.test.ts` | Flag apagado = 404, sesión antes de SQL, actor de la sesión, traducción de errores, tablero accesible, plantillas, contrato estructural de la migración |
| `scripts/rifas-e2e-local.mjs` | Recorrido completo en navegador con capturas 320/390/768 y texto al 200 % |

### Base local sin Docker de Supabase

Las imágenes oficiales de Supabase no se pudieron bajar en el entorno donde se
construyó esto (registro de AWS bloqueado y Docker Hub con límite). Por eso
`scripts/local-pg/` arma un stack **solo local** sobre PostgreSQL 16:
`apply-migrations.sh` aplica las 157 migraciones (con `fixups/` para los objetos
que producción creó a mano y el repo no registra: `notification_type`,
`matches.elapsed`, `users.avatar_emoji`, tablas de backup, etc.) y las
migraciones reales de GoTrue; `local-supabase.mjs` levanta PostgREST y GoTrue
reales y un Storage simulado detrás de `127.0.0.1:54321`. Con el Supabase local
de Docker de siempre, las mismas pruebas corren con
`docker exec -i supabase_db_la-polla psql -U postgres -d postgres < scripts/rifas-check.sql`
y `RIFAS_PG_CONTAINER=supabase_db_la-polla node scripts/rifas-concurrency-check.mjs`.

## Cómo probarlo (local)

```bash
# 1. Base local con todas las migraciones (o `supabase db reset` en el Docker de siempre)
GOTRUE_BIN=<ruta a auth> ./scripts/local-pg/apply-migrations.sh
psql -h 127.0.0.1 -p 54322 -U postgres -d la_polla_local -f scripts/rifas-check.sql
node scripts/rifas-concurrency-check.mjs
# 2. Supabase local + app con RIFAS_ENABLED=true
POSTGREST_BIN=<postgrest> GOTRUE_BIN=<auth> node scripts/local-pg/local-supabase.mjs &
node scripts/rifas-local-env.mjs build && node scripts/rifas-local-env.mjs start 3101 &
# 3. Recorrido con capturas
PLAYWRIGHT_CHROMIUM=/opt/pw-browsers/chromium node scripts/rifas-e2e-local.mjs
```

## Cómo activarlo en producción (requiere OK del dueño)

1. Backup (`scripts/export-backup.ts`) y aplicar **157** en una transacción.
2. `get_advisors(security)`: no debe aparecer nada nuevo de nivel ERROR.
3. `RIFAS_ENABLED=true` en Vercel **Preview** primero; habilitar un creador de
   prueba desde `/admin/rifas` y hacer el recorrido con una rifa **Privada**
   entre administradores.
4. `RIFAS_ENABLED=true` en Production cuando el dueño lo decida.
- Capturas del recorrido local (320/390/768, texto al 200 % e imágenes de historia): `docs/rifas-capturas/`.
