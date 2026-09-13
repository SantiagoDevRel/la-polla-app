# ops/backup: backup automático y cifrado en el DGX

Ejecutor programado de `scripts/export-backup.ts` y `scripts/verify-backup.ts`.
Corre en el DGX con timers de systemd de usuario. Deja **solo archivos cifrados
con gpg** fuera de la RAM y el PC trae una segunda copia cifrada.

```
DGX (systemd --user, cada 6 h)
  export-backup.ts ──► $XDG_RUNTIME_DIR (tmpfs, en claro solo durante la corrida)
  verify-backup.ts ──► sha256 de cada tabla y archivo, ok=true obligatorio
  tar | zstd -19 | gpg --encrypt -r $GPG_RECIPIENT
                   ──► ~/apps/la-polla-backup/snapshots/<stamp>.tar.zst.gpg
  sha256 + conteos ──► snapshots/index.tsv
  poda GFS         ──► solo snapshots listados en index.tsv con nombre del job
  estado           ──► ~/apps/la-polla-backup/status/backup-last.json (sin datos personales)
  bitácora         ──► Supabase public.backup_runs (bien o mal, en el trap)

GitHub Actions (cada hora, no depende del DGX)
  /api/cron/backup-freshness ──► lee backup_runs; si el último backup bueno
                                 tiene > 7 h o la última verificación > 30 h,
                                 correo "Backup de La Polla atrasado"

PC (Programador de tareas, diario)
  scp de los .gpg nuevos ──► %USERPROFILE%\Backups\la-polla\snapshots
  sha256 contra index.tsv, aviso con msg.exe si el más nuevo tiene > 8 h
```

La llave **privada** no está en el DGX ni en el repo. Sin ella, nadie en el DGX
puede leer los snapshots. Tampoco los puede leer este runner.

## Archivos

| Archivo | Qué hace |
| --- | --- |
| `run-backup.sh` | Una corrida completa. Sale ≠ 0 ante cualquier fallo. |
| `verify-snapshots.sh` | `sha256sum -c` del índice, destinatario gpg, huérfanos y frescura (≤ 8 h). |
| `lib.sh` | Log para journald, carga segura del env, estado JSON, poda GFS, `record_run`. |
| `record-run.mjs` | Inserta la corrida en `public.backup_runs` (migración 117). Siempre sale con 0. |
| `test-prune.sh` | Prueba de la poda con 1.600 archivos falsos en un directorio temporal. |
| `test-record-run.sh` | Prueba del registro: payload, validaciones, red caída, código de salida intacto y, opcional, insert real contra un Supabase local. |
| `systemd/*.service`, `systemd/*.timer` | Units de usuario. |
| `tools/package.json` + `package-lock.json` | `tsx` fijado con lockfile. La app no lo trae. |
| `pc/pull-snapshots.ps1`, `pc/register-task.ps1` | Segunda copia en Windows. |

## Horarios

| Timer | Cuándo | Notas |
| --- | --- | --- |
| `la-polla-backup.timer` | 00:10, 06:10, 12:10 y 18:10 America/Bogota | `Persistent=true`, `RandomizedDelaySec=120`, `TimeoutStartSec=45min` |
| `la-polla-backup-verify.timer` | 03:40 America/Bogota | `Persistent=true` |

## Retención (GFS)

Se conserva la unión de: todo lo de las últimas 48 h; el más nuevo de cada
bloque de 6 h (UTC) de los últimos 7 días; el más nuevo de cada día de los
últimos 35 días; de cada semana ISO de las últimas 12 semanas; de cada mes de
los últimos 12 meses; y siempre los 3 más nuevos. Con un snapshot cada 6 h
quedan unos 74 archivos.

La poda **solo** borra archivos que cumplan las tres condiciones: estar en
`index.tsv`, tener nombre `AAAA-MM-DD-HH-MM.tar.zst.gpg` y existir en
`snapshots/`. Cada borrado queda en `snapshots/prune.log`. Nada fuera de
`snapshots/` se toca (por ejemplo, el backup manual del 26-jul). Prueba:
`bash ops/backup/test-prune.sh`.

## Instalación en el DGX

Requisitos ya verificados en el DGX (aarch64): node 24, gpg, zstd, flock,
`Linger=yes` y `XDG_RUNTIME_DIR` en tmpfs. **No se instalan paquetes del
sistema.**

