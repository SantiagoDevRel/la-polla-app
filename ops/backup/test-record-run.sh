#!/usr/bin/env bash
# ops/backup/test-record-run.sh — prueba del registro en public.backup_runs.
#
#   bash ops/backup/test-record-run.sh
#       Sin red: payload (RECORD_RUN_DRY=1), validaciones, URL rechazada, red
#       caída, y que un registro fallido NO cambie el código de salida.
#
#   RECORD_RUN_TEST_URL=http://127.0.0.1:54321 \
#   RECORD_RUN_TEST_SERVICE_KEY=<service key LOCAL> RECORD_RUN_TEST_ANON_KEY=<anon key LOCAL> \
#   bash ops/backup/test-record-run.sh
#       Además inserta de verdad contra un Supabase LOCAL con la migración 117:
#       service_role inserta, anon es rechazado y el trap real de run-backup.sh
#       registra su fallo. Solo acepta 127.0.0.1/localhost: nunca escribe en prod.
#       Deja filas de prueba (runner_commit 0000000 / started_at 2000-01-01, y una
#       kind=backup de preflight); se borran como postgres en el contenedor local.
#
# Las llaves se leen del entorno; el script nunca las imprime.
set -Eeuo pipefail
export LC_ALL=C
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ops/backup/lib.sh
source "$SCRIPT_DIR/lib.sh"

# Que nada del entorno del que llama (p. ej. un .env de prod) se cuele.
unset NEXT_PUBLIC_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY RECORD_RUN_DRY || true

T="$(mktemp -d)"
trap 'kill "${fake_pid:-}" 2>/dev/null; rm -rf -- "$T"' EXIT
pass=0; failn=0
check() { if eval "$2"; then pass=$((pass+1)); else failn=$((failn+1)); echo "FALLA: $1"; fi; }
jget() { node -e 'const o=JSON.parse(require("fs").readFileSync(0,"utf8")); const v=o[process.argv[1]]; process.stdout.write(v===null?"null":String(v));' "$1"; }

# ── 1) Payload en seco ──
out="$(RECORD_RUN_DRY=1 record_run --kind=backup --exit-code=0 --started-at=2026-09-13T17:10:00Z \
  --snapshot=2026-09-13-17-10.tar.zst.gpg --bytes=15000000 --tables=58 --rows=40452 \
  --auth-users=297 --storage-objects=119 --runner-commit=e88580a1b2c3 --error="ignorado" 2>"$T/p1.json")"
check "dry ok devuelve dry_run" '[[ "$out" == "dry_run" ]]'
check "dry ok: status=ok" '[[ "$(jget status <"$T/p1.json")" == "ok" ]]'
check "dry ok: error=null aunque se pase" '[[ "$(jget error <"$T/p1.json")" == "null" ]]'
check "dry ok: conteos numéricos" '[[ "$(jget rows <"$T/p1.json")" == "40452" && "$(jget storage_objects <"$T/p1.json")" == "119" ]]'
check "dry ok: snapshot y commit" '[[ "$(jget snapshot_name <"$T/p1.json")" == "2026-09-13-17-10.tar.zst.gpg" && "$(jget runner_commit <"$T/p1.json")" == "e88580a1b2c3" ]]'

long="$(printf 'x%.0s' {1..600})"
out="$(RECORD_RUN_DRY=1 record_run --kind=verify --exit-code=4 --started-at=nope \
  --snapshot='+573001234567.json' --bytes=-5 --tables=abc --runner-commit='Juan Pérez' \
  --error="$(printf 'línea1\nlínea2\t%s' "$long")" 2>"$T/p2.json")"
check "dry failed devuelve dry_run" '[[ "$out" == "dry_run" ]]'
check "dry failed: status=failed" '[[ "$(jget status <"$T/p2.json")" == "failed" ]]'
err_ok="$(jget error <"$T/p2.json" | node -e '
  const s = require("fs").readFileSync(0, "utf8");
  const clean = !Array.from(s).some((ch) => ch.codePointAt(0) < 32);
  process.stdout.write(Array.from(s).length === 400 && clean && s.startsWith("línea1 línea2 x") ? "yes" : "no");
')"
check "dry failed: error sin saltos, cortado en 400 caracteres" '[[ "$err_ok" == "yes" ]]'
check "dry failed: snapshot con forma rara → null" '[[ "$(jget snapshot_name <"$T/p2.json")" == "null" ]]'
check "dry failed: números inválidos → null" '[[ "$(jget bytes <"$T/p2.json")" == "null" && "$(jget tables <"$T/p2.json")" == "null" ]]'
check "dry failed: commit inválido → unknown" '[[ "$(jget runner_commit <"$T/p2.json")" == "unknown" ]]'

