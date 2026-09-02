-- 089_casa_premio_y_cierre.sql
-- (2026-09-02) Dos decisiones que hasta hoy no se podian expresar al crear una
-- polla, y que el admin tenia que resolver escribiendo texto libre.
--
-- ── 1. QUE ES EL PREMIO ──────────────────────────────────────────────────
-- Antes existia solo `prize_object` (texto libre). No habia forma de decir
-- "el premio ES el pozo": el admin escribia algo como "el 70% de lo
-- recaudado" a mano, en cada polla, con sus propias palabras. Resultado: dos
-- pollas iguales lo contaban distinto, y la cifra nunca se actualizaba sola
-- aunque el pozo creciera con cada inscripcion.
--
--   prize_kind = 'pozo'   -> el premio es plata y sale de casa_polla_pot().
--                            La UI muestra la cifra VIVA, no un texto.
--   prize_kind = 'objeto' -> el premio es una cosa (una camiseta, un iPhone).
--                            Ahi si manda `prize_object` + una foto opcional.
--
-- El default es 'pozo' a proposito: es lo que hace la casa el 90% de las
-- veces, y las 62 pollas viejas que no tenian prize_object caen ahi sin
-- cambiar de significado.
--
-- ── 2. CUANDO CIERRA ─────────────────────────────────────────────────────
--   close_mode = 'auto'   -> cierra 5 minutos antes del PRIMER partido.
--   close_mode = 'manual' -> el admin pone la fecha que quiera.
--
-- `closes_at` sigue siendo la unica columna que lee toda la app; `close_mode`
-- solo registra COMO se calculo, para que la UI pueda explicarlo y para que
-- se pueda recalcular si algun dia se reprograma un partido.
--
-- ⚠️ Y lo mas importante, que es una distincion que se presta a confusion:
-- `closes_at` decide hasta cuando se puede ENTRAR a la polla. NO es lo que
-- impide hacer trampa. Lo que impide hacer trampa es el lock POR PARTIDO de 5
-- minutos que ya vive en app/api/casa/pollas/[slug]/picks/route.ts (LOCK_MS).
-- Por eso el modo manual es seguro aunque la fecha caiga despues de que ya
-- arrancaron partidos: quien entre tarde puede inscribirse, pero NO va a poder
-- pronosticar los partidos que ya empezaron — entra con esos puntos perdidos.

ALTER TABLE public.casa_pollas
  ADD COLUMN IF NOT EXISTS prize_kind text NOT NULL DEFAULT 'pozo',
  ADD COLUMN IF NOT EXISTS prize_image_path text,
  ADD COLUMN IF NOT EXISTS close_mode text NOT NULL DEFAULT 'manual';

-- Los CHECK van por separado y con guarda, para que la migracion se pueda
-- re-correr sin explotar (el repo no tiene runner: se aplica a mano).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'casa_pollas_prize_kind_check'
  ) THEN
    ALTER TABLE public.casa_pollas
      ADD CONSTRAINT casa_pollas_prize_kind_check
      CHECK (prize_kind IN ('pozo', 'objeto'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'casa_pollas_close_mode_check'
  ) THEN
    ALTER TABLE public.casa_pollas
      ADD CONSTRAINT casa_pollas_close_mode_check
      CHECK (close_mode IN ('auto', 'manual'));
  END IF;
END $$;

-- Las pollas que YA tienen un objeto escrito son de premio en objeto: se
-- reclasifican para que no queden mostrando una cifra que no les corresponde.
UPDATE public.casa_pollas
   SET prize_kind = 'objeto'
 WHERE prize_object IS NOT NULL
   AND btrim(prize_object) <> ''
   AND prize_kind = 'pozo';

COMMENT ON COLUMN public.casa_pollas.prize_kind IS
  'pozo = el premio es el 70% recaudado (cifra viva, sale de casa_polla_pot). objeto = un premio fisico descrito en prize_object.';
COMMENT ON COLUMN public.casa_pollas.prize_image_path IS
  'Ruta en el bucket prize-images. Solo aplica a prize_kind = objeto, y es opcional.';
COMMENT ON COLUMN public.casa_pollas.close_mode IS
  'auto = closes_at se derivo del primer partido menos 5 min. manual = lo puso el admin a mano.';

-- ── Bucket de las fotos de premio ────────────────────────────────────────
-- PUBLICO a proposito, y es la unica diferencia con payment-proofs: la foto de
-- lo que se rifa es publicidad, la tiene que poder ver cualquiera que abra el
-- link compartido (incluso sin sesion). Un comprobante de pago es lo contrario
-- y por eso su bucket sigue siendo privado.
INSERT INTO storage.buckets (id, name, public)
VALUES ('prize-images', 'prize-images', true)
ON CONFLICT (id) DO NOTHING;

-- Escribir en el bucket es solo del service_role: la foto la sube el admin a
-- traves de nuestro endpoint, nunca el browser directo. Lectura publica.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND policyname = 'prize_images_public_read'
  ) THEN
    CREATE POLICY prize_images_public_read ON storage.objects
      FOR SELECT TO public
      USING (bucket_id = 'prize-images');
  END IF;
END $$;