```bash
# 1) Código fijado a un commit revisado (nunca main automático)
git clone --depth 50 https://github.com/SantiagoDevRel/la-polla-app ~/apps/la-polla-backup-runner
cd ~/apps/la-polla-backup-runner && git checkout <commit revisado>
npm ci --ignore-scripts                              # dotenv + supabase-js del lockfile del repo
npm ci --ignore-scripts --prefix ops/backup/tools    # tsx fijado

# 2) Llave pública (solo la pública)
gpg --import la-polla-backup-gpg-public.asc
echo "<FINGERPRINT>:6:" | gpg --import-ownertrust

# 3) Secretos: se escriben por stdin, nunca como argumento de un comando
install -d -m 700 ~/.config/la-polla-backup
umask 077; cat > ~/.config/la-polla-backup/env    # pegar y Ctrl-D
chmod 600 ~/.config/la-polla-backup/env

# 4) Units
mkdir -p ~/.config/systemd/user
ln -sf ~/apps/la-polla-backup-runner/ops/backup/systemd/la-polla-backup{,-verify}.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now la-polla-backup.timer la-polla-backup-verify.timer
loginctl show-user "$USER" -p Linger                # Linger=yes
```

Formato de `~/.config/la-polla-backup/env`. El cargador **no ejecuta** el
archivo: exige dueño = usuario, permisos 600 y directorio 700, y solo acepta
estas variables:

```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...     # secret key dedicada "backup_dgx"
SUPABASE_BACKUP_PAT=sbp_...                 # token "backup-dgx": scope proyecto, Database: Read
GPG_RECIPIENT=<fingerprint de 40 hex en mayúsculas>
# opcionales: MIN_FREE_GB=50  MAX_AGE_HOURS=8
```

`run-backup.sh` quita `SUPABASE_ACCESS_TOKEN` y `SUPABASE_30_DAYS` del entorno
para que el export use solo el token dedicado. Con `Database: Read`, incluso
`/database/query` corre como `supabase_read_only_user` en una transacción de
solo lectura (verificado el 13-sep-2026).

## Operación

```bash
systemctl --user start la-polla-backup.service         # corrida manual
journalctl --user -u la-polla-backup -f                # log (sin tokens ni teléfonos)
systemctl --user list-timers 'la-polla-backup*'
~/apps/la-polla-backup-runner/ops/backup/verify-snapshots.sh
cat ~/apps/la-polla-backup/status/backup-last.json     # ok, exit_code, phase, reason, free_gb
PRUNE_DRY_RUN=1 ~/apps/la-polla-backup-runner/ops/backup/run-backup.sh   # corrida sin podar de verdad
```

Códigos de salida de `run-backup.sh`: `0` ok · `1` fallo · `3` snapshot
guardado pero quedan menos de `MIN_FREE_GB` · `4` snapshot guardado pero
**degradado** (auth sin SQL completo, Storage sin cruce, otro token o errores
en `schema/live`) · `75` otra corrida tiene el lock · `130` interrumpido.

Alertas: el unit queda `failed` (`systemctl --user --failed`), el estado queda
en `status/*.json` y la tarea del PC muestra un `msg.exe` si la última corrida
falló, si el DGX tiene menos de 50 GB libres o si el snapshot más nuevo tiene
más de 8 h. **No** se usa el bot de Telegram de admins: si ese token se
filtrara, permitiría secuestrar las aprobaciones de pagos.

### Alerta por correo de backup atrasado

Las alertas de arriba necesitan que el DGX o el PC estén prendidos. Esta no.

1. Al terminar, bien o mal, `run-backup.sh` (`kind=backup`) y
   `verify-snapshots.sh` (`kind=verify`) llaman a `record_run`, que ejecuta
   `record-run.mjs`: un `POST /rest/v1/backup_runs` con la secret key del env
   (`Prefer: return=minimal`, 10 s de timeout, un reintento solo ante red caída
   o 5xx, tope total de 40 s). La llave va por entorno, nunca por argv; la URL
   debe ser `https` (o `http` a 127.0.0.1 para pruebas).
2. La fila lleva solo `status` (`ok`/`failed`), fechas, nombre del snapshot,
   bytes, tablas, filas, cuentas, objetos de Storage, commit del runner y el
   motivo del fallo que arma el script (máx. 400 caracteres). Nada de filas ni
   teléfonos; los CHECK de la migración 117 rechazan formatos raros.
3. **Registrar nunca cambia el código de salida.** El resultado queda en
   `status/*.json` como `run_recorded`: `ok`, `skipped_no_credentials` (falló
   antes de leer el env), `failed_http_<status>[_<código>]`, `failed_network`,
   `failed_timeout`…
4. `.github/workflows/backup-freshness.yml` llama cada hora (minuto 17) a
   `/api/cron/backup-freshness`. Si el último backup bueno tiene más de
   `BACKUP_MAX_AGE_HOURS` (7) o la última verificación buena más de
   `BACKUP_VERIFY_MAX_AGE_HOURS` (30), o no hay filas, manda un correo a
   `ADMIN_ALERT_EMAIL` (o `FEEDBACK_NOTIFY_EMAIL`) con asunto «Backup de La
   Polla atrasado», el último fallo y qué revisar. Se repite cada hora mientras
   siga atrasado. Si Resend rechaza el envío, la ruta responde 502 y el
   workflow falla (GitHub también avisa).

