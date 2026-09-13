# Backup y restore de La Polla

Cómo sacar una copia completa de la app —datos, cuentas, archivos de Storage,
esquema— y cómo devolverla a una base Postgres/Supabase.

Nació del cierre de temporada post-Mundial 2026 (2026-07-26) y se endureció
el 2026-09-13, antes del lanzamiento de Casa. Los riesgos que cubre:

- **Un proyecto Supabase se puede pausar, perder o corromper.** Los
  pronósticos, las inscripciones y los comprobantes no se pueden volver a
  generar.
- **Los backups diarios de Supabase Pro no incluyen Storage**, no bajan de
  24 h de RPO, no restauran por tabla y viven en la misma cuenta.

Por eso el backup vive **fuera** de Supabase.

---

## Sacar un backup

```bash
npx tsx scripts/export-backup.ts
```

Escribe `backups/<fecha-hora>.partial/` y la renombra a `backups/<fecha-hora>/`
**solo cuando terminó bien**. Una carpeta `.partial` es un export que se cortó:
no es un backup y los demás scripts la ignoran (se puede borrar a mano). Es
**solo lectura**: no escribe ni una fila en la base. Tarda ~1,5 min con los
datos de septiembre de 2026 (58 tablas, 40 mil filas, 17 MB de Storage).

Variables (de `.env`, o `DOTENV_CONFIG_PATH=<ruta>` para leer otro archivo):

| Env | Para qué |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | requerido |
| `SUPABASE_SERVICE_ROLE_KEY` | requerido — lee tablas y Storage, bypass RLS |
| `SUPABASE_BACKUP_PAT` → `SUPABASE_ACCESS_TOKEN` → `SUPABASE_30_DAYS` | Token de la Management API, se usa el primero que exista. **Muy recomendado.** Basta un token con scope de proyecto y permiso `database_read`: todo el SQL va por `POST /v1/projects/<ref>/database/query/read-only`, que corre como `supabase_read_only_user`. |

Sin token el backup sigue sirviendo, pero reducido: `auth` sale por la admin
API (no se pueden recrear las cuentas con su mismo uuid), no hay
`schema/live` y el listado de Storage no se puede cruzar contra la base.

Flags: `BACKUP_DIR=<path>` · `SKIP_STORAGE=1` · `SKIP_PII=1`.

### Qué verifica mientras exporta (y aborta si no cuadra)

- **Tablas:** PostgREST topa en 1000 filas por request incluso con
  service_role. Se pagina con orden estable y al final se compara contra
  `count(*)` exacto y contra ids únicos.
- **Storage:** `storage.list` también devuelve máximo 1000 entradas por
  llamada. Se pagina con `offset`, recursivo por carpetas, y el resultado se
  cruza contra `storage.objects` por bucket: **conteo y nombres**. Si alguien
  sube un archivo en medio, reintenta una vez; si sigue sin cuadrar, aborta.
- **Archivos:** cada archivo de `auth/`, `storage/`, `schema/`, `RESUMEN.md` y
  `README.md` queda en el manifiesto con **sha256 y bytes**. Las tablas
  guardan filas + sha256.

Los logs no imprimen tokens, teléfonos ni rutas de objetos de Storage.

### Qué queda adentro

```
backups/2026-09-13-12-01/
├── README.md                  qué es esto + aviso de datos personales
├── RESUMEN.md                 los números en texto plano: totales y la
│                              tabla final de CADA polla. Se lee sin DB.
├── _manifest.json             formato 2: filas + sha256 por tabla, sha256 +
│                              bytes por archivo, buckets, PKs, orden de
│                              restore, errores de schema/live
├── tables/*.json              una tabla de `public` por archivo
├── auth/
│   ├── users.full.json        auth.users completo
│   ├── identities.full.json   auth.identities completo
│   └── restore-auth.sql       restore de cuentas para psql (ver abajo)
├── storage/<bucket>/…         comprobantes, premios, evidencias
└── schema/
    ├── migrations/*.sql       las migraciones del repo
    └── live/                  definiciones REALES de prod (read-only):
        ├── functions.sql/.json    pg_get_functiondef de public
        ├── triggers.sql/.json     public, auth y storage
        ├── policies.sql/.json     pg_policies de public y storage
        ├── rls.json               RLS activada/forzada por tabla
        ├── columns.json           columnas, defaults, identity, generadas
        ├── cron_jobs.json         cron.job (puede llevar secretos)
        ├── storage_buckets.json
        ├── schema_migrations.json supabase_migrations.schema_migrations
        └── extensions.json
```

Backup del 2026-09-13: **40.452 filas · 58 tablas · 297 cuentas · 504
identities · 119 archivos (17,3 MB) · 96 funciones · 36 triggers · 71
policies · 4 crons**, en 90 s.

