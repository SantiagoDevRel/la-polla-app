# POLLA REGALO: resultado y correo de Quentro

Pedido del 24 de septiembre de 2026. La campaña es `polla-regalo`
(`85b88f91-7680-4241-9bf5-b37614cb520b`), con dos entradas para
Nacional–Millonarios. El formulario de entrega se limita a esta campaña.

## Del último partido al resultado

El cron existente llama a `/api/matches/sync-live` cada minuto. API-Football
comparte una reserva por fecha: con Pro vigente, el intervalo es de 60 segundos.
El vivo se consulta cuando hay un partido en juego o que ya llegó a su hora
de inicio; no se precargan los 30 minutos anteriores. Sin vivo ni resultados
pendientes de verificar, el cron no solicita resultados al proveedor.
El verificador sigue corriendo aunque haya terminado el último partido. Exige
dos observaciones nuevas del mismo resultado de 90 minutos, separadas al menos
50 segundos. El retraso de la fuente no se sustituye por un resultado supuesto.

Una fila que el vivo ya marca como `finished` se verifica inmediatamente;
las filas `scheduled`/`live` conservan el umbral de 105 minutos desde el inicio.
`finalize_verified_match_result` y sus triggers existentes conservan la autoridad
del cierre y los puntos. No se reescriben pronósticos históricos.

`casa_object_result_v1` (migración 150) es de solo lectura y replica los bloqueos
del reparto: resultados pendientes, casos abiertos, comprobantes por revisar,
inscripciones abiertas o ausencia de participantes. Cuando todo está listo,
identifica al primero por puntos y, si empatan, por registro, número de cupo y
UUID, igual que la migración 142. No adjudica ni confirma la entrega.

`ObjectResult` consulta el endpoint privado `object-result` cada 30 segundos
visibles y al volver a la pestaña. Presenta «Resultado calculado» y la
confirmación pendiente de la casa. Con cero puntos no anuncia ganador. Los
puntos del tablero se toman del último render del servidor al verificarse el
partido, conservando los borradores de encuentros todavía editables.

## Correo para las boletas

La migración 149 crea `casa_prize_contacts`, con clave `(polla_id, user_id)`.
No modifica `users.email` ni la identidad de acceso. RLS deja leer solo el
contacto propio; el navegador no tiene permisos de escritura ni de ejecución
del RPC. `casa_save_prize_contact` es exclusivo del servidor y valida campaña,
participación pagada, publicación y entrega. Después de adjudicar, solo el
ganador puede corregir el correo; después de registrar la entrega se bloquea.

En `/polla/polla-regalo`, el popup pregunta el correo de Quentro a inscritos
que todavía no lo guardaron. Confirmarlo en dos campos evita errores de
digitación. Se puede aplazar y retomar desde «Agregar correo»; guardarlo evita
repetir el popup y permite «Cambiar» hasta la entrega.

- `GET/POST /api/casa/pollas/[slug]/prize-contact`: sesión obligatoria y alcance
  propio, validación de correo, respuestas `private, no-store`.
- `GET /api/casa/admin/pollas/[id]/prize-contacts`: solo administradores. Devuelve
  exclusivamente el correo del ganador adjudicado o del resultado calculado
  cuando la migración 150 indica `ready`. Mientras se juega no devuelve correos.
- La tabla de posiciones, los pronósticos de otros y el resultado general no
  contienen correos. Las APIs siguen con `NetworkOnly` en el service worker.

Esto captura el destino de entrega. No comprueba una cuenta externa de Quentro,
no envía mensajes y no transfiere boletas automáticamente.

## Pronósticos de otros

La distribución del marcador propio queda debajo de «Pronósticos de otros»,
visible con la lista cerrada. Se conserva la protección que la muestra solo
desde el inicio real del partido. Con resultado verificado, el servidor ordena
por puntos descendentes antes de paginar, con UUID como desempate estable.
El bloqueo de escritura ocurre cinco minutos antes del saque: la distribución
se publica después, cuando el proveedor confirma el inicio. Antes de eso no
viajan porcentajes ni marcadores ajenos en el payload de la página o la API.

La migración 151 extiende la protección a preguntas manuales: sus opciones y
respuestas libres permanecen privadas mientras la pregunta acepte cambios.
El SQL y `getDistribution` filtran antes de generar el payload RSC. Se permite
verlas al resolver esa pregunta o cerrar los pronósticos de la polla; cerrar
inscripciones no adelanta el acceso a pronósticos de partidos futuros.

## Instalación y pruebas

Aplicar 149 y 150 antes de publicar el código; registrar ambas en el historial
de migraciones. No cambiar modos operativos ni liquidar pollas al instalarlas.
No se contrata un servicio nuevo ni se añade otra consulta al proveedor: se
reutilizan el cron, la cuota y la fuente compartida.

Las pruebas usan Vitest, las regresiones SQL locales y navegador con Supabase
Docker. No crear contactos ni inscripciones de prueba en producción.

Validación del 24 de septiembre: build de producción y 161 pruebas puntuales
aprobados; lint de archivos cambiados sin errores. Las regresiones SQL 149/150
corrieron en transacciones locales con rollback. Navegador: popup a 320, 430,
768 y 1440 px; distribución cerrada, lista ordenada y texto al 200 % a 320,
768 y 1440 px; guardado/reintento, autorización y aparición automática del
ganador al verificarse el último partido. No se generaron pagos en esa prueba.

Producción: migraciones registradas como `20260924183800` y `20260924183801`.
RLS y permisos verificados; Security Advisor conservó su línea base de cero
errores, tres advertencias y una sugerencia. El lint completo conserva cinco
errores previos en `scripts/bake-og-image.cjs` y
`tests/casa-tiebreak-registro.test.ts`, fuera de este cambio.

Seguimiento del mismo día: 151 aplicada como `20260924192500`. Se comprobó
en una transacción que la distribución de los ocho partidos de POLLA REGALO
no cambiara. SQL local: privado antes del cierre, visible después; incluye
partido futuro, bloqueo de cinco minutos, inicio atrasado y suspensión sin
saque. Navegador local a 320/768/1440 px: respuestas manuales ausentes del
HTML/RSC mientras son editables y visibles después del cierre. Build, lint
puntual y 115 pruebas de vivo, verificación, privacidad y reglas aprobados.