Umbrales: el backup corre cada 6 h, así que 7 h deja una hora de margen; un
backup **degradado** (código 4) o con poco disco (código 3) se registra como
`failed` y, si persiste, también dispara la alerta.

Primera verificación: mientras no exista **ninguna** fila `kind=verify` (ni
buena ni fallida) y el **primer** backup bueno tenga 30 h o menos, la
verificación queda «pendiente» y no dispara el correo (el timer corre a las
03:40, no cuando se activa el runner). El margen se cuenta desde el primer
backup y no desde el último: si la verificación nunca arranca, a las 30 h
avisa. Una verificación fallida no tiene margen.

Probar sin tocar producción:

```bash
bash ops/backup/test-record-run.sh            # sin red
RECORD_RUN_TEST_URL=http://127.0.0.1:54321 \
RECORD_RUN_TEST_SERVICE_KEY=<service key local> RECORD_RUN_TEST_ANON_KEY=<anon key local> \
  bash ops/backup/test-record-run.sh          # + inserts reales contra Supabase local (migración 117 aplicada)
RECORD_RUN_DRY=1 node ops/backup/record-run.mjs --kind=backup --exit-code=0   # imprime el JSON, no envía
```

Orden para activarla:

1. Migración 117 en producción.
2. Runner del DGX en el commit que trae `record-run.mjs`.
3. Corridas manuales de los dos tipos, en este orden:
   ```bash
   systemctl --user start la-polla-backup.service
   systemctl --user start la-polla-backup-verify.service
   ```
4. Confirmar que hay una fila buena de cada tipo antes de mergear:
   ```sql
   SELECT kind, status, max(finished_at) FROM public.backup_runs GROUP BY 1, 2;
   ```
   Deben aparecer `backup | ok` y `verify | ok`.
5. Merge del workflow.

Al revés, el correo llega cada hora por "no hay filas". Si solo existe el
backup, la ruta espera la primera verificación hasta 30 h (ver arriba), pero
correr las dos a mano deja la alerta probada de punta a punta desde el inicio.

### Actualizar el runner

Solo a un commit revisado: `git fetch && git checkout <commit>`, luego
`npm ci --ignore-scripts` (y en `ops/backup/tools`) y
`systemctl --user daemon-reload`. Los units son symlinks al repo.

## Restaurar desde un snapshot (en el PC, con la llave privada)

```bash
# llavero temporal: la privada no se queda en el llavero del día a día
export GNUPGHOME="$(mktemp -d)"
gpg --batch --import LA-POLLA-BACKUP-GPG-PRIVATE-<fingerprint>.asc
gpg --batch --decrypt 2026-09-13-17-10.tar.zst.gpg > snap.tar.zst
tar --zstd -xf snap.tar.zst            # o: tar.exe -xf snap.tar.zst (bsdtar de Windows)
npx tsx scripts/verify-backup.ts 2026-09-13-17-10
```

Si el gpg de Git for Windows responde `Bad secret key` recién importada la
llave, reinicia el agente de ese llavero (`gpgconf --kill gpg-agent`) y
repite: pasó en la prueba del 13-sep-2026 y el segundo intento descifró bien.

Prueba real del 13-sep-2026: snapshot `2026-09-13-12-39` (15 MB cifrado)
descifrado en el PC, extraído con `tar.exe` y `verify-backup.ts` en verde
(58 tablas, 40.452 filas, 297 cuentas, 119 archivos, 248 sha256).

Después sigue `docs/backup-restore.md` (restore SQL con `session_replication_role = replica`).
La carpeta descifrada tiene teléfonos y comprobantes: se borra al terminar.

## Segunda copia en el PC

```powershell
Copy-Item ops\backup\pc\pull-snapshots.ps1 $env:USERPROFILE\Backups\la-polla\
powershell -NoProfile -ExecutionPolicy Bypass -File ops\backup\pc\register-task.ps1 `
  -ScriptPath $env:USERPROFILE\Backups\la-polla\pull-snapshots.ps1
```

Necesita SSH sin contraseña al DGX (alias `spark`). Nunca borra. Los snapshots
que el DGX ya podó se quedan en el PC hasta que el dueño decida.

## Qué pedirle al dueño antes de tocar esto

- Aprobación para rotar o revocar la secret key `backup_dgx` o el token
  `backup-dgx` (vence el 10-sep-2027: renovarlo antes o el backup queda degradado).
- Dónde vive la llave privada (gestor de contraseñas + copia offline). Sin ella
  los snapshots no se pueden leer.
- Cualquier cambio de retención: la de 12 meses responde a Habeas Data.
