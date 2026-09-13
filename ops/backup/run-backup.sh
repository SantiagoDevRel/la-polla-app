#!/usr/bin/env bash
# ops/backup/run-backup.sh — backup cifrado de La Polla, pensado para el DGX.
#
#   export (scripts/export-backup.ts)  → tmpfs, nunca a disco sin cifrar
#   verify (scripts/verify-backup.ts)  → sha256 de cada tabla y archivo
#   tar | zstd -19 | gpg --encrypt      → snapshots/<stamp>.tar.zst.gpg
#   sha256 + conteos                    → snapshots/index.tsv
#   poda GFS                            → solo snapshots que este job creó
#
# Sale con código ≠ 0 ante cualquier fallo, así el timer queda "failed" y se
# ve en `systemctl --user --failed` y en status/backup-last.json.
#
# Configuración (nada de esto vive en el repo, que es público):
#   ~/.config/la-polla-backup/env   chmod 600, dueño = este usuario
#     NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
#     SUPABASE_SERVICE_ROLE_KEY=<sb_secret_… dedicada al backup>
#     SUPABASE_BACKUP_PAT=<token de la Management API, scope proyecto, Database: Read>
#     GPG_RECIPIENT=<fingerprint de 40 hex; en este llavero solo la PÚBLICA>
#
# Overrides opcionales por entorno: LA_POLLA_BACKUP_ENV, BACKUP_HOME,
# MIN_FREE_GB (50), PRUNE=0 (no poda), PRUNE_DRY_RUN=1, ALLOW_DEGRADED=1.
set -Eeuo pipefail
umask 077
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${LA_POLLA_BACKUP_ENV:-$HOME/.config/la-polla-backup/env}"
BACKUP_HOME="${BACKUP_HOME:-$HOME/apps/la-polla-backup}"
DEST="$BACKUP_HOME/snapshots"
INDEX="$DEST/index.tsv"
STATUS_DIR="$BACKUP_HOME/status"
MIN_FREE_GB="${MIN_FREE_GB:-50}"
TSX="$RUNNER_DIR/ops/backup/tools/node_modules/.bin/tsx"
SNAP_RE='^[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{2}\.tar\.zst\.gpg$'
INDEX_HEADER=$'#sha256\tfile\tbytes\tgenerated_at\ttables\trows\tauth_users\tauth_identities\tstorage_files\tstorage_bytes\tauth_mode\tstorage_check\ttoken_source\tschema_live_errors\trunner_commit'

# shellcheck source=ops/backup/lib.sh
source "$SCRIPT_DIR/lib.sh"

STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
WORK=""
SNAPSHOT_NAME=""
PHASE="init"
EXIT_REASON=""

on_exit() {
  local code=$?
  if [[ -n "$WORK" && -d "$WORK" ]]; then
    # Solo lo que este job creó en tmpfs (mktemp de abajo). Datos personales
    # sin cifrar: no pueden sobrevivir a la corrida.
    rm -rf -- "$WORK"
  fi
  if [[ -n "${TMP_OUT:-}" && -f "$TMP_OUT" ]]; then
    rm -f -- "$TMP_OUT"
  fi
  if [[ $code -ne 0 && -z "$EXIT_REASON" ]]; then EXIT_REASON="falló en la fase: $PHASE"; fi
  write_status "$STATUS_DIR/backup-last.json" "$code" "$STARTED_AT" "$PHASE" "$SNAPSHOT_NAME" "$EXIT_REASON" || true
  if [[ $code -ne 0 ]]; then
    log_err "BACKUP FALLÓ (código $code): $EXIT_REASON"
  else
    log "Backup OK: $SNAPSHOT_NAME"
  fi
  exit "$code"
}
trap on_exit EXIT
trap 'EXIT_REASON="interrumpido por señal"; exit 130' INT TERM

fail() { EXIT_REASON="$1"; exit "${2:-1}"; }

