# Borradores privados de campañas

Una campaña en preparación vive en `casa_pollas`, con `status=borrador`,
`publication_mode=oculta` y `campaign_draft` (migración 146). No se publica ni
admite inscripciones. Los espacios de partidos son metadata propia del borrador:
no se insertan partidos ficticios en `matches` ni se crean pronósticos.

## Acceso y vista previa

La navegación normal **POLLAS** (`/inicio`) muestra los borradores autorizados con
el mismo `PollaCardBody` de las demás pollas, foto privada del premio y gorro SVG.
`/polla/[slug]` reutiliza la pantalla habitual: `AvisoDesempate` compacto, pestañas
Partidos/Tabla/Info y tarjetas de `PicksBoard`. El acceso exige sesión, rol
administrativo vigente y presencia del UUID en `campaign_draft.allowed_admin_ids`.
`/admin/pollas/[id]/preview` redirige a esa misma pantalla después del control de
acceso; no hay una landing independiente. La lista administrativa
filtra por la misma regla; solo devuelve un indicador `private_draft`, nunca la
lista de acceso. Sin actor explícito, las consultas del bot excluyen las campañas.
El editor habitual redirige a la vista previa. Las mutaciones operativas se bloquean
en la API y con restricciones/triggers en PostgreSQL.

`listPrivateCampaignPollas` y `getPrivateCampaignBySlug` son lecturas exclusivas del
servidor, con filtro de allowlist en SQL y validación del contrato. Los getters
públicos y las APIs de jugadores siguen excluyendo borradores. `PicksBoard` recibe
`plannedMatches`: reutiliza su tarjeta, muestra escudos `?` y «Fecha por confirmar»,
sin guardar, enlaces de partidos ficticios ni polling. `PollaTabs.staticMode`
mantiene la tabla vacía sin consultar el leaderboard. `PollaInfo.schedulePending`
explica la programación pendiente. Ninguna fecha provisional se presenta como real.

La foto se almacena en el bucket **privado** `casa-private-drafts`, con ruta
`<polla_id>/<archivo>`. `/api/casa/admin/pollas/[id]/draft-image` comprueba el mismo
acceso antes de descargarla; responde `private, no-store`, sin URL pública ni URL
firmada para compartir. No poner el arte de una campaña privada en `public/` ni
en el bucket público `prize-images`.

## Contrato

`campaign_draft` contiene `version:1`, `allowed_admin_ids`,
`tie_break:earliest_registration`, `slots`, `image_path`, `sources` y
`schedule_confirmed:false`. Cada slot tiene identidad estable, fase, grupo,
jornada y etiquetas; `home_team`, `away_team`, `scheduled_at` y `match_id` son
`null`. Los 26 espacios de la Liga BetPlay II 2026 corresponden a 24 partidos de
cuadrangulares y dos de la final. Los cruces y las fechas se definen con la
programación oficial; no se presupone la localía de la final.

La regla de desempate reutiliza la migración 142: entre participaciones pagadas
empatadas arriba, gana el registro más antiguo (`casa_entries.created_at`). No
se cambia el motor de puntaje ni se habilita el antiguo protocolo de sorteo.

Creación mediante `casa_create_private_draft_v1(p_config,p_slug,p_actor_id,p_contract)`;
metadata mediante `casa_update_private_draft_v1`. Ambos solo ejecutables por
`service_role`, con validación de actor. La lista de acceso no cambia desde el
RPC de edición. Publicar requerirá un cambio deliberado posterior que resuelva
partidos, fechas y configuración; ningún botón actual lo hace.

## Verificación

`npm test -- tests/casa-private-drafts.test.ts` verifica parsing y acceso.
`scripts/casa-private-drafts-check.sql` corre exclusivamente contra Supabase local
en Docker, dentro de una transacción con rollback. Comprueba RLS, ACL, bloqueo de
publicación/inscripciones/matches y compatibilidad con pollas normales.

La comprobación de integración cubre HTML y RSC, listado y detalle administrativos,
imagen privada y rechazo de publicación para tres admins autorizados, un admin
excluido, un jugador y un anónimo. La vista se inspecciona en móvil, tamaño medio,
escritorio y texto ampliado antes de entregar.
