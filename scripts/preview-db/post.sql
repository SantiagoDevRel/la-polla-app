-- PREVIEW ONLY (scripts/preview-db/replay.mjs). Runs after every migration.
-- 1. No scheduled jobs: production's crons call the production app; the preview
--    database must not call anything on its own.
SELECT cron.unschedule(jobid) FROM cron.job;
-- 2. Casa v2, the contract production runs (same step as check-casa-sql).
SELECT public.casa_transition_mode((SELECT mode FROM public.casa_operation_control WHERE singleton),'v2');
