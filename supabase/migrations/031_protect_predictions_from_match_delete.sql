-- 031_protect_predictions_from_match_delete — Cambia
-- predictions.match_id de ON DELETE CASCADE a ON DELETE RESTRICT.
--
-- Evita que un borrado accidental de un match tire abajo las
-- predictions atadas a él. Con RESTRICT, intentar borrar un match
-- con predictions falla con error y obliga al operador a limpiar
-- predictions primero conscientemente.
--
-- Las otras 2 FKs (polla_id, user_id) se quedan en CASCADE — borrar
-- una polla o user es un acto explícito que sí debería limpiar sus
-- predictions.

ALTER TABLE public.predictions
  DROP CONSTRAINT IF EXISTS predictions_match_id_fkey;

ALTER TABLE public.predictions
  ADD CONSTRAINT predictions_match_id_fkey
  FOREIGN KEY (match_id) REFERENCES public.matches(id)
  ON DELETE RESTRICT;

COMMENT ON CONSTRAINT predictions_match_id_fkey ON public.predictions IS
  'RESTRICT (no CASCADE) — una vez que un match tiene predictions, no se puede borrar el match. Protege contra accidentes en sync/cleanup.';
