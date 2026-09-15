-- 130_telegram_player_bot.sql — El bot público de Telegram también sirve de
-- app para jugadores: inscribirse, enviar el comprobante, pronosticar, ver la
-- tabla y la información de cada polla sin abrir la web.
--
-- Numeración: 125-129 quedan libres para ramas en curso (mismo criterio que 115).
--
-- Solo agrega estado de conversación a telegram_login_chats (119): qué respuesta
-- de texto o foto está esperando el bot (nombre, marcador, comprobante…). El
-- dinero, las inscripciones y los pronósticos NO tienen tablas nuevas: el bot usa
-- las mismas funciones v2 (098) y las mismas reglas que la web.
--
-- telegram_login_chats sigue siendo service_role: RLS con deny-all (115), sin
-- grants a anon/authenticated. Las columnas nuevas heredan esos permisos.

ALTER TABLE public.telegram_login_chats
  ADD COLUMN IF NOT EXISTS bot_flow text
    CHECK (bot_flow IS NULL OR bot_flow ~ '^[a-z_]{1,32}$'),
  ADD COLUMN IF NOT EXISTS bot_flow_data jsonb
    CHECK (bot_flow_data IS NULL OR (jsonb_typeof(bot_flow_data) = 'object' AND pg_column_size(bot_flow_data) <= 2048)),
  ADD COLUMN IF NOT EXISTS bot_flow_at timestamptz;

COMMENT ON COLUMN public.telegram_login_chats.bot_flow IS
  'Respuesta que espera el bot de jugadores (name, proof, photo_pick, ticket, score, answer, pay_name, pay_account). NULL = ninguna.';
COMMENT ON COLUMN public.telegram_login_chats.bot_flow_data IS
  'Contexto del paso (ids de polla/partido/pregunta, file_id de la foto, método y titular de la cuenta de premios). El número de cuenta nunca se guarda aquí: es la última respuesta y va directo a users.';

-- Verificación (solo lectura) después de aplicar:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='telegram_login_chats' AND column_name LIKE 'bot_flow%';
--   SELECT has_table_privilege('anon','public.telegram_login_chats','SELECT'),
--          has_table_privilege('authenticated','public.telegram_login_chats','SELECT'); -- false, false
