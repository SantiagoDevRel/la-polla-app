#!/usr/bin/env bash
# ops/backup/test-prune.sh — prueba de la poda GFS con archivos falsos.
# No toca snapshots reales: todo pasa en un directorio temporal propio.
#   bash ops/backup/test-prune.sh
set -Eeuo pipefail
export LC_ALL=C
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ops/backup/lib.sh
source "$SCRIPT_DIR/lib.sh"

T="$(mktemp -d)"
trap 'rm -rf -- "$T"' EXIT
DEST="$T/snapshots"; INDEX="$DEST/index.tsv"; mkdir -p "$DEST"
RE='^[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{2}\.tar\.zst\.gpg$'
NOW="$(date -u -d '2026-09-13 17:40:00 UTC' +%s)"
export PRUNE_NOW_EPOCH="$NOW"

pass=0; failn=0
check() { if eval "$2"; then pass=$((pass+1)); else failn=$((failn+1)); echo "FALLA: $1"; fi; }

printf '#sha256\tfile\n' >"$INDEX"
# Un snapshot cada 6 h (05/11/17/23:10 UTC) durante 400 días.
first=$(( NOW - 400 * 86400 ))
start=$(date -u -d "$(date -u -d "@$first" +%Y-%m-%d) 05:10:00 UTC" +%s)
for (( e = start; e <= NOW; e += 6 * 3600 )); do
  f="$(date -u -d "@$e" +%Y-%m-%d-%H-%M).tar.zst.gpg"
  : >"$DEST/$f"
  printf '%064d\t%s\n' 0 "$f" >>"$INDEX"
done
total_before=$(ls "$DEST" | grep -cE "$RE")
# Cosas que la poda NUNCA debe tocar:
: >"$DEST/2024-01-01-00-10.tar.zst.gpg"        # nombre válido pero fuera del índice
: >"$DEST/notas.txt"                           # otro archivo
printf '%064d\t%s\n' 0 "../fuera.tar.zst.gpg" >>"$INDEX"   # entrada maliciosa (no cumple el patrón)

prune_gfs "$DEST" "$INDEX" "$RE" 0 >"$T/log"

check "sigue el archivo fuera del índice" '[[ -f "$DEST/2024-01-01-00-10.tar.zst.gpg" ]]'
check "sigue notas.txt" '[[ -f "$DEST/notas.txt" ]]'
check "sigue la entrada rara del índice" 'grep -q "fuera.tar.zst.gpg" "$INDEX"'

kept=(); while IFS= read -r f; do kept+=("$f"); done < <(awk -F'\t' '!/^#/ && $2 ~ /^[0-9]/ {print $2}' "$INDEX" | sort)
disk=$(ls "$DEST" | grep -E "$RE" | grep -vc '^2024-01-01')
check "índice y disco coinciden" '[[ ${#kept[@]} -eq $disk ]]'
check "se podó algo" '(( disk < total_before ))'

in48=0; days7=(); days35=(); weeks=(); months=(); oldest=0
for f in "${kept[@]}"; do
  e=$(stamp_to_epoch "${f%%.tar.zst.gpg}"); age=$(( NOW - e ))
  if (( age < 48*3600 )); then in48=$((in48+1)); fi
  if (( age >= 366*86400 )); then oldest=$((oldest+1)); fi
done
expected48=$(for (( e = start; e <= NOW; e += 6*3600 )); do if (( NOW - e < 48*3600 )); then echo x; fi; done | wc -l)
check "todo lo de 48 h se conserva ($in48/$expected48)" '[[ $in48 -eq $expected48 ]]'
check "nada de más de 366 días" '[[ $oldest -eq 0 ]]'

uniq_count() { sort | uniq | wc -l; }
d7=$(for f in "${kept[@]}"; do e=$(stamp_to_epoch "${f%%.tar.zst.gpg}"); (( NOW - e < 7*86400 )) && echo "$(date -u -d "@$e" +%Y-%m-%d)-$(( 10#$(date -u -d "@$e" +%H) / 6 ))"; done | uniq_count)
n7=$(for f in "${kept[@]}"; do e=$(stamp_to_epoch "${f%%.tar.zst.gpg}"); (( NOW - e < 7*86400 )) && echo x; done | wc -l)
check "7 días: uno por bloque de 6 h ($n7 archivos, $d7 bloques)" '[[ $n7 -eq $d7 ]]'
d35=$(for f in "${kept[@]}"; do e=$(stamp_to_epoch "${f%%.tar.zst.gpg}"); a=$(( NOW - e )); if (( a >= 7*86400 && a < 35*86400 )); then date -u -d "@$e" +%Y-%m-%d; fi; done)
check "35 días: máximo uno por día fuera de la semana" '[[ -z "$(printf "%s\n" "$d35" | sed "/^$/d" | sort | uniq -d)" ]]'
days_cov=$(for f in "${kept[@]}"; do e=$(stamp_to_epoch "${f%%.tar.zst.gpg}"); (( NOW - e < 35*86400 )) && date -u -d "@$e" +%Y-%m-%d; done | uniq_count)
check "35 días: hay snapshot en cada día ($days_cov)" '(( days_cov >= 35 ))'
mcov=$(for f in "${kept[@]}"; do e=$(stamp_to_epoch "${f%%.tar.zst.gpg}"); date -u -d "@$e" +%Y-%m; done | uniq_count)
check "12 meses cubiertos ($mcov)" '(( mcov >= 12 ))'

# Segunda pasada: idempotente.
before=${#kept[@]}
prune_gfs "$DEST" "$INDEX" "$RE" 0 >/dev/null
after=$(awk -F'\t' '!/^#/ && $2 ~ /^[0-9]/' "$INDEX" | wc -l)
check "la poda es idempotente ($before → $after)" '[[ $before -eq $after ]]'

echo "total=$total_before conservados=${#kept[@]} · $pass OK, $failn fallas"
(( failn == 0 ))