out="$(RECORD_RUN_DRY=1 record_run --kind=verify --exit-code=1 --error= 2>"$T/p3.json")"
check "error vacío en fallo → texto con el código" '[[ "$(jget error <"$T/p3.json")" == "código de salida 1" ]]'

check "kind inválido" '[[ "$(record_run --kind=restore --exit-code=0)" == "failed_invalid_args" ]]'
check "exit-code inválido" '[[ "$(record_run --kind=backup --exit-code=x)" == "failed_invalid_args" ]]'
check "opción desconocida" '[[ "$(record_run --kind=backup --exit-code=0 --token=abc)" == "failed_invalid_args" ]]'

# ── 2) Sin red ──
check "sin credenciales → skipped" '[[ "$(record_run --kind=backup --exit-code=0)" == "skipped_no_credentials" ]]'
check "http a host remoto → rechazado sin enviar" \
  '[[ "$(NEXT_PUBLIC_SUPABASE_URL=http://example.com SUPABASE_SERVICE_ROLE_KEY=k record_run --kind=backup --exit-code=0)" == "failed_invalid_url" ]]'
check "URL con usuario → rechazada" \
  '[[ "$(NEXT_PUBLIC_SUPABASE_URL=https://u:p@example.com SUPABASE_SERVICE_ROLE_KEY=k record_run --kind=backup --exit-code=0)" == "failed_invalid_url" ]]'
t0=$(date +%s)
out="$(NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9 SUPABASE_SERVICE_ROLE_KEY=k record_run --kind=backup --exit-code=0)"
check "red caída → failed_network" '[[ "$out" == "failed_network" ]]'
check "red caída → rápido (< 40 s)" '(( $(date +%s) - t0 < 40 ))'

# Cola en disco: lo que no se pudo enviar se reenvía en la próxima corrida.
SP="$T/spool"
out="$(NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9 SUPABASE_SERVICE_ROLE_KEY=k RECORD_RUN_SPOOL_DIR="$SP" \
  record_run --kind=backup --exit-code=0 --rows=111)"
check "cola: red caída → failed_network" '[[ "$out" == "failed_network" ]]'
check "cola: la fila queda pendiente" '(( $(ls "$SP" | wc -l) == 1 ))'

# Servidor falso en 127.0.0.1: responde con el status de $T/fake-status y
# anota cada cuerpo recibido.
cat >"$T/fake-server.mjs" <<'EOF2'
import { createServer } from "node:http";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const [dir] = process.argv.slice(2);
const srv = createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => {
    appendFileSync(`${dir}/fake-bodies`, `${b}\n`);
    res.writeHead(Number(readFileSync(`${dir}/fake-status`, "utf8")), { "Content-Type": "application/json" });
    res.end("{}");
  });
});
srv.listen(0, "127.0.0.1", () => writeFileSync(`${dir}/fake-port`, String(srv.address().port)));
EOF2
echo 201 >"$T/fake-status"
node "$T/fake-server.mjs" "$T" & fake_pid=$!
for _ in $(seq 50); do [[ -s "$T/fake-port" ]] && break; sleep 0.1; done
FAKE_URL="http://127.0.0.1:$(cat "$T/fake-port")"
out="$(NEXT_PUBLIC_SUPABASE_URL="$FAKE_URL" SUPABASE_SERVICE_ROLE_KEY=k RECORD_RUN_SPOOL_DIR="$SP" \
  record_run --kind=backup --exit-code=0 --rows=222)"
check "cola: con red vuelve ok" '[[ "$out" == "ok" ]]'
check "cola: se reenvió la pendiente y luego la nueva" \
  '[[ "$(wc -l <"$T/fake-bodies")" -eq 2 && "$(sed -n 1p "$T/fake-bodies" | jget rows)" == "111" && "$(sed -n 2p "$T/fake-bodies" | jget rows)" == "222" ]]'
check "cola: queda vacía" '(( $(ls "$SP" | wc -l) == 0 ))'
echo 400 >"$T/fake-status"
out="$(NEXT_PUBLIC_SUPABASE_URL="$FAKE_URL" SUPABASE_SERVICE_ROLE_KEY=k RECORD_RUN_SPOOL_DIR="$SP" \
  record_run --kind=backup --exit-code=0)"
check "cola: 4xx no se reintenta ni se encola" '[[ "$out" == "failed_http_400" && "$(wc -l <"$T/fake-bodies")" -eq 3 && $(ls "$SP" | wc -l) -eq 0 ]]'
kill "$fake_pid" 2>/dev/null || true

