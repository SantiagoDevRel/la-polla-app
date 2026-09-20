# Resúmenes de partidos de las pollas

Implementado el 20 de septiembre de 2026. Activación de producción pendiente:
no se contrató TheSportsDB y la integración permanece apagada por defecto.

## Comportamiento

- `/casa` y `/inicio`: carrusel horizontal «Resúmenes de hoy», únicamente para
  partidos terminados incluidos en pollas publicadas de la Casa. El alcance
  confirmado por el usuario el 20 de septiembre de 2026 es todo el catálogo
  publicado, no solo las pollas en las que está inscrita cada persona.
- `/casa/[slug]`: el mismo carrusel, restringido a esa polla y al día actual.
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
  La sección completa permanece oculta durante la carga, ante un error y cuando
  hay cero videos; solo aparece con uno o más resúmenes válidos. Una respuesta
  parcial conserva el aviso y reintento si ya existe al menos un video visible.

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
SPORTSDB_API_KEY=<clave privada de la suscripción>
```

Sin habilitación explícita, la ruta responde `enabled:false` y no consulta DB
ni proveedor de videos después de validar la sesión. En desarrollo se permite
la clave compartida `123`; producción la rechaza incluso si se configura.

La página de precios anuncia Single Developer a US$9/mes. Sus términos describen
el acceso gratis para desarrollo y exigen suscripción para publicar en tiendas.
La publicación comercial y la cobertura deseada deben resolverse antes de
activar: esta implementación no equivale a autorización para contratar.

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
de resultados. La tarjeta muestra el canal y usa la miniatura pública de
YouTube como previsualización. Si YouTube devuelve su miniatura genérica o la
imagen falla, se oculta y aparece el fondo de humo tricolor de la marca; el
proveedor de búsqueda no se expone como publicidad dentro de la interfaz.

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
