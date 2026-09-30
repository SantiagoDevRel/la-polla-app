# Acceso por enlace de WhatsApp

Decisión del dueño, 30-sep-2026: recuperar el acceso por enlace personal.
El botón principal verde del login, con logo de WhatsApp, prellena
**dame el link para entrar a la polla** a **+1 856 483 1652**, el número
propio conectado en Zernio; recibe **Haz clic para entrar**, confirma su número
enmascarado y abre la sesión. También responde a Hola u otro mensaje.
No pide copiar códigos. Login ofrece WhatsApp primero, seguido de SMS
y contraseña; Telegram se quitó de las opciones por decisión del dueño.
ALTA/BAJA conservan prioridad y sus preferencias; no se reactiva el bot antiguo.

Usuarios con username (corrección 1-oct-2026): Meta puede entregar solo un
BSUID y omitir el teléfono. El bot responde en la misma conversación con
`request_contact_info`, el botón nativo para compartir el número propio.
La respuesta firmada con `metadata.contactsOrigin=contact_request` y un único
`phones[].wa_id` válido permite emitir el enlace. Una tarjeta de la agenda,
un número escrito o un BSUID nunca prueban propiedad. Zernio incorpora el
número compartido al contacto; no hay tablas nuevas ni cambios de cuentas.
`metadata` vive en la raíz del evento; se respeta `standby` antes de responder.
El límite de cinco enlaces por hora ahora explica cómo usar el último enlace
o entrar mediante SMS/contraseña, en lugar de dejar a la persona sin respuesta.
Contrato del proveedor: [OpenAPI de Zernio](https://docs.zernio.com/api/openapi),
`sendInboxMessage` e `InboxMessageReceivedWebhook`.

Aplicar `159_whatsapp_login_link.sql`. Configuración privada del servidor:

```dotenv
WHATSAPP_LOGIN_NUMBER=18564831652
WHATSAPP_LOGIN_ENABLED=true
# Solo pruebas mientras ENABLED=false; no muestra el botón público:
WHATSAPP_LOGIN_TEST_PHONE=<número E.164 de prueba>
```

Reutiliza `ZERNIO_API_KEY`, `ZERNIO_WHATSAPP_ACCOUNT_ID` y
`ZERNIO_WEBHOOK_SECRET`, con el webhook existente `/api/whatsapp/zernio`.
No cambiar la conexión de Meta ni `WHATSAPP_OUTBOUND_ENABLED`.
`WHATSAPP_OTP_ENABLED` sigue falso: Meta rechazó AUTHENTICATION con código10,
subcódigo2388185 y la verificación empresarial pide información adicional.

Seguridad: firma HMAC antes de parsear/DB, cuenta y remitente comprobados,
sin usar números escritos en el mensaje ni BSUID como teléfono. Solo mensajes
entrantes recientes; máximo cinco enlaces por número/hora, reserva SQL atómica.
Token HMAC de256bits estable por evento; DB guarda solo SHA256 con prefijo `wa2:`.
Vence diez minutos después del mensaje; retries no extienden vencimiento.
Las vistas previas GET/HEAD no consumen ni crean sesiones: confirma mediante POST
del mismo origen, claim condicional con vencimiento y un solo uso.
Los enlaces antiguos almacenados sin hash no se aceptan; sus filas se conservan.

La respuesta interactiva usa la ventana de atención iniciada por el usuario.
No se envía una plantilla MARKETING/UTILITY para disfrazar un OTP. La aceptación
del mensaje por la API no representa una aprobación de políticas de Meta.
Zernio documenta los botones CTA y la ventana de24horas:
[Inbox](https://docs.zernio.com/platforms/whatsapp/inbox).
Costos sujetos al plan existente y a la tarifa de Meta; no hay SMS ni proveedor
nuevo. Desde1-oct-2026 Meta cambia la tarifa de mensajes de servicio: revisar
[precios oficiales](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
antes de prometer envíos ilimitados gratuitos.

Checks: `npm test -- tests/whatsapp-login-link.test.ts tests/whatsapp-username-login.test.ts tests/whatsapp-preferences.test.ts`,
`npm run build`, `scripts/whatsapp-login-check.sql` (rollback), revisión real del
botón, confirmación, cookies y rechazo del segundo uso. Sin tokens/PII en logs.
