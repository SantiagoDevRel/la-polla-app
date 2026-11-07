-- 180_rifa_combo_answers.sql — «¿Eres de un combo de Los Del Sur?»
--
-- Pedido del dueño (2026-11-07): al entrar a la rifa hecha con Los Del Sur
-- (lib/rifas/partner.ts) se le pregunta a cada persona con sesión si es de un
-- combo y cuál. Es un dato solo para el dueño: lo ve un administrador de
-- La Polla (users.is_admin) en Gestionar. La respuesta no cambia nada de la
-- compra, el tablero ni los pagos.
--
-- Una fila por persona y rifa; volver a contestar la reemplaza.
-- Solo service_role: la app valida la sesión y escribe con el user_id de la
-- sesión, igual que el resto de tablas de rifas (157).

CREATE TABLE public.rifa_combo_answers (
  rifa_id uuid NOT NULL REFERENCES public.rifas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  in_combo boolean NOT NULL,
  combo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rifa_id, user_id),
  CONSTRAINT rifa_combo_answers_combo_check CHECK (
    (in_combo AND combo IS NOT NULL AND char_length(btrim(combo)) BETWEEN 2 AND 80)
    OR (NOT in_combo AND combo IS NULL)
  )
);

COMMENT ON TABLE public.rifa_combo_answers IS
  'Respuesta a «¿Eres de un combo de Los Del Sur?» en rifas con barra (lib/rifas/partner.ts). Solo la ve un administrador.';

ALTER TABLE public.rifa_combo_answers ENABLE ROW LEVEL SECURITY;

-- Supabase auto-otorga a anon/authenticated: se revoca y se da lo mínimo.
REVOKE ALL ON public.rifa_combo_answers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rifa_combo_answers TO service_role;

CREATE POLICY rifa_combo_answers_deny_clients ON public.rifa_combo_answers
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