# El trap conserva el código de salida aunque registrar falle.
cat >"$T/fake-job.sh" <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
source "$SCRIPT_DIR/lib.sh"
on_exit() {
  local code=\$? recorded
  recorded="\$(record_run --kind=backup --exit-code="\$code" --error="prueba")" || recorded="failed_runner"
  printf '%s' "\$recorded" >"$T/fake-recorded"
  exit "\$code"
}
trap on_exit EXIT
exit 7
EOF
set +e
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9 SUPABASE_SERVICE_ROLE_KEY=k bash "$T/fake-job.sh"
fake_code=$?
set -e
check "trap: código 7 intacto con registro fallido" '(( fake_code == 7 ))'
check "trap: el fallo del registro queda anotado" '[[ "$(cat "$T/fake-recorded")" == "failed_network" ]]'

# ── 3) Supabase LOCAL (opcional) ──
if [[ -n "${RECORD_RUN_TEST_URL:-}" ]]; then
  [[ "$RECORD_RUN_TEST_URL" =~ ^http://(127\.0\.0\.1|localhost):[0-9]+/?$ ]] \
    || { echo "RECORD_RUN_TEST_URL debe ser un Supabase local (http://127.0.0.1:<puerto>)"; exit 2; }
  : "${RECORD_RUN_TEST_SERVICE_KEY:?falta RECORD_RUN_TEST_SERVICE_KEY}"
  : "${RECORD_RUN_TEST_ANON_KEY:?falta RECORD_RUN_TEST_ANON_KEY}"
  marker="$(date -u +%s)"
  started="2000-01-01T00:00:00Z"

  out="$(NEXT_PUBLIC_SUPABASE_URL="$RECORD_RUN_TEST_URL" SUPABASE_SERVICE_ROLE_KEY="$RECORD_RUN_TEST_SERVICE_KEY" \
    record_run --kind=drill --exit-code=0 --started-at="$started" --rows="$marker" --runner-commit=0000000)"
  check "local: service_role inserta (ok)" '[[ "$out" == "ok" ]]'
  found="$(node -e '
    const url = process.env.RECORD_RUN_TEST_URL.replace(/\/$/, "");
    const key = process.env.RECORD_RUN_TEST_SERVICE_KEY;
    fetch(`${url}/rest/v1/backup_runs?select=kind,status,rows,error&kind=eq.drill&rows=eq.${process.argv[1]}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } })
      .then((r) => r.json()).then((rows) => process.stdout.write(String(Array.isArray(rows) ? rows.length : -1)))
      .catch(() => process.stdout.write("-1"));
  ' "$marker" 2>/dev/null)"
  check "local: la fila se lee con service_role" '[[ "$found" == "1" ]]'

  out="$(NEXT_PUBLIC_SUPABASE_URL="$RECORD_RUN_TEST_URL" SUPABASE_SERVICE_ROLE_KEY="$RECORD_RUN_TEST_ANON_KEY" \
    record_run --kind=drill --exit-code=0 --started-at="$started" --runner-commit=0000000)"
  check "local: anon es rechazado ($out)" '[[ "$out" =~ ^failed_http_4[0-9]{2} ]]'

  out="$(NEXT_PUBLIC_SUPABASE_URL="$RECORD_RUN_TEST_URL" SUPABASE_SERVICE_ROLE_KEY="$RECORD_RUN_TEST_SERVICE_KEY" \
    record_run --kind=drill --exit-code=3 --started-at="$started" --runner-commit=0000000 --error="fase checks: prueba")"
  check "local: una corrida fallida también se registra" '[[ "$out" == "ok" ]]'

  # Trap REAL de run-backup.sh: con un env inexistente falla en preflight, pero
  # la URL/llave del entorno le alcanzan para dejar la fila y el estado.
  set +e
  NEXT_PUBLIC_SUPABASE_URL="$RECORD_RUN_TEST_URL" SUPABASE_SERVICE_ROLE_KEY="$RECORD_RUN_TEST_SERVICE_KEY" \
    LA_POLLA_BACKUP_ENV="$T/no-existe.env" BACKUP_HOME="$T/home" \
    bash "$SCRIPT_DIR/run-backup.sh" >"$T/run.log" 2>&1
  run_code=$?
  set -e
  check "run-backup.sh: sale con 1 en preflight" '(( run_code == 1 ))'
  check "run-backup.sh: backup-last.json anota run_recorded=ok" \
    '[[ "$(jget run_recorded <"$T/home/status/backup-last.json")" == "ok" && "$(jget ok <"$T/home/status/backup-last.json")" == "false" ]]'
fi

echo "test-record-run: $pass OK, $failn fallas"
(( failn == 0 ))
