-- 076_drop_ai_image_jobs.sql
-- Retira el feature "Crea tu Selfie" (generación de imágenes con el DGX/ComfyUI).
-- Decisión del owner 2026-06-30: se descarta el feature (no es útil ni escalable).
-- Revierte 075: borra la RPC y la tabla (CASCADE limpia policy + índices).
-- El bucket de Storage `ai-images` y el worker del DGX se retiran aparte (fuera de SQL).

DROP FUNCTION IF EXISTS public.claim_ai_image_job();
DROP TABLE IF EXISTS public.ai_image_jobs CASCADE;
