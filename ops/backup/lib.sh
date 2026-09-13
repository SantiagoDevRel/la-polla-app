# ops/backup/lib.sh — funciones compartidas por run-backup.sh y verify-snapshots.sh.
# Se carga con `source`; no se ejecuta sola. Sin secretos.

# Prefijos <N> = prioridad syslog que journald entiende en stdout/stderr.
log()      { printf '<6>%s\n' "$*"; }
log_warn() { printf '<4>AVISO: %s\n' "$*"; }
log_err()  { printf '<3>%s\n' "$*" >&2; }

# Carga KEY=VALUE de un archivo privado SIN ejecutarlo (no es `source`).
# Exige: dueño = este usuario, permisos 600/400, directorio 700.
load_env_file() {
  local file="$1" dir mode dmode line key val
  [[ -f "$file" ]] || { log_err "no existe $file"; return 1; }
  dir="$(dirname "$file")"
  [[ "$(stat -c %u "$file")" == "$(id -u)" ]] || { log_err "$file no es de este usuario"; return 1; }
  mode="$(stat -c %a "$file")"
  [[ "$mode" == "600" || "$mode" == "400" ]] || { log_err "$file tiene permisos $mode (debe ser 600)"; return 1; }
  dmode="$(stat -c %a "$dir")"
  [[ "$dmode" == "700" ]] || { log_err "$dir tiene permisos $dmode (debe ser 700)"; return 1; }
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "${line//[[:space:]]/}" || "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^([A-Z_][A-Z0-9_]*)=(.*)$ ]] || { log_err "línea inválida en $file (se omite el contenido)"; return 1; }
    key="${BASH_REMATCH[1]}"
    val="${BASH_REMATCH[2]}"
    if [[ "$val" =~ ^\"(.*)\"$ || "$val" =~ ^\'(.*)\'$ ]]; then val="${BASH_REMATCH[1]}"; fi
    case "$key" in
      NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_BACKUP_PAT|GPG_RECIPIENT|MIN_FREE_GB|MAX_AGE_HOURS)
        export "$key=$val" ;;
      *) log_err "variable no permitida en $file: $key"; return 1 ;;
    esac
  done <"$file"
}

json_str() {
  local s="${1//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/ }"
  s="${s//$'\t'/ }"
  printf '"%s"' "$s"
}

# write_status <archivo> <exit_code> <started_at> <phase> <snapshot> <reason>
# Estado sin datos personales, para que otra máquina (el PC) pueda alertar.
write_status() {
  local file="$1" code="$2" started="$3" phase="$4" snap="$5" reason="$6" tmp free
  mkdir -p "$(dirname "$file")" || return 1
  tmp="$file.tmp.$$"
  free="$(df -PBG "$(dirname "$file")" 2>/dev/null | awk 'NR==2{gsub(/G/,"",$4); print $4}')"
  {
    printf '{'
    printf '"ok":%s,' "$([[ "$code" == "0" ]] && echo true || echo false)"
    printf '"exit_code":%s,' "$code"
    printf '"started_at":%s,' "$(json_str "$started")"
    printf '"finished_at":%s,' "$(json_str "$(date -u +%Y-%m-%dT%H:%M:%SZ)")"
    printf '"phase":%s,' "$(json_str "$phase")"
    printf '"snapshot":%s,' "$(json_str "$snap")"
    printf '"reason":%s,' "$(json_str "$reason")"
    printf '"host":%s,' "$(json_str "$(hostname)")"
    printf '"free_gb":%s' "${free:-null}"
    printf '}\n'
  } >"$tmp" && mv -f -- "$tmp" "$file"
}

# index.tsv (columnas con tab) → formato de `sha256sum -c`.
index_to_sha256sum() {
  awk -F'\t' '!/^#/ && NF >= 2 && $1 ~ /^[0-9a-f]{64}$/ { print $1 "  " $2 }' "$1"
}

stamp_to_epoch() {
  local s="$1"   # 2026-09-13-17-10 (UTC)
  date -u -d "${s:0:10} ${s:11:2}:${s:14:2}:00 UTC" +%s
}

