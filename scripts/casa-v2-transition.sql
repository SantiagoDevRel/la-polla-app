-- psql -v expected=legacy -v next=paused -f scripts/casa-v2-transition.sql
-- Repeat at most THREE times after a timeout, checking the current mode each
-- time. Never terminate database sessions. Keep traffic paused on uncertainty.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='3s';
SELECT public.casa_transition_mode(:'expected', :'next');
COMMIT;
