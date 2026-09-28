#!/usr/bin/env bash
# scripts/local-pg/apply-migrations.sh
#
# LOCAL ONLY. Recreates a database (default la_polla_local on 127.0.0.1:54322),
# loads the Supabase stand-ins, creates the auth schema (real GoTrue migrations
# when GOTRUE_BIN points to the `auth` binary, otherwise auth-stub.sql) and
# applies every supabase/migrations/*.sql in order, each in one transaction.
#
# A few production objects were created by hand before the repo recorded them
# (see CLAUDE.md, REGLA #5). scripts/local-pg/fixups/<NNN>.pre.sql recreates
# just those objects right before migration NNN so the chain replays. Fixups
# never touch production and never change a migration file.
#
# Refuses any host other than 127.0.0.1.
set -euo pipefail
HOST="${PGHOST_LOCAL:-127.0.0.1}"; PORT="${PGPORT_LOCAL:-54322}"; DB="${PGDB_LOCAL:-la_polla_local}"
[[ "$HOST" == "127.0.0.1" ]] || { echo "Only 127.0.0.1 is allowed"; exit 2; }
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PSQL=(psql -h "$HOST" -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1)

"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB" >/dev/null
"${PSQL[@]}" -d "$DB" -f "$ROOT/scripts/local-pg/supabase-stubs.sql" >/dev/null 2>&1

if [[ -n "${GOTRUE_BIN:-}" ]]; then
  GOTRUE_DB_DRIVER=postgres GOTRUE_DB_NAMESPACE=auth \
  DATABASE_URL="postgres://supabase_auth_admin@$HOST:$PORT/$DB?sslmode=disable" \
  API_EXTERNAL_URL=http://127.0.0.1:54321 GOTRUE_SITE_URL=http://localhost:3101 \
  GOTRUE_JWT_SECRET="${LOCAL_JWT_SECRET:-local-test-secret-at-least-32-characters-long}" \
    "$GOTRUE_BIN" migrate >/dev/null 2>&1 || { echo "GoTrue migrate failed"; exit 1; }
  "${PSQL[@]}" -d "$DB" -c "GRANT SELECT ON auth.users TO service_role" >/dev/null
else
  "${PSQL[@]}" -d "$DB" -f "$ROOT/scripts/local-pg/auth-stub.sql" >/dev/null
fi

fail=0
for f in "$ROOT"/supabase/migrations/*.sql; do
  n="$(basename "$f" | cut -d_ -f1)"
  pre="$ROOT/scripts/local-pg/fixups/$n.pre.sql"
  if [[ -f "$pre" ]]; then
    "${PSQL[@]}" -d "$DB" --single-transaction -f "$pre" >/dev/null 2>&1 || { echo "FIXUP FAILED: $n"; exit 1; }
  fi
  if ! out=$("${PSQL[@]}" -d "$DB" --single-transaction -f "$f" 2>&1 >/dev/null); then
    echo "FAILED: $(basename "$f")"; echo "$out" | grep -E "ERROR|LINE" | head -5; fail=1
    [[ "${CONTINUE_ON_ERROR:-0}" == "1" ]] || exit 1
  fi
done
"${PSQL[@]}" -d "$DB" -f "$ROOT/scripts/local-pg/fixups/post.sql" >/dev/null
[[ $fail == 0 ]] && echo "All migrations applied to $DB"
