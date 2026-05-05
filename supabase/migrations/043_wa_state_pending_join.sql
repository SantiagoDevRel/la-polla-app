-- Permite preservar la intencion de join cuando un usuario desconocido
-- llega via wa.me link "unirse XXXXXX". Durante el onboarding (nombre +
-- pollito) guardamos el codigo aca y al terminar lo procesamos
-- automaticamente. Sin esto, la intencion se perderia entre el primer
-- mensaje y el final del onboarding.
ALTER TABLE whatsapp_conversation_state
  ADD COLUMN IF NOT EXISTS pending_join_code text;
