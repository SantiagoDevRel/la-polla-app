-- 087_casa_picks_unique_total.sql
-- (2026-09-02) ARREGLA EL BUG QUE HACIA INJUGABLE LA CASA.
--
-- SINTOMA: guardar un pronostico en /casa/[slug] devolvia SIEMPRE 500
-- ("No pude guardar."). No fallaba a veces: fallaba el 100% de las veces,
-- desde el dia uno. Por eso `casa_picks` tiene 0 filas en produccion.
--
-- CAUSA: la 081 creo los dos indices unicos como PARCIALES:
--
--   CREATE UNIQUE INDEX casa_picks_match_unique
--     ON casa_picks(entry_id, match_id) WHERE match_id IS NOT NULL;
--   CREATE UNIQUE INDEX casa_picks_question_unique
--     ON casa_picks(entry_id, question_id) WHERE question_id IS NOT NULL;
--
-- y el endpoint hace `upsert(..., { onConflict: "entry_id,match_id" })`, que
-- PostgREST traduce a `ON CONFLICT (entry_id, match_id) DO UPDATE`.
--
-- Postgres NO puede inferir un indice PARCIAL desde un ON CONFLICT que no
-- repite su clausula WHERE: para usarlo habria que escribir
-- `ON CONFLICT (entry_id, match_id) WHERE match_id IS NOT NULL`, y PostgREST
-- no tiene forma de expresar ese predicado. Resultado:
--
--   ERROR 42P10: there is no unique or exclusion constraint matching the
--                ON CONFLICT specification
--
-- Se reprodujo con EXPLAIN contra produccion (EXPLAIN falla en planificacion,
-- asi que el diagnostico no escribio ni una fila).
--
-- POR QUE EL INDICE TOTAL ES EQUIVALENTE, Y NO SOLO "un parche que compila":
-- la tabla ya tiene CONSTRAINT casa_picks_target CHECK
-- (num_nonnulls(match_id, question_id) = 1), o sea que en cada fila
-- exactamente UNA de las dos columnas es NOT NULL. En un indice unico de
-- Postgres los NULL son distintos entre si (NULLS DISTINCT es el default), asi
-- que un indice total sobre (entry_id, match_id) deja convivir N filas de
-- preguntas — todas con match_id NULL — sin colisionar, y sigue impidiendo dos
-- pronosticos del mismo partido en la misma inscripcion. Misma garantia,
-- inferible por ON CONFLICT.
--
-- ADITIVA A PROPOSITO: no se hace DROP de los indices parciales. Quedan
-- redundantes (el total los cubre) pero borrarlos no arregla nada y si abre
-- una ventana en la que la unicidad no esta garantizada. Cuestan un poco de
-- escritura, no correctitud. Si alguien decide limpiarlos algun dia, que sea
-- una decision explicita y despues de verificar que el total ya esta activo.

-- Indice total para los pronosticos de PARTIDO.
CREATE UNIQUE INDEX IF NOT EXISTS casa_picks_entry_match_key
  ON public.casa_picks (entry_id, match_id);

-- Indice total para las respuestas de PREGUNTA (pollas manuales).
CREATE UNIQUE INDEX IF NOT EXISTS casa_picks_entry_question_key
  ON public.casa_picks (entry_id, question_id);

-- Verificacion (correr a mano despues de aplicar):
--   EXPLAIN INSERT INTO casa_picks (entry_id, polla_id, user_id, match_id, pick_1x2)
--   VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'L')
--   ON CONFLICT (entry_id, match_id) DO UPDATE SET pick_1x2 = excluded.pick_1x2;
-- Antes de esta migracion: ERROR 42P10. Despues: plan valido (no inserta nada).