# ─── 0) Preflight ───
PHASE="preflight"
for cmd in node gpg zstd tar flock sha256sum findmnt df awk date; do
  command -v "$cmd" >/dev/null 2>&1 || fail "falta el comando '$cmd'"
done
[[ -x "$TSX" ]] || fail "falta tsx fijado en ops/backup/tools (npm ci --ignore-scripts --prefix ops/backup/tools)"
[[ -d "$RUNNER_DIR/node_modules/@supabase/supabase-js" ]] || fail "faltan dependencias del repo (npm ci --ignore-scripts en $RUNNER_DIR)"

load_env_file "$ENV_FILE" || fail "archivo de entorno inválido: $ENV_FILE"
for v in NEXT_PUBLIC_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SUPABASE_BACKUP_PAT GPG_RECIPIENT; do
  [[ -n "${!v:-}" ]] || fail "falta $v en $ENV_FILE"
done
[[ "$GPG_RECIPIENT" =~ ^[0-9A-F]{40}$ ]] || fail "GPG_RECIPIENT debe ser un fingerprint de 40 hex en mayúsculas"
# Sin `| grep -q` con pipefail: grep corta temprano, gpg recibe SIGPIPE y el
# pipeline "falla" aunque la llave esté. Se captura primero.
KEYS_COLONS="$(gpg --batch --list-keys --with-colons "$GPG_RECIPIENT" 2>/dev/null || true)"
grep -q "^fpr:::::::::$GPG_RECIPIENT:" <<<"$KEYS_COLONS" \
  || fail "la llave pública $GPG_RECIPIENT no está en el llavero de gpg"
if gpg --batch --list-secret-keys --with-colons "$GPG_RECIPIENT" 2>/dev/null | awk -F: '$1=="sec"{f=1} END{exit !f}'; then
  fail "la llave PRIVADA $GPG_RECIPIENT está en este llavero: aquí solo debe vivir la pública"
fi

# Solo el token dedicado. Si otro token del entorno ganara el orden de
# resolveManagementToken, el backup correría con permisos que no son suyos.
unset SUPABASE_ACCESS_TOKEN SUPABASE_30_DAYS || true
export DOTENV_CONFIG_PATH=/dev/null DOTENV_CONFIG_QUIET=true

[[ -n "${XDG_RUNTIME_DIR:-}" && -d "$XDG_RUNTIME_DIR" ]] || fail "XDG_RUNTIME_DIR no existe (¿Linger?)"
[[ "$(findmnt -n -o FSTYPE --target "$XDG_RUNTIME_DIR")" == "tmpfs" ]] || fail "$XDG_RUNTIME_DIR no es tmpfs: no se exporta a disco sin cifrar"

mkdir -p "$DEST" "$STATUS_DIR"
chmod 700 "$BACKUP_HOME" "$DEST" "$STATUS_DIR"

# ─── 1) Lock ───
PHASE="lock"
exec 9>"$XDG_RUNTIME_DIR/la-polla-backup.lock"
flock -n 9 || fail "otra corrida del backup (o de la poda) tiene el lock" 75

RUNNER_COMMIT="$(git -C "$RUNNER_DIR" rev-parse --short=12 HEAD 2>/dev/null || echo unknown)"
log "Runner $RUNNER_COMMIT · destino $DEST"

free_tmp_mb=$(df -Pm "$XDG_RUNTIME_DIR" | awk 'NR==2{print $4}')
(( free_tmp_mb >= 2048 )) || fail "tmpfs con solo ${free_tmp_mb} MB libres (mínimo 2048)"

# ─── 2) Export a tmpfs ───
PHASE="export"
WORK="$(mktemp -d "$XDG_RUNTIME_DIR/la-polla-backup.XXXXXXXX")"
mkdir -p "$WORK/out"
(
  cd "$WORK"
  BACKUP_DIR="$WORK/out" "$TSX" "$RUNNER_DIR/scripts/export-backup.ts"
) || fail "export-backup.ts salió con error"

