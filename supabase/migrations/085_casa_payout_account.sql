-- 085_casa_payout_account.sql
-- ============================================================================
-- A DÓNDE se transfiere la plata.
--
-- Hueco que destapó la revisión de funcionalidad: la pantalla de pago decía
-- "Tienes que transferir $10.000", pedía el pantallazo... y nunca decía a qué
-- cuenta. La persona quedaba trabada con la plata en la mano.
--
-- El modelo viejo sí lo tenía (`pollas.admin_payout_method/account`), pero al
-- construir `casa_pollas` desde cero no se trajo. Es el tipo de cosa que no
-- aparece en un typecheck ni en un test: la app funciona perfecto y el flujo
-- es imposible de completar.
--
-- Va POR POLLA y no en una config global aunque la casa sea una sola: así
-- Tama puede cobrar una polla a Nequi y otra a Bancolombia sin tocar nada
-- global, y el dato queda congelado en la polla (si mañana cambia de cuenta,
-- las pollas viejas siguen mostrando a dónde se pagó de verdad).
-- El formulario de admin lo pre-llena con lo último que usó.
-- ============================================================================

ALTER TABLE public.casa_pollas
  ADD COLUMN IF NOT EXISTS payout_method       text,
  ADD COLUMN IF NOT EXISTS payout_account      text,
  ADD COLUMN IF NOT EXISTS payout_account_name text;

COMMENT ON COLUMN public.casa_pollas.payout_method IS
  'Cómo se paga: nequi | daviplata | bancolombia | otro. Texto libre a propósito — en Colombia salen billeteras nuevas todo el tiempo y no vale la pena un enum que haya que migrar.';
COMMENT ON COLUMN public.casa_pollas.payout_account IS
  'El número (celular de Nequi, cuenta bancaria). Lo ve cualquiera que entre a la polla: es justamente para eso.';
COMMENT ON COLUMN public.casa_pollas.payout_account_name IS
  'A nombre de quién está la cuenta. Sin esto la gente duda de si está pagando al lugar correcto.';

-- Una polla ABIERTA sin cuenta de cobro es una polla que nadie puede pagar.
-- Se valida en la app (mensaje claro al publicar) y acá como red de seguridad,
-- porque el costo de que se escape es que alguien no pueda entrar.
--
-- Las pollas gratis (entry_price_cop = 0) quedan exentas: no hay nada que
-- transferir. Las que ya existen tampoco se tocan — el CHECK solo aplica a
-- filas nuevas o modificadas, y las de demo se limpian aparte.
DO $$ BEGIN
  ALTER TABLE public.casa_pollas
    ADD CONSTRAINT casa_pollas_abierta_necesita_cuenta
    CHECK (
      status <> 'abierta'
      OR entry_price_cop = 0
      OR (payout_method IS NOT NULL AND payout_account IS NOT NULL)
    ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
