-- ============================================================
-- 002_payment_mode_fields.sql
-- Agrega campo admin_payment_instructions a pollas
-- para que el admin pueda indicar instrucciones de pago
-- cuando el payment_mode es 'admin_collects'
-- ============================================================

-- Instrucciones de pago del admin (ej: "Enviar a Nequi 310-xxx-xxxx")
-- Solo aplica cuando payment_mode = 'admin_collects'
ALTER TABLE pollas
  ADD COLUMN IF NOT EXISTS admin_payment_instructions text;

-- Comentario descriptivo para documentación del schema
COMMENT ON COLUMN pollas.admin_payment_instructions IS
  'Instrucciones de pago del admin para mode admin_collects (ej: Nequi, Bancolombia, efectivo)';
