-- 075_ai_image_jobs.sql — cola async para la feature "Crea tu Selfie" (admin-only).
-- La app (Vercel) INSERTA jobs; un worker en el DGX los reclama, genera la imagen y
-- escribe el resultado. Sin exposición entrante: el DGX solo disca hacia Supabase.
-- Boilerplate post-30-oct-2026: RLS + GRANT explícitos.

CREATE TABLE IF NOT EXISTS public.ai_image_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'pending',   -- pending | claimed | done | error
  -- inputs
  player_name     text,                               -- jugador elegido (puede ser null = solo face-paint)
  player_team     text,                               -- selección del jugador (para la bandera del face-paint)
  face_paint      text NOT NULL DEFAULT 'none',       -- none | cheek | full
  selfie_paths    text[] NOT NULL DEFAULT '{}',       -- paths en Storage de las 3 selfies
  -- outputs
  result_path     text,                               -- path en Storage del resultado
  error           text,
  attempts        integer NOT NULL DEFAULT 0,
  -- timing
  created_at      timestamptz NOT NULL DEFAULT now(),
  claimed_at      timestamptz,
  done_at         timestamptz
);

ALTER TABLE public.ai_image_jobs ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_image_jobs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_image_jobs TO service_role;

-- El usuario solo ve/maneja sus propias filas (defense-in-depth; el código también
-- filtra por user_id con admin client por el bug de auth.uid() en PostgREST).
DROP POLICY IF EXISTS ai_image_jobs_own ON public.ai_image_jobs;
CREATE POLICY ai_image_jobs_own ON public.ai_image_jobs
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Índice para el poll del worker (solo pendientes).
CREATE INDEX IF NOT EXISTS ai_image_jobs_pending_idx
  ON public.ai_image_jobs (created_at)
  WHERE status = 'pending';

-- Índice por usuario para el listado en la app.
CREATE INDEX IF NOT EXISTS ai_image_jobs_user_idx
  ON public.ai_image_jobs (user_id, created_at DESC);

-- RPC de claim atómico para el worker del DGX (un job a la vez, fan-out-safe).
CREATE OR REPLACE FUNCTION public.claim_ai_image_job()
RETURNS public.ai_image_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  j public.ai_image_jobs;
BEGIN
  SELECT * INTO j
    FROM public.ai_image_jobs
   WHERE status = 'pending'
   ORDER BY created_at ASC
   FOR UPDATE SKIP LOCKED
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.ai_image_jobs
     SET status = 'claimed', claimed_at = now(), attempts = attempts + 1
   WHERE id = j.id
   RETURNING * INTO j;

  RETURN j;
END;
$$;

-- Supabase auto-otorga EXECUTE a anon/authenticated; revocar y dar solo a service_role.
REVOKE EXECUTE ON FUNCTION public.claim_ai_image_job() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_ai_image_job() FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_ai_image_job() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ai_image_job() TO service_role;
