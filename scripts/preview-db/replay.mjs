// Build the shared preview database (Vercel Preview deployments) from the repo.
//
// PREVIEW ONLY. Applies supabase/migrations in the same order and with the same
// fixups as `npm run test:casa:sql`, then loads synthetic seed data. Never point it
// at production: it refuses the production project ref and any database that
// already has the app schema. See docs/preview-db.md.
//
// Connection comes from the standard libpq variables, never from the command line:
//   PGHOST PGPORT PGUSER PGDATABASE PGPASSWORD   (session pooler, port 5432)
//   PREVIEW_SUPABASE_URL PREVIEW_SERVICE_ROLE_KEY (Auth admin API, synthetic users)
// psql runs inside the Supabase Postgres image used by CI, through Docker.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const PROD_REF = 'sgmygyrvytzaushiqrst';
const PREVIEW_REF = 'xmulfazzjaxbslcrenpg';
const image = 'public.ecr.aws/supabase/postgres:17.6.1.159';
const repo = fileURLToPath(new URL('../..', import.meta.url));
const read = (p) => fs.readFileSync(path.join(repo, p), 'utf8').replace(/\r\n/g, '\n');

for (const v of ['PGHOST', 'PGPORT', 'PGUSER', 'PGDATABASE', 'PGPASSWORD', 'PREVIEW_SUPABASE_URL', 'PREVIEW_SERVICE_ROLE_KEY']) {
  if (!process.env[v]) throw Error(`Missing ${v}`);
}
const target = `${process.env.PGUSER}@${process.env.PGHOST} ${process.env.PREVIEW_SUPABASE_URL}`;
if (target.includes(PROD_REF)) throw Error('Refusing the production project');
if (!process.env.PGUSER.endsWith(`.${PREVIEW_REF}`) || !process.env.PREVIEW_SUPABASE_URL.includes(PREVIEW_REF)) {
  throw Error(`Only the preview project ${PREVIEW_REF} is allowed`);
}

function psql(source, label) {
  const r = spawnSync('docker', ['run', '--rm', '-i',
    '-e', 'PGHOST', '-e', 'PGPORT', '-e', 'PGUSER', '-e', 'PGDATABASE', '-e', 'PGPASSWORD', '-e', 'PGSSLMODE=require',
    '--entrypoint', 'psql', image, '-X', '-q', '-tA', '-v', 'ON_ERROR_STOP=1', '--single-transaction'],
  { input: source, encoding: 'utf8', windowsHide: true, timeout: 300_000, maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) throw Error(`${label} failed:\n${(r.stderr || r.stdout || String(r.error)).slice(0, 2000)}`);
  return r.stdout.trim();
}

const existing = psql("SELECT to_regclass('public.users') IS NOT NULL;", 'schema check');
if (existing !== 'f') throw Error('The preview database already has the app schema; use a fresh project (docs/preview-db.md)');

psql(read('scripts/preview-db/pre.sql'), 'pre.sql');
const files = fs.readdirSync(path.join(repo, 'supabase/migrations')).filter((p) => p.endsWith('.sql')).sort();
for (const file of files) {
  const pre = `scripts/local-pg/fixups/${file.split('_')[0]}.pre.sql`;
  if (fs.existsSync(path.join(repo, pre))) psql(read(pre), pre);
  psql(read(`supabase/migrations/${file}`), file);
  process.stdout.write('.');
}
console.log(`\n${files.length} migrations applied`);
psql(read('scripts/local-pg/fixups/post.sql'), 'fixups/post.sql');
psql(read('scripts/preview-db/post.sql'), 'preview post.sql');

// Synthetic users through the Auth admin API, so auth.users, identities and the
// public.users sync trigger behave like production. Emails use the reserved
// .invalid TLD: nothing can ever be delivered to them.
const people = [
  { key: 'admin', email: 'admin@preview.invalid', name: 'Admin Preview', avatar: 'millos', admin: true },
  { key: 'ana', email: 'ana@preview.invalid', name: 'Ana Preview', avatar: 'costeno', admin: false },
  { key: 'luis', email: 'luis@preview.invalid', name: 'Luis Preview', avatar: 'verde', admin: false },
];
const ids = {};
for (const p of people) {
  const r = await fetch(`${process.env.PREVIEW_SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: process.env.PREVIEW_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.PREVIEW_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: p.email, email_confirm: true, user_metadata: { display_name: p.name } }),
  });
  const body = await r.json();
  if (!r.ok || !body.id) throw Error(`Auth admin create ${p.key} failed: ${r.status} ${body.msg || body.message || ''}`);
  ids[p.key] = body.id;
}
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
psql(people.map((p) => `UPDATE public.users SET display_name=${lit(p.name)}, avatar_url=${lit(p.avatar)}, is_admin=${p.admin} WHERE id=${lit(ids[p.key])};`).join('\n'), 'user profiles');
psql(read('scripts/preview-db/seed.sql').replaceAll(':admin_id', lit(ids.admin)), 'seed.sql');
console.log(psql("SELECT count(*) FROM public.casa_pollas;", 'verify') + ' casa pollas seeded');
