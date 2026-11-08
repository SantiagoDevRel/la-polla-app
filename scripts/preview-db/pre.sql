-- PREVIEW ONLY (scripts/preview-db/replay.mjs). Extensions that production
-- enabled from the dashboard before the migrations used them. Supabase ships
-- them; a new project only needs them created. Never run on production.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
