-- 035_payout_settlement — Settlement de pagos al cierre de la polla.
--
-- Dos columnas nuevas en polla_participants para que cada ganador deje
-- su método y cuenta de cobro.
--
-- Tabla nueva polla_payouts: cada fila es UNA transacción
--   from_user_id  → to_user_id   por amount.
-- Cuando paid_at IS NOT NULL la transacción está saldada. paid_by_user_id
-- registra quién la marcó como pagada (puede ser el que paga, el que
-- cobra confirmando, o el admin sobre-escribiendo).
--
-- UNIQUE (polla_id, from_user_id, to_user_id) garantiza idempotencia:
-- recomputar el settlement no duplica filas; un upsert puede actualizar
-- el monto si por algún motivo cambió.
--
-- CHECK (from_user_id <> to_user_id) bloquea transacciones espurias
-- "X paga a X" (que el algoritmo nunca debería emitir, pero es defensa
-- en profundidad contra bugs).

ALTER TABLE public.polla_participants
  ADD COLUMN IF NOT EXISTS payout_method  text,
  ADD COLUMN IF NOT EXISTS payout_account text,
  ADD COLUMN IF NOT EXISTS payout_set_at  timestamptz;

COMMENT ON COLUMN public.polla_participants.payout_method IS
  'Método de cobro elegido por el participante cuando es ganador. Valores libres pero la UI usa: nequi, daviplata, bancolombia, transfiya, otro.';
COMMENT ON COLUMN public.polla_participants.payout_account IS
  'Cuenta/celular/llave para cobrar. Solo visible para participantes de la misma polla (RLS).';
COMMENT ON COLUMN public.polla_participants.payout_set_at IS
  'Cuándo el participante guardó su info de cobro. NULL = todavía no la dejó.';

CREATE TABLE IF NOT EXISTS public.polla_payouts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  polla_id        uuid NOT NULL REFERENCES public.pollas(id) ON DELETE CASCADE,
  from_user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  to_user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  amount          numeric(12, 2) NOT NULL CHECK (amount > 0),
  paid_at         timestamptz,
  paid_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (polla_id, from_user_id, to_user_id),
  CHECK (from_user_id <> to_user_id)
);

CREATE INDEX IF NOT EXISTS polla_payouts_polla_idx
  ON public.polla_payouts(polla_id);
CREATE INDEX IF NOT EXISTS polla_payouts_from_idx
  ON public.polla_payouts(from_user_id) WHERE paid_at IS NULL;
CREATE INDEX IF NOT EXISTS polla_payouts_to_idx
  ON public.polla_payouts(to_user_id) WHERE paid_at IS NULL;

COMMENT ON TABLE public.polla_payouts IS
  'Transacciones de settlement post-cierre. Una fila = un pago. Idempotente vía UNIQUE (polla, from, to).';

ALTER TABLE public.polla_payouts ENABLE ROW LEVEL SECURITY;

-- service_role bypassa RLS por default en Supabase, pero dejamos un
-- catch-all explícito para que aunque se use anon-key con un JWT custom
-- sea claro qué política aplica. Las queries del backend usan
-- createAdminClient() (service_role) así que no dependen de estas
-- políticas; las políticas son defense-in-depth para reads desde el
-- cliente si en el futuro se exponen.

DROP POLICY IF EXISTS polla_payouts_service_role ON public.polla_payouts;
CREATE POLICY polla_payouts_service_role ON public.polla_payouts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Lectura: cualquier participante de la misma polla puede ver las
-- transacciones (necesario para que cada uno vea su deuda + cuenta del
-- ganador). Esto NO expone fuera de la polla — el join filtra.
DROP POLICY IF EXISTS polla_payouts_participant_read ON public.polla_payouts;
CREATE POLICY polla_payouts_participant_read ON public.polla_payouts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.polla_participants pp
       WHERE pp.polla_id = polla_payouts.polla_id
         AND pp.user_id = auth.uid()
         AND pp.status = 'approved'
    )
  );
