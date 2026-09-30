# Contraseña opcional de seis dígitos

Al completar nombre y pollito, el registro ofrece **Crear contraseña** y
**Omitir por ahora**. Login conserva SMS y añade **Entrar con contraseña**.
**¿Olvidaste tu contraseña? Entrar por SMS** verifica el celular por el flujo
existente y abre `/set-password` para crear otra, sin exigir la anterior.
Un login normal por SMS no muestra esa pantalla. No hay un gate nuevo.

Perfil ofrece **Contraseña → Crear o cambiar contraseña** justo debajo de
**Cuenta para cobrar**, con una llave y un botón violeta, mientras el canal
está habilitado. Reutiliza `/set-password?returnTo=%2Fperfil` y el endpoint
existente: guarda la primera contraseña o reemplaza la anterior y vuelve a
Perfil. Sirve con una sesión obtenida por WhatsApp, SMS o contraseña; no exige
recordar la anterior. No se añade otra tabla, credencial ni proveedor.

Activación: aplicar `160_optional_phone_password.sql`; configurar un secreto
aleatorio `AUTH_PIN_PEPPER` de al menos 32 caracteres y
`PHONE_PASSWORD_ENABLED=true`, ambos solo servidor. Sin configuración completa,
el canal y la oferta de registro permanecen apagados. Cambiar el pepper requiere
que las personas creen otra contraseña entrando por SMS; no rotarlo a ciegas.

La credencial usa scrypt (N=32768, r=8, p=1), salt aleatorio de 16 bytes y pepper
independiente. `phone_password_credentials` tiene RLS deny-all y permisos solo
service_role; los clientes no leen hashes. No se crea una contraseña en GoTrue:
su endpoint público permitiría saltarse el límite específico para seis dígitos.
La sesión reutiliza `startSessionForVerifiedPhone`, valida que el usuario resuelto
sea el dueño de la credencial y registra un evento de login.

Reservas atómicas, antes del hash: cinco intentos por celular en 15 minutos,
20 en 24 horas y 50 por IP en 15 minutos. La IP se guarda como HMAC. La RPC falla
cerrada, conserva intentos y serializa ambos límites con advisory locks.
El código nunca guarda la contraseña en logs, cookies ni storage del navegador.
Crear/cambiar exige sesión verificada y origen del request comprobado; el celular
y UUID vienen de `auth.getUser()`, nunca del formulario.

Pruebas: `npm test -- tests/phone-password.test.ts`,
`scripts/phone-password-check.sql` (transacción con rollback) y
`node scripts/phone-password-concurrency-check.mjs` (solo PostgreSQL local).
Los límites quedan separados de SMS y no agregan envíos ni servicios pagos.
