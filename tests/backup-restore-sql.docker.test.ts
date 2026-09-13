// Corre el SQL que genera buildRestoreSql contra un Postgres 17 REAL, en un
// contenedor desechable (`docker run --rm postgres:17-alpine`). No toca
// Supabase ni ninguna base existente y no lleva datos personales.
//
// Es opt-in porque necesita Docker:
//   BACKUP_SQL_DOCKER_TEST=1 npx vitest run tests/backup-restore-sql.docker.test.ts
//
// Cubre el caso real que rompía el restore: las migraciones siembran
// app_config y casa_operation_control (mode='legacy'), así que un destino
// recién creado no está vacío; el backup trae mode='v2' y tiene que ganar.
import { spawnSync } from "child_process";
import { describe, expect, it } from "vitest";
import { buildRestoreSql, RestoreSection } from "../scripts/backup/core";

const ENABLED = process.env.BACKUP_SQL_DOCKER_TEST === "1";
const IMAGE = process.env.BACKUP_SQL_DOCKER_IMAGE ?? "postgres:17-alpine";

/** Esquema mínimo con las mismas semillas que 028, 064 y 097. */
const SCHEMA = `
CREATE TABLE public.casa_operation_control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  mode text NOT NULL DEFAULT 'legacy' CHECK (mode IN ('legacy','paused','v2')),
  object_draws_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO public.casa_operation_control(singleton) VALUES (true);
CREATE TABLE public.app_config (key text PRIMARY KEY, value text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO public.app_config (key, value) VALUES ('app_base_url', 'https://example.test') ON CONFLICT (key) DO NOTHING;
INSERT INTO public.app_config (key, value) VALUES ('bracket_promotion_mode', 'confirm') ON CONFLICT (key) DO NOTHING;
INSERT INTO public.app_config (key, value) VALUES ('solo_semilla', 'x') ON CONFLICT (key) DO NOTHING;
CREATE TABLE public.demo (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payload json,
  total integer NOT NULL,
  doble integer GENERATED ALWAYS AS (total * 2) STORED
);
CREATE TABLE public.par (a integer, b text, v text, PRIMARY KEY (a, b));
CREATE TABLE public.sin_pk (a integer, b text);
`;

const BACKUP: RestoreSection[] = [
  {
    schemaTable: "public.casa_operation_control",
    rows: [{ singleton: true, mode: "v2", object_draws_enabled: true, updated_at: "2026-09-12T10:00:00+00:00" }],
  },
  {
    schemaTable: "public.app_config",
    rows: [
      { key: "app_base_url", value: "https://example.test", updated_at: "2026-07-01T00:00:00+00:00" },
      { key: "bracket_promotion_mode", value: "auto", updated_at: "2026-07-01T00:00:00+00:00" },
      { key: "schedule_demo", value: "done", updated_at: "2026-09-13T00:00:00+00:00" },
    ],
  },
  {
    schemaTable: "public.demo",
    rows: [
      { id: 1, payload: { a: [1, 2] }, total: 3, doble: 6 },
      { id: 7, payload: null, total: 5, doble: 10 },
    ],
  },
  { schemaTable: "public.par", rows: [{ a: 1, b: "x", v: "uno" }, { a: 1, b: "y", v: "dos" }] },
  { schemaTable: "public.sin_pk", rows: [{ a: 1, b: "igual" }, { a: 1, b: "igual" }] },
];

const STATE = `
\\echo ==STATE==
SELECT 'mode=' || mode || ',draws=' || object_draws_enabled FROM public.casa_operation_control;
SELECT 'cfg=' || string_agg(key || ':' || value, ';' ORDER BY key) FROM public.app_config;
SELECT 'demo=' || count(*) || ',doble=' || coalesce(sum(doble), 0) FROM public.demo;
SELECT 'par=' || count(*) FROM public.par;
SELECT 'sin_pk=' || count(*) FROM public.sin_pk;
`;

type CaseResult = { exit: number; output: string };

/** Un contenedor, una base por caso. Cada caso corre su propio psql con
 *  ON_ERROR_STOP y después imprime el estado final de esa base. */
function runCases(cases: Record<string, string>): Record<string, CaseResult> {
  const names = Object.keys(cases);
  const lines = [
    "set -u",
    "initdb -D /tmp/db -A trust </dev/null >/dev/null 2>&1",
    `pg_ctl -D /tmp/db -o "-k /tmp -c listen_addresses=" -w -l /tmp/pg.log start </dev/null >/dev/null`,
  ];
  for (const name of names) {
    const b64 = Buffer.from(cases[name]).toString("base64");
    const state = Buffer.from(STATE).toString("base64");
    lines.push(
      `createdb -h /tmp ${name} </dev/null`,
      `echo '${b64}' | base64 -d > /tmp/${name}.sql`,
      `echo '${state}' | base64 -d > /tmp/state.sql`,
      `echo "==CASE ${name}=="`,
      `psql -h /tmp -X -q -At -v ON_ERROR_STOP=1 -d ${name} -f /tmp/${name}.sql </dev/null 2>&1; echo "==EXIT $?=="`,
      `psql -h /tmp -X -q -At -v ON_ERROR_STOP=1 -d ${name} -f /tmp/state.sql </dev/null 2>&1`,
    );
  }
  const res = spawnSync("docker", ["run", "--rm", "-i", "--user", "postgres", "--entrypoint", "sh", IMAGE, "-s"], {
    input: lines.join("\n") + "\n",
    encoding: "utf8",
    timeout: 120_000,
  });
  if (res.error) throw res.error;
  const all = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  const out: Record<string, CaseResult> = {};
  for (const name of names) {
    const start = all.indexOf(`==CASE ${name}==`);
    if (start < 0) throw new Error(`el caso ${name} no corrió:\n${all.slice(-2000)}`);
    const next = names.map((n) => all.indexOf(`==CASE ${n}==`)).filter((i) => i > start).sort((a, b) => a - b)[0];
    const chunk = all.slice(start, next ?? all.length);
    const exit = Number(/==EXIT (\d+)==/.exec(chunk)?.[1] ?? "-1");
    out[name] = { exit, output: chunk };
  }
  return out;
}

