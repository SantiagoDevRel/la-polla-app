#!/usr/bin/env bash
# ops/backup/verify-snapshots.sh — integridad diaria de los snapshots cifrados.
#
#   · sha256sum -c sobre index.tsv (todos los snapshots listados)
#   · cada snapshot sigue cifrado a la subllave de GPG_RECIPIENT
#   · ningún snapshot huérfano (en disco pero fuera del índice)
#   · el más nuevo no tiene más de MAX_AGE_HOURS (8 por defecto)
#   · al terminar (bien o mal) registra la corrida en public.backup_runs
#
# No necesita la llave privada ni internet. Sale ≠ 0 ante cualquier problema.
set -Eeuo pipefail
umask 077
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${LA_POLLA_BACKUP_ENV:-$HOME/.config/la-polla-backup/env}"
BACKUP_HOME="${BACKUP_HOME:-$HOME/apps/la-polla-backup}"
DEST="$BACKUP_HOME/snapshots"
INDEX="$DEST/index.tsv"
STATUS_DIR="$BACKUP_HOME/status"
SNAP_RE='^[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{2}\.tar\.zst\.gpg$'

# shellcheck source=ops/backup/lib.sh
source "$SCRIPT_DIR/lib.sh"

STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
RUNNER_COMMIT="$(git -C "$SCRIPT_DIR/../.." rev-parse --short=12 HEAD 2>/dev/null || echo unknown)"
PHASE="init"
REASON=""
NEWEST=""
on_exit() {
  local code=$?
  if [[ $code -ne 0 && -z "$REASON" ]]; then REASON="falló en la fase: $PHASE"; fi
  # Bitácora en public.backup_runs (kind=verify): /api/cron/backup-freshness
  # avisa si no hay una verificación buena en 30 h. No cambia el código de salida.
  local recorded err_text=""
  if [[ $code -ne 0 ]]; then err_text="fase $PHASE: $REASON"; fi
  recorded="$(record_run --kind=verify --exit-code="$code" --started-at="$STARTED_AT" \
    --snapshot="$NEWEST" --runner-commit="$RUNNER_COMMIT" --error="$err_text")" || recorded="failed_runner"
  if [[ "$recorded" == "ok" || "$recorded" == "dry_run" ]]; then
    log "backup_runs: $recorded"
  else
    log_warn "no se registró la verificación en backup_runs: $recorded"
  fi
  write_status "$STATUS_DIR/verify-last.json" "$code" "$STARTED_AT" "$PHASE" "$NEWEST" "$REASON" "$recorded" || true
  if [[ $code -ne 0 ]]; then log_err "VERIFICACIÓN FALLÓ (código $code): $REASON"; else log "Snapshots íntegros"; fi
  exit "$code"
}
trap on_exit EXIT
fail() { REASON="$1"; exit "${2:-1}"; }

PHASE="preflight"
load_env_file "$ENV_FILE" || fail "archivo de entorno inválido: $ENV_FILE"
[[ "${GPG_RECIPIENT:-}" =~ ^[0-9A-F]{40}$ ]] || fail "GPG_RECIPIENT inválido"
MAX_AGE_HOURS="${MAX_AGE_HOURS:-8}"
[[ -f "$INDEX" ]] || fail "no existe $INDEX"

# Mismo lock que el backup: no leer el índice mientras se poda o se agrega.
PHASE="lock"
exec 9>"${XDG_RUNTIME_DIR:-/tmp}/la-polla-backup.lock"
flock -w 2700 9 || fail "no obtuve el lock en 45 min"

PHASE="sha256"
listed="$(index_to_sha256sum "$INDEX")"
[[ -n "$listed" ]] || fail "index.tsv no lista ningún snapshot"
count="$(printf '%s\n' "$listed" | wc -l)"
(cd "$DEST" && printf '%s\n' "$listed" | sha256sum -c --strict --quiet -) || fail "sha256 no coincide en al menos un snapshot"
log "sha256 OK en $count snapshot(s)"

PHASE="recipient"
ENC_SUBKEY="$(gpg --batch --with-colons --list-keys "$GPG_RECIPIENT" | awk -F: '$1=="sub" && $12 ~ /e/ {print $5; exit}')"
[[ -n "$ENC_SUBKEY" ]] || fail "sin subllave de cifrado para $GPG_RECIPIENT"
while IFS= read -r file; do
  # --list-packets sale con 2 sin llave privada (esperado): capturar, no encadenar con pipefail.
  packets="$(gpg --batch --list-packets "$DEST/$file" 2>&1 || true)"
  grep -q "keyid $ENC_SUBKEY" <<<"$packets" || fail "$file no está cifrado a $ENC_SUBKEY"
done < <(awk -F'\t' '!/^#/ && NF >= 2 { print $2 }' "$INDEX")

PHASE="orphans"
orphans=0
while IFS= read -r file; do
  if ! awk -F'\t' -v f="$file" '!/^#/ && $2 == f { found = 1 } END { exit !found }' "$INDEX"; then
    log_warn "snapshot fuera del índice: $file"
    orphans=$(( orphans + 1 ))
  fi
done < <(find "$DEST" -maxdepth 1 -type f -printf '%f\n' | grep -E "$SNAP_RE" | sort)
(( orphans == 0 )) || fail "$orphans snapshot(s) sin entrada en index.tsv"

PHASE="freshness"
NEWEST="$(awk -F'\t' '!/^#/ && NF >= 2 { print $2 }' "$INDEX" | grep -E "$SNAP_RE" | sort | tail -n 1)"
newest_epoch="$(stamp_to_epoch "${NEWEST%%.tar.zst.gpg}")"
age_h=$(( ( $(date -u +%s) - newest_epoch ) / 3600 ))
log "más nuevo: $NEWEST (hace ${age_h} h, máximo ${MAX_AGE_HOURS} h)"
(( age_h <= MAX_AGE_HOURS )) || fail "el snapshot más nuevo tiene ${age_h} h (> ${MAX_AGE_HOURS} h)"

PHASE="done"
exit 0
