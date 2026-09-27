# Preferencias de avisos de WhatsApp

El usuario puede dejar de recibir marketing sin eliminar su cuenta ni perder
los códigos de acceso que solicite. `BAJA`, `STOP` y `DARME DE BAJA` desactivan
los avisos; `ALTA` los activa. También puede cambiarlo desde **Perfil → Avisos
por WhatsApp**. La lista privada está en **Administración → Destinatarios de
WhatsApp** (`/admin/whatsapp`), con altas y bajas separadas y páginas de 25.

El dueño confirmó el 2026-09-27 que los términos aceptados al registrarse
incluyen consentimiento para avisos comerciales. La migración 156 importa
los móviles colombianos verificados (`573` + nueve dígitos) sin preferencia.
Registra `source=legacy` y `last_event_id=terms-owner-confirmed:20260927:…`;
la fecha es la de importación, no una fecha inventada de aceptación individual.
En administración aparecen como «Términos de registro». Ninguna BAJA ni elección
previa se sobrescribe. Otros países requieren ALTA o activación en Perfil.
El trigger aplica la regla a nuevos teléfonos colombianos, comprobando también
teléfono confirmado en Supabase Auth. Un login posterior nunca reactiva BAJA.
Si cambian los términos, revisar esta regla; la base es la confirmación del dueño.

Los envíos puntuales hechos
desde el panel de un proveedor también deben consultar esta preferencia;
una herramienta externa no puede heredar automáticamente los filtros de la app.

## Datos y seguridad

Migración `155_wa_marketing_preferences.sql`:

- `wa_marketing_preferences`: estado actual por teléfono verificado.
- `wa_marketing_events`: evidencia mínima, deduplicación y confirmación enviada.
- `wa_set_marketing_preference`: única escritura, atómica por teléfono. Usa
  `message.sentAt`, no el momento del reintento. En un empate temporal gana
  BAJA. Un ALTA atrasado o repetido nunca revive una baja posterior.
- Conserva las bajas de `wa_avisos_opt_out`, sin borrar esa tabla ni filas.
  Ambas tablas nuevas tienen RLS y acceso solo de servidor.

`GET/PATCH /api/users/me/whatsapp-preference` valida sesión; deriva el teléfono
de Supabase Auth, nunca del cuerpo del cliente. PATCH exige el mismo origen.
`GET /api/admin/whatsapp-audience` exige un usuario administrador. Respuestas
privadas, `no-store`; el SW ya usa NetworkOnly para todas las API y Perfil.

`loadRecipients` exige alta explícita; `sendAviso` la vuelve a comprobar antes
del envío y falla cerrado si la consulta falla. OTP no consulta esta lista.
No se activan crons ni conversaciones históricas como consecuencia de guardar
una preferencia.

## Conexión Zernio

Crear un webhook **solo para la cuenta y perfil del emisor** hacia
`https://lapollacolombiana.com/api/whatsapp/zernio`, evento `message.received`.
Configurar `ZERNIO_WEBHOOK_SECRET`, generado aleatoriamente y solo server-side,
y las credenciales Zernio ya documentadas en `whatsapp-otp.md`.

El endpoint comprueba HMAC SHA-256 del cuerpo crudo (`X-Zernio-Signature`),
cuenta, plataforma, dirección entrante y tiempo antes de escribir. No llama
al router histórico. Ignora saludos, pronósticos y otros comandos. Una firma
inválida falla antes de acceder a la DB. `webhook.test` firmado responde 200.

Primero persiste la preferencia; después confirma con un texto de servicio
en la misma conversación y una clave de idempotencia. Si falla, Zernio puede
reintentar sin duplicar el cambio. Eventos de más de 23 horas guardan el
cambio pero no intentan una respuesta fuera de la ventana de atención.
No se registran teléfonos ni cuerpos de mensajes en logs.

Para números ocultos por WhatsApp/BSUID, nunca inferir un teléfono desde un
identificador arbitrario. Si no hay identidad telefónica verificable, el
evento falla explícitamente y debe resolverse antes de enviar marketing a
esa identidad. Las altas nuevas siguen bloqueadas por defecto.

Fuentes: [firma y reintentos](https://docs.zernio.com/webhooks),
[payload entrante](https://docs.zernio.com/webhooks/inbox).

## Verificación

```sh
npm test -- tests/whatsapp-preferences.test.ts tests/whatsapp-audience-auth.test.ts tests/whatsapp-avisos.test.ts tests/whatsapp-login-only.test.ts
npm run build
```

`scripts/wa-preferences-check.sql` debe correrse dentro de `BEGIN` / `ROLLBACK`:
comprueba altas, bajas, eventos repetidos/atrasados, empate de timestamps y
permisos. No envía mensajes ni deja destinatarios de demostración.
`scripts/wa-registration-consent-check.sql` comprueba país, verificación,
idempotencia y conservación de BAJA, también con rollback.

Plantilla `lp_polla_nueva_v2` (es, MARKETING): cuatro variables de cuerpo
(nombre, polla, entrada y premio mínimo garantizado formateados), botón
«Participar» con slug. Incluye saltos de línea, 🐥/👇 y énfasis en nombre/importes.
La indicación BAJA es un FOOTER real. Solo usar con premio mínimo garantizado
confirmado por SQL, nunca para un pozo proporcional u objeto. Requiere aprobación
Meta. El cron histórico permanece apagado y conserva su plantilla/parametrización.

Contrato visual: Outfit; título de preferencia 16/600, cuerpo y ayuda 14/400,
estado 14/500 y control 14/600; interlineado relativo para texto al 200 %.
Admin conserva Bebas para los encabezados. Verificar 320, 768 y 1440 px,
carga/error/vacío, cambio de preferencia y recarga desde ambas vías.

Activar el webhook no habilita campañas automáticas ni el OTP pendiente de
aprobación de Meta. Para confirmar la cadena real, el dueño escribe BAJA/ALTA
desde su WhatsApp; revisar recepción del proveedor, DB, confirmación y lista.
