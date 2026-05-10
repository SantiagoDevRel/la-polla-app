-- 052_backfill_participant_payout_from_user_default.sql
--
-- Bug 2026-05-09 (polla "primos-polla-2"): Casvi tenía cuenta guardada en
-- users.default_payout_* (la había seteado al ganar otra polla), pero
-- polla_participants.payout_* para esta polla estaba en NULL. El endpoint
-- /api/users/me/pending-payouts sólo leía polla_participants.payout_* sin
-- fallback al default → quien debía pagarle (Santiago/Pipe/Juan Villada)
-- veía counterpartyAccount=null, sin cuenta para copiar.
--
-- Fix de código:
--   1. /api/users/me/pending-payouts ahora hace COALESCE(participant, default).
--   2. /api/pollas/[slug]/payout-method ahora propaga a users.default_payout_*
--      si el user todavía no tiene default.
--
-- Esta migration repite el backfill SQL (ya aplicado en prod manual) para que
-- corra automáticamente en cualquier otro entorno (staging/branch/dev clone).
-- Idempotente: el WHERE filtra a las filas que tienen el problema.

UPDATE polla_participants pp
SET payout_method = u.default_payout_method,
    payout_account = u.default_payout_account,
    payout_account_name = u.default_payout_account_name,
    payout_set_at = COALESCE(pp.payout_set_at, u.default_payout_set_at)
FROM users u
WHERE pp.user_id = u.id
  AND pp.payout_account IS NULL
  AND u.default_payout_account IS NOT NULL;
