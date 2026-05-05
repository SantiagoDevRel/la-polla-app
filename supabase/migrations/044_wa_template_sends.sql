-- Auditoria de WhatsApp template messages enviados desde el bot.
--
-- Por que existe:
--   1. Costo MTD para el admin dashboard (Meta cobra por template).
--   2. Idempotencia del cron de match reminders: si una corrida del
--      cron se reintenta, no queremos duplicar el envio. El check es
--      "WHERE template_name = X AND user_id = Y AND created_at >=
--      <inicio del dia Bogota>".
--   3. Trazabilidad: si un user reporta "no me llego el recordatorio",
--      podemos chequear si el template salio + el wamid de Meta.
CREATE TABLE wa_template_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  phone text NOT NULL,
  template_name text NOT NULL,
  variables jsonb,
  meta_message_id text,
  status text NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent','failed','skipped')),
  error text,
  cost_usd numeric(10, 6) DEFAULT 0,
  category text DEFAULT 'utility'
    CHECK (category IN ('marketing','utility','authentication','service')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX wa_template_sends_idem
  ON wa_template_sends (user_id, template_name, created_at DESC);

CREATE INDEX wa_template_sends_month
  ON wa_template_sends (template_name, created_at DESC);

ALTER TABLE wa_template_sends ENABLE ROW LEVEL SECURITY;
