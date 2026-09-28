-- LOCAL ONLY. matches.elapsed was added by hand in production (the live
-- writers from 027 onward already pass p_elapsed); 103 selects it.
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS elapsed integer;