> ⚠️ **Las migraciones del repo NO reconstruyen prod.** Aplicadas en orden
> sobre un Postgres limpio fallan 18 de 112 (tablas creadas fuera de
> migraciones como `app_config`, columnas como `matches.elapsed`, funciones
> duplicadas). Prod registra 97 migraciones. Para saber qué había de verdad,
> la fuente es `schema/live/`.

### ⚠️ Esto tiene datos personales

Teléfonos, emails, hashes de contraseña, comprobantes de pago de gente real
y, en `schema/live/cron_jobs.json`, posibles secretos de los crons. El repo
de la app es **público (MIT)**:

- `backups/` está en `.gitignore`. **Nunca** lo saques de ahí sin cifrar.
- No lo subas a un Drive compartido ni lo pases por chat/Slack/email.
- Si lo mueves, cífralo antes (gpg) y llévalo a un disco o máquina tuya.
- Habeas Data (Ley 1581): esta copia es un tratamiento de datos. Guárdala
  con la misma seriedad que la base.

---

## Verificar que el backup sirve

Un backup sin verificar es una promesa, no un respaldo.

```bash
npx tsx scripts/verify-backup.ts                          # el más nuevo (ignora .partial)
npx tsx scripts/verify-backup.ts backups/2026-09-13-12-01
npx tsx scripts/verify-backup.ts --json                   # una línea JSON, para automatizar
MAX_AGE_HOURS=7 npx tsx scripts/verify-backup.ts          # además exige que sea reciente
ONLINE=1 npx tsx scripts/verify-backup.ts                 # + compara counts contra la DB viva
```

Corre **offline** y sale con **código 1 ante cualquier diferencia**:

- cada tabla: existe, sha256 y número de filas;
- cada archivo del manifiesto (auth, Storage, esquema, RESUMEN, README):
  existe, mismos bytes y mismo sha256;
- un archivo en disco que **no** está en el manifiesto también es un problema;
- los totales de Storage coinciden con el inventario, y los usuarios e
  identities en disco con lo declarado;
- `MAX_AGE_HOURS`: si el backup es más viejo, falla (un valor inválido también
  falla, para no creer que se vigila la frescura cuando no);
- una carpeta `.partial` pasada a mano se rechaza.

`--json` imprime solo `{ ok, dir, formatVersion, generatedAt, ageHours,
tables, rows, authUsers, authIdentities, storageFiles, storageBytes,
filesVerified, problems, warnings }`. Los errores de `schema/live` salen como
`warnings` (no invalidan los datos).

Los backups de **formato 1** (antes del 2026-09-13) se siguen verificando:
tablas por sha256, y Storage/auth solo por conteo, con un aviso.

---

## Guardar una copia afuera

El backup no sirve de nada si vive solo en el mismo disco. Verifícalo,
cífralo y cópialo a otra máquina:

```bash
npx tsx scripts/verify-backup.ts backups/2026-09-13-12-01
tar -C backups -cf - 2026-09-13-12-01 | zstd -19 | gpg --encrypt -r "$GPG_RECIPIENT" > 2026-09-13-12-01.tar.zst.gpg
sha256sum 2026-09-13-12-01.tar.zst.gpg > 2026-09-13-12-01.tar.zst.gpg.sha256
scp 2026-09-13-12-01.tar.zst.gpg* $HOST:~/apps/la-polla-backup/snapshots/
ssh $HOST 'cd ~/apps/la-polla-backup/snapshots && sha256sum -c 2026-09-13-12-01.tar.zst.gpg.sha256'
```

Si comparas listados de huellas entre Windows y Linux, normaliza el `*` de
modo binario y usa `LC_ALL=C sort` de los dos lados:

```bash
find . -type f | xargs sha256sum | sed -E 's/^([0-9a-f]+) [ *](.*)$/\1  \2/' | LC_ALL=C sort
```

---

## Restaurar

Orden obligatorio: esquema → cuentas y tablas (SQL) → Storage → comprobar.

### Por qué las tablas NO van por PostgREST

`restore-backup.ts` inserta por PostgREST, y con el esquema actual eso falla o
deja datos alterados:

- `trigger_lock_predictions` (`check_prediction_lock`) rechaza pronósticos de
  partidos ya jugados: *"No se pueden crear ni modificar pronósticos a menos
  de 5 minutos del partido"* (reproducido el 2026-09-13).
- Los guards de Casa v2 rechazan filas de Casa fuera de su ciclo de vida.
- `on_auth_user_created` crea `public.users` con valores por defecto al
  insertar `auth.users`, y después la fila real de `public.users` choca.

La salida es un `.sql` para psql que corre todo en **una transacción** con
`SET LOCAL session_replication_role = replica`: triggers y FKs apagados solo
dentro de esa transacción. En la imagen `supabase/postgres:17.6.1.159` el rol
`postgres` (que no es superusuario) tiene permiso para ese `SET`; si en otro
entorno da `permission denied`, conéctate como `supabase_admin`.

### 1. Destino con el esquema puesto

Un **Supabase local** (`npx supabase start` + `supabase db reset`) con el
esquema aplicado. Si las migraciones del repo no alcanzan (ver el aviso de
arriba), usa `schema/live/` del backup como referencia de lo que falta.

