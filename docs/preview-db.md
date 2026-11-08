# Preview database

Vercel Preview deployments use a separate Supabase project with synthetic data
only. Production data and keys never reach a preview.

| | |
|---|---|
| Supabase org | La Polla Previews (`kndikknwwdzhcmwvjigc`), Free plan, USD 0 |
| Project | `la-polla-preview` (`xmulfazzjaxbslcrenpg`), us-east-1 |
| Vercel vars | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, target Preview only (all branches) |
| Local secrets | owner environment store, `la-polla-preview.env` (never in Git) |

## Rules

- Never copy production Supabase values into the Preview target, globally or for a
  branch. A preview with production keys writes test data into real pollas.
- The preview project is not connected to GitHub or Vercel integrations, so nothing
  in it can deploy migrations to production.
- Data is synthetic: three Auth users with `*.invalid` emails (Admin Preview, Ana
  Preview, Luis Preview) and one published Casa polla with three future matches. No
  entries, payments or picks. Add only synthetic rows.
- All scheduled jobs are removed after the replay; the preview database calls
  nothing on its own.
- Preview deployments stay behind Vercel Authentication. Preview still holds some
  real provider keys (for example `RESEND_API_KEY` with `FEEDBACK_NOTIFY_EMAIL`):
  submitting feedback or uploading a proof in a preview can reach those providers.
  Test with flows that send nothing.

## Logging in to a preview

There is no SMS in the preview project. Create a session for a synthetic user with
the Auth admin API (`generateLink` type `magiclink`, then `verifyOtp` with its
`hashed_token`) using the preview service key, and pass the cookies to the browser.
Never request an OTP for a real or fake phone number.

## Schema changes in a pull request

The preview database has the schema of `main` when it was built. A PR that adds a
migration needs it applied to the preview project before its preview works:
apply that one file to `xmulfazzjaxbslcrenpg` (never to production).

## Rebuilding

`scripts/preview-db/replay.mjs` builds a fresh project: the same migration order
and fixups as `npm run test:casa:sql`, then `scripts/preview-db/pre.sql`,
`post.sql` and `seed.sql`. It refuses the production ref, any other project and a
database that already has the schema. Connection settings come from libpq
variables (session pooler, port 5432) and psql runs in the CI Postgres image.

```sh
node tools/secrets.mjs run --vars la-polla-preview.env \
  --env PGPASSWORD=la-polla-preview.env:PREVIEW_DB_PASSWORD \
  -- node <repo>/scripts/preview-db/replay.mjs
```

To rebuild from scratch, create a new Free project, update the ref in the script,
this file and the three Vercel Preview vars, then delete the old project.

## Pause after 7 idle days

Free projects pause after a week with little database activity. Previews then fail
with a Supabase connection error. Restore it from the dashboard (project page,
**Restore project**) or with the Management API:
`POST https://api.supabase.com/v1/projects/xmulfazzjaxbslcrenpg/restore`. Data and
keys survive a pause; restore works for 90 days after the pause.
