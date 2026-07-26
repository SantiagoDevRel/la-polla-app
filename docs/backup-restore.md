# Backup y restore de La Polla

Cómo sacar una copia completa de la app —datos, cuentas, comprobantes,
esquema— y cómo devolverla a un proyecto Supabase el día que se reabra.

Nació del cierre de temporada post-Mundial 2026 (2026-07-26). Con la app
dormida hay dos riesgos reales:

- **Supabase pausa los proyectos free inactivos.** Un proyecto pausado se
  puede restaurar, pero es una dependencia de un tercero sobre datos que no
  se pueden volver a generar: los pronósticos de 294 personas.
- **El plan free no tiene backups automáticos** (eso es Pro). Si el
  proyecto se pierde, se perdió.

Por eso el backup vive **fuera** de Supabase: en el disco y en el DGX.

---

## Sacar un backup

```bash
npx tsx scripts/export-backup.ts
```

Escribe `backups/<fecha-hora>/`. Es **solo lectura**: no toca ni una fila.
Tarda ~2-3 minutos (la mayor parte es bajar los comprobantes de pago).

Variables (todas de `.env`):

| Env | Para qué |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | requerido |
| `SUPABASE_SERVICE_ROLE_KEY` | requerido — lee todo, bypass RLS |
| `SUPABASE_30_DAYS` | opcional pero **muy recomendado**: PAT de la Management API. Con él el dump de `auth` es completo (todas las columnas) y sale el SQL de restore de cuentas. Sin él, `auth` queda reducido a lo que expone la admin API y **no se pueden recrear las cuentas con su mismo uuid**. |

Flags: `BACKUP_DIR=<path>` · `SKIP_STORAGE=1` · `SKIP_PII=1`.

### Qué queda adentro

```
backups/2026-07-26-21-17/
├── README.md                  qué es esto + aviso de datos personales
├── RESUMEN.md                 los números en texto plano: totales y la
│                              tabla final de CADA polla. Se lee sin DB.
├── _manifest.json             filas + sha256 por tabla, PKs, orden de
│                              restore, migraciones aplicadas
├── tables/*.json              una tabla de `public` por archivo
├── auth/
│   ├── users.full.json        auth.users completo
│   ├── identities.full.json   auth.identities completo
│   └── restore-auth.sql       INSERTs listos, idempotentes
├── storage/<bucket>/…         comprobantes de pago y de premio
└── schema/migrations/*.sql    las migraciones = definición del esquema
```

Snapshot del 2026-07-26: **38.061 filas · 36 tablas · 294 cuentas · 117
archivos · 33 MB**.

### ⚠️ Esto tiene datos personales

Teléfonos, emails, hashes de contraseña y comprobantes de pago de gente
real. El repo de la app es **público (MIT)**:

- `backups/` está en `.gitignore`. **Nunca** lo saques de ahí.
- No lo subas a un Drive compartido ni lo pases por chat/Slack/email.
- Si lo movés, que sea a un disco o una máquina tuya.
- Habeas Data (Ley 1581): esta copia es un tratamiento de datos. Guardala
  con la misma seriedad que la DB.

---

## Verificar que el backup sirve

Un backup sin verificar es una promesa, no un respaldo.

```bash
npx tsx scripts/verify-backup.ts                        # el más nuevo
npx tsx scripts/verify-backup.ts backups/2026-07-26-21-17
ONLINE=1 npx tsx scripts/verify-backup.ts               # + compara contra la DB viva
```

Corre **offline**: chequea que cada archivo exista, que su sha256 coincida
con el manifiesto y que traiga las filas que dice traer. Sale con código 1
si algo no cuadra, así que se puede encadenar. Vale la pena correrlo cada
tanto sobre la copia guardada — el bit rot existe.

---

## Guardar una copia afuera

El backup no sirve de nada si vive solo en el mismo disco. Copialo a otra
máquina (ej. un server propio por ssh):

```bash
cd backups
tar -cf - 2026-07-26-21-17 | ssh $HOST 'mkdir -p ~/apps/la-polla-backup && tar -xf - -C ~/apps/la-polla-backup'
```