mapfile -t done_dirs < <(find "$WORK/out" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{2}$' || true)
[[ ${#done_dirs[@]} -eq 1 ]] || fail "se esperaba 1 carpeta terminada del export, hay ${#done_dirs[@]}"
if [[ -n "$(find "$WORK/out" -mindepth 1 -maxdepth 1 -name '*.partial')" ]]; then
  fail "el export dejó una carpeta .partial"
fi
STAMP="${done_dirs[0]}"
SNAP_DIR="$WORK/out/$STAMP"

# ─── 3) Verify ───
PHASE="verify"
VERIFY_JSON="$WORK/verify.json"
if ! (cd "$WORK" && "$TSX" "$RUNNER_DIR/scripts/verify-backup.ts" "$SNAP_DIR" --json >"$VERIFY_JSON"); then
  node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.error("verify: "+r.problems.length+" problema(s)");for(const p of r.problems.slice(0,10))console.error(" - "+String(p).slice(0,200));' "$VERIFY_JSON" 2>&1 || true
  fail "verify-backup.ts rechazó el backup"
fi
node -e '
const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
if (!r.ok) process.exit(1);
console.log(`verify OK · ${r.tables} tablas · ${r.rows} filas · auth ${r.authMode} ${r.authUsers} usuarios/${r.authIdentities} identities · storage ${r.storageFiles} archivos ${(r.storageBytes/1048576).toFixed(1)} MB · ${r.filesVerified} archivos con sha256 · ${r.warnings.length} aviso(s)`);
' "$VERIFY_JSON" || fail "verify no devolvió ok=true"

# Conteos del manifiesto para el índice (sin datos personales).
META="$(node -e '
const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const t = m.totals || {};
const out = [m.generatedAt, t.tables, t.rows, t.authUsers ?? m.auth?.users, t.authIdentities ?? m.auth?.identities,
  t.storageFiles, t.storageBytes, m.auth?.mode, m.storage?.crossCheck, m.flags?.managementTokenSource,
  (m.schemaLive?.errors || []).length];
process.stdout.write(out.map((v) => String(v ?? "").replace(/[\t\n]/g, " ")).join("\t"));
' "$SNAP_DIR/_manifest.json")" || fail "no pude leer _manifest.json"
IFS=$'\t' read -r GEN_AT N_TABLES N_ROWS N_USERS N_IDENT N_FILES N_BYTES AUTH_MODE STORAGE_CHECK TOKEN_SOURCE SCHEMA_ERRORS <<<"$META"
log "manifiesto · generado $GEN_AT · auth=$AUTH_MODE · storage=$STORAGE_CHECK · token=$TOKEN_SOURCE · schema/live errores=$SCHEMA_ERRORS"

DEGRADED=""
[[ "$AUTH_MODE" == "full" ]] || DEGRADED+="auth=$AUTH_MODE "
[[ "$STORAGE_CHECK" == "storage.objects" ]] || DEGRADED+="storage=$STORAGE_CHECK "
[[ "$TOKEN_SOURCE" == "SUPABASE_BACKUP_PAT" ]] || DEGRADED+="token=$TOKEN_SOURCE "
[[ "$SCHEMA_ERRORS" == "0" ]] || DEGRADED+="schema_live_errors=$SCHEMA_ERRORS "

# ─── 4) Cifrar ───
PHASE="encrypt"
SNAPSHOT_NAME="$STAMP.tar.zst.gpg"
FINAL="$DEST/$SNAPSHOT_NAME"
[[ ! -e "$FINAL" ]] || fail "ya existe $FINAL"
TMP_OUT="$DEST/.$SNAPSHOT_NAME.inprogress"
tar -C "$WORK/out" --owner=0 --group=0 --numeric-owner -cf - "$STAMP" \
  | zstd -19 -T0 -q -c \
  | gpg --batch --yes --quiet --no-auto-key-retrieve --trust-model always \
        --compress-algo none --encrypt --recipient "$GPG_RECIPIENT" --output "$TMP_OUT" \
  || fail "tar | zstd | gpg falló"
# Sanidad: el paquete va cifrado a la subllave de cifrado de GPG_RECIPIENT.
ENC_SUBKEY="$(gpg --batch --with-colons --list-keys "$GPG_RECIPIENT" | awk -F: '$1=="sub" && $12 ~ /e/ {print $5; exit}')"
[[ -n "$ENC_SUBKEY" ]] || fail "la llave $GPG_RECIPIENT no tiene subllave de cifrado"
# --list-packets sale con 2 sin llave privada (esperado aquí): capturar, no encadenar.
PACKETS="$(gpg --batch --list-packets "$TMP_OUT" 2>&1 || true)"
grep -q "keyid $ENC_SUBKEY" <<<"$PACKETS" || fail "el snapshot no quedó cifrado a $ENC_SUBKEY"
sync -f "$TMP_OUT" 2>/dev/null || sync
SNAP_SHA="$(sha256sum "$TMP_OUT" | awk '{print $1}')"
SNAP_BYTES="$(stat -c %s "$TMP_OUT")"
mv -- "$TMP_OUT" "$FINAL"
TMP_OUT=""
chmod 400 "$FINAL"

# ─── 5) Índice ───
PHASE="index"
if [[ ! -f "$INDEX" ]]; then printf '%s\n' "$INDEX_HEADER" >"$INDEX"; fi
printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
  "$SNAP_SHA" "$SNAPSHOT_NAME" "$SNAP_BYTES" "$GEN_AT" "$N_TABLES" "$N_ROWS" "$N_USERS" "$N_IDENT" \
  "$N_FILES" "$N_BYTES" "$AUTH_MODE" "$STORAGE_CHECK" "$TOKEN_SOURCE" "$SCHEMA_ERRORS" "$RUNNER_COMMIT" >>"$INDEX"
sync -f "$INDEX" 2>/dev/null || true
(cd "$DEST" && index_to_sha256sum "$INDEX" | grep -F "  $SNAPSHOT_NAME" | sha256sum -c --strict --quiet -) \
  || fail "el sha256 recién escrito no verifica"
log "snapshot $SNAPSHOT_NAME · $(( SNAP_BYTES / 1024 )) KiB · sha256 $SNAP_SHA"

# Borrar el export en claro YA, no al final de la poda.
rm -rf -- "$WORK"
WORK=""
[[ -z "$(find "$XDG_RUNTIME_DIR" -maxdepth 1 -name 'la-polla-backup.*' -type d 2>/dev/null)" ]] \
  || log_warn "quedan carpetas la-polla-backup.* en $XDG_RUNTIME_DIR de corridas anteriores"

# ─── 6) Poda GFS ───
PHASE="prune"
if [[ "${PRUNE:-1}" == "1" ]]; then
  prune_gfs "$DEST" "$INDEX" "$SNAP_RE" "${PRUNE_DRY_RUN:-0}" || fail "la poda falló"
fi

# ─── 7) Espacio y calidad ───
PHASE="checks"
free_gb=$(df -PBG "$DEST" | awk 'NR==2{gsub(/G/,"",$4); print $4}')
log "espacio libre en $DEST: ${free_gb} GB"
if (( free_gb < MIN_FREE_GB )); then
  fail "ALERTA: quedan ${free_gb} GB libres (< ${MIN_FREE_GB} GB). El snapshot sí se guardó." 3
fi
if [[ -n "$DEGRADED" && "${ALLOW_DEGRADED:-0}" != "1" ]]; then
  fail "snapshot guardado pero DEGRADADO: ${DEGRADED% }" 4
fi
PHASE="done"
exit 0