# prune_gfs <dest> <index> <regex de nombre> <dry_run 0|1>
# Solo considera archivos que (a) están en index.tsv, (b) tienen nombre de
# snapshot de este job y (c) existen en <dest>. Nunca toca nada más.
# Conserva la unión de:
#   · todo lo de las últimas 48 h
#   · el más nuevo de cada bloque de 6 h (UTC) de los últimos 7 días
#   · el más nuevo de cada día de los últimos 35 días
#   · el más nuevo de cada semana ISO de las últimas 12 semanas
#   · el más nuevo de cada mes de los últimos 12 meses
#   · siempre los 3 más nuevos
prune_gfs() {
  local dest="$1" index="$2" re="$3" dry="${4:-0}"
  local now file stamp epoch age k6 kd kw km i=0
  local -A keep=() seen6=() seend=() seenw=() seenm=()
  local -a files=() delete=()
  now="${PRUNE_NOW_EPOCH:-$(date -u +%s)}"

  mapfile -t files < <(awk -F'\t' '!/^#/ && NF >= 2 { print $2 }' "$index" | grep -E "$re" | sort -r | uniq)
  for file in "${files[@]}"; do
    [[ -f "$dest/$file" ]] || { log_warn "índice lista $file pero no existe; no se poda"; continue; }
    stamp="${file%%.tar.zst.gpg}"
    epoch="$(stamp_to_epoch "$stamp")" || { log_warn "stamp ilegible: $file"; continue; }
    age=$(( now - epoch ))
    k6="$(date -u -d "@$epoch" +%Y-%m-%d)-$(( 10#$(date -u -d "@$epoch" +%H) / 6 ))"
    kd="$(date -u -d "@$epoch" +%Y-%m-%d)"
    kw="$(date -u -d "@$epoch" +%G-W%V)"
    km="$(date -u -d "@$epoch" +%Y-%m)"
    i=$(( i + 1 ))
    if (( i <= 3 )) || (( age < 48 * 3600 )); then keep[$file]=1; fi
    if (( age < 7 * 86400 )) && [[ -z "${seen6[$k6]:-}" ]]; then seen6[$k6]=1; keep[$file]=1; fi
    if (( age < 35 * 86400 )) && [[ -z "${seend[$kd]:-}" ]]; then seend[$kd]=1; keep[$file]=1; fi
    if (( age < 84 * 86400 )) && [[ -z "${seenw[$kw]:-}" ]]; then seenw[$kw]=1; keep[$file]=1; fi
    if (( age < 366 * 86400 )) && [[ -z "${seenm[$km]:-}" ]]; then seenm[$km]=1; keep[$file]=1; fi
    [[ -n "${keep[$file]:-}" ]] || delete+=("$file")
  done

  log "poda GFS: ${#files[@]} snapshots en el índice · conservar $(( ${#files[@]} - ${#delete[@]} )) · podar ${#delete[@]}"
  (( ${#delete[@]} > 0 )) || return 0
  if [[ "$dry" == "1" ]]; then
    for file in "${delete[@]}"; do log "  [dry-run] podaría $file"; done
    return 0
  fi

  local tmp="$index.tmp.$$" pattern
  pattern="$(printf '%s\n' "${delete[@]}")"
  awk -F'\t' -v del="$pattern" 'BEGIN { n = split(del, d, "\n"); for (j = 1; j <= n; j++) drop[d[j]] = 1 }
       /^#/ || !($2 in drop) { print }' "$index" >"$tmp"
  for file in "${delete[@]}"; do
    [[ "$file" =~ $re && "$file" != */* ]] || { rm -f -- "$tmp"; log_err "nombre inesperado en la poda: $file"; return 1; }
  done
  mv -f -- "$tmp" "$index"
  for file in "${delete[@]}"; do
    chmod u+w -- "$dest/$file" 2>/dev/null || true
    rm -f -- "$dest/$file"
    printf '%s\tpodado\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$file" >>"$dest/prune.log"
    log "  podado $file"
  done
}
