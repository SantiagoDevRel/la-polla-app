-- 050_cleanup_tbd_placeholders — Borra placeholders TBD vs TBD que no
-- tienen predictions, dejando solo los pocos legacy con predictions.
--
-- Razón: ensurePlaceholders pre-creaba 8 cuartos + 4 semis + 2 final
-- para cada torneo con bracket — total 200 rows TBD ensuciando
-- /pollas/crear. Cuando ESPN publica las llaves reales, lookup #4
-- de upsert_match_safe las promueve, pero entre la pre-creación y la
-- promoción los users ven "TBD vs TBD" repetido en el wizard.
--
-- Plan: borrar TODOS los TBDs que NO tengan predictions. Los pocos con
-- predictions (Champions final hoy) los dejamos vivir hasta que ESPN
-- promueva. A futuro `ensurePlaceholders` se desactiva (no más TBDs).
-- Doc: ver REGLA #2 en `~/.claude/CLAUDE.md`.

DELETE FROM public.matches m
WHERE m.home_team = 'TBD'
  AND m.external_id LIKE 'placeholder:%'
  AND NOT EXISTS (
    SELECT 1 FROM public.predictions p WHERE p.match_id = m.id
  );

DO $$
DECLARE
  remaining int;
BEGIN
  SELECT COUNT(*) INTO remaining
  FROM public.matches WHERE home_team = 'TBD';
  RAISE NOTICE 'TBD placeholders restantes: % (todos con predictions)', remaining;
END $$;
