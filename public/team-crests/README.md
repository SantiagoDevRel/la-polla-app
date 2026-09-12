# Team crests

Small, same-origin images used by CASA match selection and predictions. These
are real club crests from fixture-provider metadata, not generated badges.
Each image is at most 96 × 96 pixels, enough for a 24–32 px crest on a high
density screen. Rendering does not use Vercel Image Optimization.

Source provenance lives in `lib/teams/crest-catalog.json`: every `bySource`
key is the original public image URL. Providers are football-data.org and
ESPN, plus the Wikimedia URL supplied by football-data for Le Mans FC.
Club marks remain the property of their respective owners; these images
are not covered by this repository's software license.

Refresh from the currently creatable tournaments:

```powershell
node --experimental-strip-types scripts/bake-team-crests.mjs
```

The script reads only public fixture fields from `matches`, using the existing
local Supabase environment variables. It never writes to Supabase and never
reads accounts, payments or predictions. It paginates fixture reads, verifies
every downloaded image, creates 96 px WebP variants with the Sharp bundled
with Next, and retains older catalog entries and files. Asset filenames are
content hashes so refreshed images get new URLs.

The catalog is published only after every source downloads and decodes. An
unknown provider host or failed image stops the refresh. Review the public
catalog and generated images before committing; no credentials are included.

The UI prefers these local assets and existing local country flags. A future
ESPN club uses `/api/teams/crest?espn=<numeric-id>` immediately: the server fetches
the fixed public PNG URL and caches it, so the browser does not depend on direct
CDN access. The endpoint accepts only a bounded numeric ESPN ID, forbids redirects,
validates the PNG signature, and caps the response at 512 KiB. No API key, database,
cookies, or Vercel Image Optimization is involved. Refresh this catalog after
adding leagues or newly promoted clubs. Exact observed names are a backup
lookup when a fixture has no flag URL. There is no fuzzy name matching.