Y verificá la transferencia comparando huellas (ojo con el locale: usá
`LC_ALL=C sort` de los dos lados o vas a ver "diferencias" que son solo
orden):

```bash
cd backups/2026-07-26-21-17
find . -type f | xargs sha256sum | sed -E 's/^([0-9a-f]+) [ *](.*)$/\1  \2/' | LC_ALL=C sort > /tmp/l.txt
ssh $HOST 'cd ~/apps/la-polla-backup/2026-07-26-21-17 && find . -type f | xargs sha256sum' | LC_ALL=C sort > /tmp/r.txt
diff /tmp/l.txt /tmp/r.txt && echo "idénticos"
```

---

## Reabrir: restaurar en un proyecto Supabase

Orden obligatorio. Saltarse un paso deja FKs colgando.

### 1. Proyecto destino con el esquema puesto

Proyecto Supabase nuevo (o el mismo despausado). Aplicá **en orden** las
migraciones de `schema/migrations/` del backup. Son la definición completa
del esquema: tablas, RLS, triggers, RPCs.

### 2. Las cuentas primero

Todo cuelga de los uuid de `auth.users`. La admin API **no** deja elegir el
id al crear un usuario, así que las cuentas van por SQL:

```
SQL editor de Supabase  ←  auth/restore-auth.sql
```

Es idempotente (`ON CONFLICT DO NOTHING`), se puede correr de nuevo sin
miedo. Restaura `auth.users` y `auth.identities` con los mismos uuid, así
que cada persona vuelve a entrar **con su mismo teléfono** y encuentra su
historial.

### 3. Los datos

```bash
# 1) Apuntá .env al proyecto DESTINO (leelo dos veces).
# 2) Dry run — no escribe nada:
npx tsx scripts/restore-backup.ts backups/2026-07-26-21-17

# 3) De verdad:
CONFIRM=RESTAURAR npx tsx scripts/restore-backup.ts backups/2026-07-26-21-17
```

Restaura en orden FK-safe (derivado del grafo real de FKs y guardado en el
manifiesto), en lotes de 500, con upsert idempotente sobre la PK de cada
tabla. Al final verifica que los counts del destino igualen al manifiesto.

Guardas incorporadas:

- Sin `CONFIRM=RESTAURAR` es **dry run**.
- Si el destino ya tiene filas, **aborta** (salvo `ALLOW_NONEMPTY=1`). Un
  destino con datos casi siempre significa que apuntaste al proyecto
  equivocado.
- `TABLES=a,b,c` para restaurar solo algunas · `SKIP_STORAGE=1` para no
  volver a subir los comprobantes.

> 🚨 **Regla del repo:** los `predictions` son datos sagrados y no se tocan
> sin orden explícita del owner. Correr el restore con `CONFIRM=RESTAURAR`
> *es* esa orden — no lo dispares "para probar" contra una DB con datos
> vivos.

### 4. Comprobar

Abrí `RESUMEN.md` del backup y contrastá dos o tres tablas finales de
pollas contra lo que muestra la app. Si los puntos coinciden, la
restauración quedó bien.

### 5. Volver a abrir la app

El modo cierre se controla desde **un solo lugar**:
`CREATABLE_TOURNAMENT_SLUGS` en `lib/tournaments.ts`. Con la lista vacía la
app está cerrada (banner + `/pollas/crear` bloqueado + POST rechazado).
Agregale el slug del torneo que vuelva y se reabre todo solo — ver
`lib/closure.ts`. Acordate de sumar el slug también a
`SYNCABLE_TOURNAMENT_SLUGS` para que los partidos vuelvan a sincronizarse.

---

## Cada cuánto

Con la app cerrada y sin partidos, los datos no cambian: el backup del
cierre alcanza. Vale la pena sacar uno nuevo si:

- se reabre la temporada (backup antes y después),
- Supabase avisa que va a pausar el proyecto,
- pasó un año y querés confirmar que la copia sigue sana
  (`verify-backup.ts`).
