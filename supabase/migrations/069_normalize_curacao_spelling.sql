-- 069_normalize_curacao_spelling.sql
--
-- Bug (2026-06-14): la mini-tabla del Grupo E del Mundial mostraba 0 pts para
-- todos aunque Alemania ya había ganado 7-1 a Curaçao. Causa raíz: ortografía
-- partida del nombre del equipo en `matches`. El partido jugado (proveedor
-- football-data/ESPN) quedó como "Curaçao" (con cedilla); los demás fixtures
-- del grupo (sync openfootball/api-football) como "Curacao" (plano). La tabla
-- del grupo arma el "componente conexo" por nombre EXACTO, así que el partido
-- jugado no matcheaba la membresía → se descartaba.
--
-- Fix de data: normalizar todas las filas a "Curaçao" (cedilla), que es la
-- ortografía canónica usada en el resto del código (baked squads,
-- worldcup-team-ids, worldcup-facts ya corregido).
--
-- Defense-in-depth: los lookups por nombre (tabla de grupo, facts, planteles
-- horneados) se hicieron insensibles a acentos vía lib/teams/team-name-key.ts,
-- así que aunque un sync futuro vuelva a escribir "Curacao" plano (el RPC
-- upsert_match_safe sobrescribe el display name), la UI ya no se rompe.
--
-- Idempotente: re-correr no hace nada si ya está normalizado.

UPDATE public.matches
   SET home_team = 'Curaçao'
 WHERE tournament = 'worldcup_2026'
   AND home_team IN ('Curacao', 'Curacão', 'Curaçao')
   AND home_team <> 'Curaçao';

UPDATE public.matches
   SET away_team = 'Curaçao'
 WHERE tournament = 'worldcup_2026'
   AND away_team IN ('Curacao', 'Curacão', 'Curaçao')
   AND away_team <> 'Curaçao';
