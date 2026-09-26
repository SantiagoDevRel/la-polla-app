-- 152_wa_avisos_opt_out.sql — bajas de los avisos de WhatsApp (2026-09-26).
--
-- Los avisos que el bot envía primero (plantillas pronosticos_hoy,
-- polla_cierra_pronto y polla_nueva_abierta) terminan en «Responde BAJA si no
-- quieres más avisos». Quien responde BAJA queda en esta tabla y los crons no
-- le vuelven a escribir; ALTA lo saca. Se guarda por teléfono (E.164 sin «+»,
-- igual que users.whatsapp_number y el `from` del webhook), no por user_id:
-- la baja tiene que valer aunque el número no tenga cuenta.
--
-- Solo service_role: la escribe el webhook y la leen los crons.

CREATE TABLE IF NOT EXISTS public.wa_avisos_opt_out (
  phone       text PRIMARY KEY CHECK (phone ~ '^[0-9]{8,15}$'),
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.wa_avisos_opt_out ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.wa_avisos_opt_out FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.wa_avisos_opt_out TO service_role;

DROP POLICY IF EXISTS wa_avisos_opt_out_deny_all ON public.wa_avisos_opt_out;
CREATE POLICY wa_avisos_opt_out_deny_all ON public.wa_avisos_opt_out
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);