describe.skipIf(!ENABLED)("SQL de restore contra Postgres real (Docker)", () => {
  it("restaura sobre un esquema sembrado, exige filas idénticas y no mezcla en silencio", () => {
    const strict = buildRestoreSql({ title: "estricto", sections: BACKUP });
    const results = runCases({
      // 1. Destino recién creado (con semillas): el backup gana en las tablas sembradas.
      fresco: SCHEMA + strict,
      // 2. Otra tabla ya tiene datos: aborta con una pista que no es ALLOW_NONEMPTY, y ROLLBACK.
      ocupado: SCHEMA + "INSERT INTO public.demo(total) VALUES (1);\n" + strict,
      // 3. Cuentas ya restauradas aparte: la guarda de auth pide SKIP_AUTH=1.
      auth_previa:
        SCHEMA +
        "CREATE SCHEMA auth; CREATE TABLE auth.users (id text PRIMARY KEY); INSERT INTO auth.users VALUES ('u1');\n" +
        buildRestoreSql({ title: "con auth", sections: [{ schemaTable: "auth.users", rows: [{ id: "u1" }] }, ...BACKUP] }),
      // 4. El backup trae dos veces la misma PK: antes se descartaba una en silencio.
      pk_repetida:
        SCHEMA +
        buildRestoreSql({
          title: "pk repetida",
          sections: [{ schemaTable: "public.par", rows: [{ a: 1, b: "x", v: "uno" }, { a: 1, b: "x", v: "otro" }] }],
        }),
      // 5. ALLOW_NONEMPTY: la fila que choca se salta, pero con NOTICE (conteo y contenido).
      mezcla:
        SCHEMA +
        "INSERT INTO public.par VALUES (1, 'x', 'distinto');\n" +
        buildRestoreSql({ title: "mezcla", sections: BACKUP, allowNonEmpty: true }),
      // 6. Sin reemplazo (REPLACE_TABLES vacío): las semillas vuelven a bloquear, sin commit.
      sin_reemplazo: SCHEMA + buildRestoreSql({ title: "sin reemplazo", sections: BACKUP, replaceTables: [] }),
    });

    const fresco = results.fresco;
    expect(fresco.exit, fresco.output).toBe(0);
    expect(fresco.output).toContain("mode=v2,draws=true");
    expect(fresco.output).toContain(
      "cfg=app_base_url:https://example.test;bracket_promotion_mode:auto;schedule_demo:done",
    );
    expect(fresco.output).not.toContain("solo_semilla");
    expect(fresco.output).toContain("demo=2,doble=16");
    expect(fresco.output).toContain("par=2");
    expect(fresco.output).toContain("sin_pk=2");

    const ocupado = results.ocupado;
    expect(ocupado.exit).not.toBe(0);
    expect(ocupado.output).toMatch(/public\.demo ya tiene 1 filas \(el destino tiene que venir de supabase db reset/);
    expect(ocupado.output).not.toContain("ALLOW_NONEMPTY");
    expect(ocupado.output).toContain("mode=legacy");

    expect(results.auth_previa.exit).not.toBe(0);
    expect(results.auth_previa.output).toMatch(/auth\.users ya tiene 1 filas \(.*SKIP_AUTH=1/);
    expect(results.auth_previa.output).toContain("mode=legacy");

    expect(results.pk_repetida.exit).not.toBe(0);
    // regclass se imprime sin esquema cuando la tabla está en el search_path.
    expect(results.pk_repetida.output).toMatch(/restore: (public\.)?par escribió 1 de 2 fila\(s\) del lote/);
    expect(results.pk_repetida.output).toContain("par=0");

    const mezcla = results.mezcla;
    expect(mezcla.exit, mezcla.output).toBe(0);
    expect(mezcla.output).toMatch(/NOTICE: +restore: (public\.)?par saltó 1 de 2 fila\(s\)/);
    expect(mezcla.output).toMatch(/NOTICE: +restore: (public\.)?par tiene 1 fila\(s\) del lote con contenido distinto/);
    expect(mezcla.output).toContain("mode=v2,draws=true");

    expect(results.sin_reemplazo.exit).not.toBe(0);
    expect(results.sin_reemplazo.output).toMatch(/public\.casa_operation_control ya tiene 1 filas/);
    expect(results.sin_reemplazo.output).toContain("mode=legacy");
  }, 150_000);
});
