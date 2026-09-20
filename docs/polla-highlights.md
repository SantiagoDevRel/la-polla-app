# Resúmenes de partidos de las pollas

Implementado el 20 de septiembre de 2026. El usuario confirmó que la app no está
publicada en ninguna tienda y pidió activar el plan gratuito en la web.
No se contrató TheSportsDB. La integración requiere habilitación explícita.

Integrado sobre la versión de producción `918bba6`, conservando las rutas
vigentes `/inicio` y `/polla/[slug]`, el login y las invitaciones actuales.
El matching reutiliza `resultTeamKey` del proveedor vigente; no restaura los
proveedores ni los helpers retirados de ESPN/football-data.

## Comportamiento

- `/inicio` (`/casa` redirige aquí): carrusel horizontal «Resúmenes de hoy», únicamente para
  partidos terminados incluidos en pollas publicadas de la Casa. El alcance
  confirmado por el usuario el 20 de septiembre de 2026 es todo el catálogo
  publicado, no solo las pollas en las que está inscrita cada persona.
- `/polla/[slug]`: el mismo carrusel, restringido a esa polla y al día actual.
- `/futbol/partidos/[uuid]`: resumen del partido, también de días anteriores,
  solo si pertenece a alguna polla publicada. Se consulta independientemente
  de la disponibilidad del detalle de API-Football. Los IDs numéricos externos
  del calendario general no habilitan este lookup de partidos internos.
- «Hoy» siempre corresponde a `America/Bogota`. No se completan huecos con
  videos de otros días, otras competiciones o partidos ajenos a las pollas.
- Borradores, pollas ocultas/programadas aún no publicadas, archivadas/anuladas
  y partidos anulados o con hora provisional quedan fuera. Un partido presente
  en varias pollas se muestra una vez.
- El reproductor se abre dentro de la app al tocar una tarjeta: no carga iframe
  ni API de YouTube antes de esa acción. Cerrar o pulsar Escape detiene el video
  y devuelve el foco. No hay reproducción automática al abrir el inicio.
- El cliente actualiza cada cinco minutos visibles y al volver a la pestaña.
  La sección completa permanece oculta mientras carga, si la consulta falla o
  si no existe ningún video. Solo aparece con uno o más resúmenes. Si ya hay
  videos y la respuesta es parcial, muestra el aviso con reintento.
- Cada tarjeta intenta mostrar la miniatura oficial de YouTube. Si YouTube no
  entrega una miniatura real, se oculta la imagen genérica y queda un fondo de
  humo estático del sistema visual. La interfaz muestra el canal, pero no
  publicidad sobre el proveedor usado para encontrar los videos.

## Disponibilidad real de reproducción

TheSportsDB entrega enlaces de YouTube, no derechos de retransmisión.
YouTube oEmbed confirma metadatos, no que el video vaya a reproducir en cualquier
país o dominio. La API oficial del reproductor detecta errores: 101/150 muestran
que el canal bloquea la reproducción y ofrecen abrir YouTube. Otros errores
también tienen una salida visible. No se eluden restricciones.

Pruebas reales desde esta conexión el 20/09/2026:

- Arsenal–Chelsea, `af99CJ4f_yc`: reproducción en iframe observada, tiempo
  avanzando y `readyState=4`.
- Nacional–Águilas, `qIS18ykepyE`, y Bucaramanga–Medellín, `OGwSOTad2S8`:
  YouTube bloqueó la reproducción embebida pese a devolver oEmbed válido.
- Barcelona–Racing, `bo9g36xT5UA`: iframe no disponible en esta prueba.

No se ha verificado desde una conexión colombiana ni dentro de los binarios
Capacitor iOS/Android. Pagar la API no elimina las restricciones del canal.

## Configuración y costo

Servidor únicamente:

```dotenv
SPORTSDB_HIGHLIGHTS_ENABLED=true
SPORTSDB_API_KEY=123
```

Sin habilitación explícita, la ruta responde `enabled:false` y no consulta DB
ni proveedor de videos después de validar la sesión. La clave pública `123`
funciona también en producción web y es el valor usado si se omite
`SPORTSDB_API_KEY`. Una clave privada es opcional, no un requisito.

El plan gratuito permite 30 solicitudes por minuto y devuelve resultados
limitados por consulta. Se comparte la caché de diez minutos entre usuarios.
No asumir que esta web está publicada en una tienda: el dueño confirmó que no.
Si se decide distribuir en tiendas en el futuro, revisar entonces las condiciones
aplicables; no bloquear el despliegue web exigiendo una suscripción no autorizada.

- Precios: <https://www.thesportsdb.com/docs_pricing.php>
- Condiciones: <https://www.thesportsdb.com/docs_terms_of_use.php>
- API: <https://www.thesportsdb.com/documentation>
- Reproductor: <https://developers.google.com/youtube/iframe_api_reference>

## Datos y seguridad

`GET /api/casa/highlights?polla=<slug>&match=<uuid>` valida auth antes de todo
acceso a datos. Ambos filtros son opcionales; sin `match` siempre se usa el día
de Colombia actual, nunca una fecha arbitraria enviada por el cliente.

El helper lee solo el catálogo publicado de `casa_polla_matches`/`casa_pollas`
y la identidad de `matches`; no lee inscripciones, pagos, teléfonos ni
pronósticos. Pagina a 500, filtra publicación en SQL y deduplica UUIDs.
Respuestas `private, no-store`; la ruta comparte la exclusión NetworkOnly
existente del SW. La excepción exacta en middleware deja que el handler devuelva
JSON 401, no un redirect que termine en HTML con status 200.

El proveedor consulta por liga/día UTC y cachea metadatos públicos diez minutos
con Next Data Cache; las llamadas concurrentes a una misma clave se reúnen
dentro del worker. El presupuesto temporal total es quince segundos. El día
colombiano puede abarcar dos fechas UTC. La clave nunca se envía al cliente ni
se registra en errores.

El matching exige ambos equipos completos normalizados, liga y kickoff ±2 h,
con un único evento candidato. Solo se aceptan IDs de YouTube de 11 caracteres
extraídos de hosts explícitos HTTPS; el iframe se construye localmente, nunca
con HTML del proveedor. oEmbed se cachea una hora. Videos eliminados/privados
se omiten cuando oEmbed los identifica como tales; los bloqueos del reproductor
se gestionan en el cliente.

En gratis, `eventsday` devuelve como máximo tres partidos por consulta; la
cobertura del prototipo puede ser incompleta. No hay cron, proxy de video,
dependencias nuevas, migraciones ni escrituras de partidos/resultados. El video
viaja directo de YouTube al usuario; API-Football sigue siendo el proveedor
de resultados. Se conserva la identificación del canal de YouTube; TheSportsDB
no aparece como texto promocional en la interfaz.

## Verificación

```bash
npm test -- tests/polla-highlights-matching.test.ts tests/polla-highlights-api.test.ts tests/polla-highlights-provider.test.ts
npm run typecheck:fast
npm run build
```

Pruebas de integración: Supabase Docker local, usuario y polla de prueba;
lectura real del endpoint y APIs externas, más fixtures visuales interceptados
solo en el navegador para revisar carrusel con tres tarjetas, vacío y errores.
Evidencia temporal en Downloads/la-polla-resumenes-2026-09-20, nunca datos
de demostración en producción.