### 2. Generar y correr el SQL de cuentas + tablas

```bash
npx tsx scripts/restore-backup-sql.ts backups/2026-09-13-12-01
# → backups/2026-09-13-12-01.restore.sql (fuera de la carpeta del backup)

psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -v ON_ERROR_STOP=1 -f backups/2026-09-13-12-01.restore.sql
```

El generador no se conecta a ninguna base. Antes de escribir el `.sql`
verifica el sha256 de cada tabla y de los dumps de auth. El SQL:

- incluye `auth.users` y `auth.identities` primero (salvo `SKIP_AUTH=1`);
- **aborta si alguna tabla destino ya tiene filas** (salvo `ALLOW_NONEMPTY=1`);
- convierte cada lote con `jsonb_populate_recordset(NULL::tabla, …)`, así
  Postgres usa los tipos reales del destino (arrays, jsonb, enums, fechas);
- omite columnas generadas (`auth.users.confirmed_at`,
  `auth.identities.email`…) e inserta identity con `OVERRIDING SYSTEM VALUE`;
- **aborta si el backup trae una columna que el destino no tiene** (salvo
  `ALLOW_MISSING_COLUMNS=1`, que las ignora: úsalo solo para ensayos);
- ajusta las secuencias al máximo restaurado;
- compara el `count(*)` de cada tabla con el backup. Si algo no cuadra,
  `ROLLBACK` y no queda nada escrito.

Otros flags: `OUT=<archivo>` · `OVERWRITE=1` · `TABLES=a,b` (solo esas de
`public`).

`auth/restore-auth.sql` (dentro del backup) es la misma mecánica solo para las
cuentas, por si se necesitan aparte.

Ensayo del 2026-09-13 en un contenedor desechable de
`supabase/postgres:17.6.1.159`, con las migraciones del repo aplicadas y como
rol `postgres`: 9 tablas centrales (users, matches, pollas,
polla_participants, predictions y cuatro de Casa), 19.626 filas en 2 s, con
los triggers de lock presentes; la suma de `points_earned` (34.223) y de
`total_points` coincide con el backup.

### 3. Storage

```bash
# Apunta .env al Supabase LOCAL (NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321).
STORAGE_ONLY=1 npx tsx scripts/restore-backup.ts backups/2026-09-13-12-01            # dry run
STORAGE_ONLY=1 CONFIRM=RESTAURAR npx tsx scripts/restore-backup.ts backups/2026-09-13-12-01
```

Guardas de `restore-backup.ts`:

- Sin `CONFIRM=RESTAURAR` es **dry run**.
- **Solo escribe en `localhost` / `127.0.0.1` / `::1`.** Para un host remoto
  hay que nombrarlo exacto: `ALLOW_REMOTE_TARGET=<ref>` (o el hostname
  completo si no es `*.supabase.co`). Un `.env` apuntando a prod no alcanza.
  En dry run solo avisa.
- Si el destino ya tiene filas, aborta (salvo `ALLOW_NONEMPTY=1`).
- Rechaza carpetas `.partial`.
- `TABLES=a,b,c` · `SKIP_STORAGE=1` · `STORAGE_ONLY=1`.

> 🚨 **Regla del repo:** los `predictions` son datos sagrados y no se tocan
> sin orden explícita del owner. Correr el SQL de restore o
> `CONFIRM=RESTAURAR` contra una base con datos vivos *es* tocarlos: solo
> contra Supabase local, o con orden explícita.

### 4. Comprobar

Abre `RESUMEN.md` del backup y contrasta dos o tres tablas finales de
pollas contra lo que muestra la app, y los montos de 2-3 pollas Casa con
`casa_polla_pot`. Si coinciden, la restauración quedó bien.

### 5. Volver a abrir la app

El modo cierre se controla desde **un solo lugar**:
`CREATABLE_TOURNAMENT_SLUGS` en `lib/tournaments.ts`. Con la lista vacía la
app está cerrada (banner + creación bloqueada). Agrégale el slug del torneo
que vuelva y se reabre todo solo — ver `lib/closure.ts`. Suma el slug también
a `SYNCABLE_TOURNAMENT_SLUGS` para que los partidos vuelvan a sincronizarse.

---

## Cada cuánto

Con la app en operación (Casa), un backup es útil solo si es reciente. Hasta
que exista el ejecutor automático del DGX, saca uno:

- antes de cualquier cambio de infraestructura (transferencia de organización,
  cambio de compute, upgrade de Postgres),
- antes de aplicar migraciones que toquen dinero o pronósticos,
- antes y después de cada cierre de temporada,
- y verifica la copia guardada cada tanto (`verify-backup.ts`): el bit rot
  existe.

Pendiente (fuera de este documento): ejecutor programado en el DGX con copia
cifrada, latido `backup_runs`, alerta de frescura y ensayo semanal de restore.
