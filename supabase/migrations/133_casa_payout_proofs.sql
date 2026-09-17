-- 133_casa_payout_proofs.sql — prueba de pago a los ganadores y premio
-- provisional en la tabla.
--
-- Pedido del dueño (2026-09-16):
--   · Cuando una polla termina con ganador(es), la casa paga uno a uno y sube
--     el pantallazo de cada transferencia. Ese soporte se le muestra al ganador
--     y queda en la polla (en «Pollas cerradas») como prueba de que sí se pagó.
--   · En la Tabla, mostrar cuánto se estaría ganando cada líder con el pozo
--     de este momento, actualizado a los marcadores que van.
--
-- Qué agrega:
--   1. casa_payouts: proof_path (bucket privado `payout-proofs`, prefijo
--      casa/<polla>/<payout>/), proof_uploaded_at, paid_by y paid_reference.
--      Un comprobante exige paid_at (CHECK). El cron cleanup-payout-proofs solo
--      borra archivos referenciados por polla_payouts (P2P): estos quedan.
--   2. casa_v2_write_guard: el UPDATE de casa_payouts admite también esas
--      cuatro columnas. Todo lo demás del premio sigue inmutable.
--   3. casa_mark_payout_paid_v2: registra el pago de UN premio en dinero de una
--      polla resuelta, con el comprobante. Admin + contrato v2. Idempotente:
--      volver a subir reemplaza el comprobante y conserva paid_at.
--   4. casa_provisional_prizes_v2: cuánto se llevaría cada participación que va
--      arriba si la polla terminara ahora. Misma regla y redondeo que
--      casa_settle_polla_v2 (pozo / participaciones ganadoras, sobrante de a un
--      peso en orden estable). Solo pozo en dinero, solo mientras no esté
--      resuelta, solo si el máximo es > 0. La plata se calcula acá, no en TS.
--
-- No toca predictions, pronósticos, inscripciones, pozos ni pollas abiertas.
-- Todas las funciones: SECURITY DEFINER, search_path fijo, solo service_role.

-- ── 1. Columnas ─────────────────────────────────────────────────────────────
ALTER TABLE public.casa_payouts
  ADD COLUMN IF NOT EXISTS proof_path text,
  ADD COLUMN IF NOT EXISTS proof_uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS paid_reference text;

DO $$ BEGIN
  ALTER TABLE public.casa_payouts ADD CONSTRAINT casa_payout_proof_requires_paid
    CHECK (proof_path IS NULL OR (paid_at IS NOT NULL AND proof_uploaded_at IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.casa_payouts ADD CONSTRAINT casa_payout_paid_reference_len
    CHECK (paid_reference IS NULL OR length(paid_reference) BETWEEN 1 AND 200);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS casa_payouts_proof_path_key
  ON public.casa_payouts(proof_path) WHERE proof_path IS NOT NULL;

COMMENT ON COLUMN public.casa_payouts.proof_path IS
  'Pantallazo de la transferencia al ganador, en el bucket privado payout-proofs (casa/<polla>/<payout>/…). Lo ven el ganador y los participantes como prueba de pago.';

-- ── 2. Guard: las columnas del pago también se pueden escribir ──────────────
-- Idéntica a la 100 salvo la lista de columnas mutables de casa_payouts.
CREATE OR REPLACE FUNCTION public.casa_v2_write_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE m text; p_id uuid; p public.casa_pollas;
BEGIN
  SELECT mode INTO m FROM public.casa_operation_control WHERE singleton FOR SHARE;
  IF m='legacy' THEN RETURN NEW; END IF;
  IF m='paused' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='OPERATIONS_PAUSED'; END IF;
  IF current_setting('app.casa_contract',true) IS DISTINCT FROM '2' THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='UPDATE_REQUIRED';
  END IF;
  IF TG_TABLE_NAME='casa_pollas' THEN
    IF TG_OP='UPDATE' THEN
      IF OLD.status IN ('resuelta','anulada') AND (
        (to_jsonb(NEW)-ARRAY['archived_at','archived_by','updated_at']) IS DISTINCT FROM
        (to_jsonb(OLD)-ARRAY['archived_at','archived_by','updated_at'])
      ) THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='POLLA_FINAL'; END IF;
      IF EXISTS(SELECT 1 FROM public.casa_object_draws WHERE polla_id=OLD.id AND state='pending') THEN
        RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='DRAW_PENDING';
      END IF;
    END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME='casa_entries' THEN p_id:=NEW.polla_id;
  ELSIF TG_TABLE_NAME='casa_questions' THEN p_id:=NEW.polla_id;
  ELSIF TG_TABLE_NAME='casa_polla_matches' THEN p_id:=NEW.polla_id;
  ELSIF TG_TABLE_NAME='casa_options' THEN
    SELECT polla_id INTO p_id FROM public.casa_questions WHERE id=NEW.question_id;
  ELSIF TG_TABLE_NAME='casa_payouts' THEN
    IF TG_OP='UPDATE' THEN
      -- Migración 133: el pago (paid_at + comprobante) y la entrega del objeto
      -- son lo único que cambia después de repartir; el premio es inmutable.
      IF (to_jsonb(NEW)-ARRAY['paid_at','delivered_at','delivered_by','delivery_reference','proof_path','proof_uploaded_at','paid_by','paid_reference']) IS DISTINCT FROM
        (to_jsonb(OLD)-ARRAY['paid_at','delivered_at','delivered_by','delivery_reference','proof_path','proof_uploaded_at','paid_by','paid_reference']) THEN
        RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='AWARD_IMMUTABLE';
      END IF;
      IF OLD.delivered_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
        RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='DELIVERY_RECORDED';
      END IF;
    END IF;
    RETURN NEW;
  ELSE RETURN NEW;
  END IF;
  -- New RPCs hold parent before child. A legacy/direct child writer must fail
  -- rather than deadlock against the parent->child order used by settlement.
  SELECT * INTO p FROM public.casa_pollas WHERE id=p_id FOR UPDATE NOWAIT;
  IF NOT FOUND OR p.archived_at IS NOT NULL OR p.status IN ('resuelta','anulada') THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='POLLA_FINAL';
  END IF;
  IF EXISTS(SELECT 1 FROM public.casa_object_draws WHERE polla_id=p_id) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='DRAW_PENDING';
  END IF;
  IF TG_TABLE_NAME='casa_entries' THEN
    IF NEW.current_proof_attempt_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM public.casa_entry_proof_attempts a
      WHERE a.id=NEW.current_proof_attempt_id AND a.entry_id=NEW.id AND a.user_id=NEW.user_id
        AND (NEW.proof_path IS NULL OR (a.state='confirmed' AND a.proof_path=NEW.proof_path))
    ) THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PROOF_ATTEMPT_MISMATCH'; END IF;
    IF TG_OP='UPDATE' THEN
      IF OLD.status='pagada' AND NEW IS DISTINCT FROM OLD THEN
        RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ALREADY_PAID';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- ── 3. Registrar el pago de un premio con su comprobante ────────────────────
CREATE OR REPLACE FUNCTION public.casa_mark_payout_paid_v2(
  p_payout_id uuid, p_actor_id uuid, p_contract integer, p_proof_path text, p_reference text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a public.casa_payouts; p public.casa_pollas; v_prev text; v_paid integer; v_total integer;
BEGIN
  PERFORM public.casa_v2_context(p_contract);
  PERFORM public.casa_v2_admin(p_actor_id,NULL);
  SELECT * INTO a FROM public.casa_payouts WHERE id=p_payout_id;
  IF NOT FOUND OR a.prize_kind<>'pozo' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PAYOUT_NOT_FOUND'; END IF;
  -- El comprobante vive bajo la carpeta de ESTE premio: ni otra polla ni otro ganador.
  IF p_proof_path IS NULL OR p_proof_path !~ ('^casa/'||a.polla_id||'/'||a.id||'/[A-Za-z0-9._-]{1,120}$') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_PROOF_PATH';
  END IF;
  IF p_reference IS NOT NULL AND length(btrim(p_reference))>200 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REFERENCE';
  END IF;
  -- Mismo orden de locks que casa_record_delivery_v2: polla y después premio.
  SELECT * INTO p FROM public.casa_pollas WHERE id=a.polla_id FOR UPDATE;
  IF p.archived_at IS NOT NULL OR p.status<>'resuelta' OR p.settlement_outcome IS DISTINCT FROM 'money_awarded' THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PAYOUT_NOT_PAYABLE',DETAIL='Solo se registran pagos de premios en dinero de pollas ya resueltas.';
  END IF;
  SELECT * INTO a FROM public.casa_payouts WHERE id=p_payout_id FOR UPDATE;
  v_prev:=a.proof_path;
  UPDATE public.casa_payouts
     SET paid_at=coalesce(paid_at,clock_timestamp()), paid_by=p_actor_id,
         proof_path=p_proof_path, proof_uploaded_at=clock_timestamp(),
         paid_reference=nullif(btrim(p_reference),'')
   WHERE id=a.id RETURNING * INTO a;
  SELECT count(*) FILTER (WHERE paid_at IS NOT NULL), count(*) INTO v_paid, v_total
    FROM public.casa_payouts WHERE polla_id=a.polla_id AND prize_kind='pozo';
  RETURN jsonb_build_object('payout_id',a.id,'polla_id',a.polla_id,'user_id',a.user_id,'amount_cop',a.amount_cop,
    'paid_at',a.paid_at,'proof_path',a.proof_path,'previous_proof_path',
    CASE WHEN v_prev IS DISTINCT FROM a.proof_path THEN v_prev END,'paid_count',v_paid,'total_count',v_total);
END $$;

-- ── 4. Premio provisional por participación líder ───────────────────────────
-- Refleja casa_settle_polla_v2: pozo vigente / participaciones empatadas arriba,
-- sobrante de a un peso por participación en orden (user_id, entry_number).
-- Sin filas si la polla no es de pozo en dinero, ya está resuelta o archivada,
-- o nadie suma puntos.
CREATE OR REPLACE FUNCTION public.casa_provisional_prizes_v2(p_polla_id uuid)
RETURNS TABLE(entry_id uuid, user_id uuid, amount_cop bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  WITH p AS (
    SELECT id FROM public.casa_pollas
     WHERE id=p_polla_id AND prize_kind='pozo' AND archived_at IS NULL AND status IN ('abierta','cerrada')
  ), pot AS (
    SELECT s.prize_cop FROM p JOIN public.casa_pot_summaries_v2(ARRAY[p_polla_id]) s ON s.polla_id=p.id
  ), lb AS (
    SELECT l.entry_id, l.user_id, l.entry_number, l.points FROM p, public.casa_leaderboard(p_polla_id) l
  ), top AS (
    SELECT max(points) AS pts FROM lb
  ), w AS (
    SELECT lb.entry_id, lb.user_id,
           count(*) OVER () AS shares,
           row_number() OVER (ORDER BY lb.user_id, lb.entry_number) AS rn
      FROM lb, top WHERE lb.points=top.pts AND top.pts>0
  )
  SELECT w.entry_id, w.user_id,
         (pot.prize_cop/w.shares)
           + CASE WHEN w.rn <= pot.prize_cop-(pot.prize_cop/w.shares)*w.shares THEN 1 ELSE 0 END
    FROM w, pot
   ORDER BY w.rn;
$$;

-- ── Permisos: solo servidor ────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.casa_v2_write_guard(),
  public.casa_mark_payout_paid_v2(uuid,uuid,integer,text,text),
  public.casa_provisional_prizes_v2(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.casa_v2_write_guard(),
  public.casa_mark_payout_paid_v2(uuid,uuid,integer,text,text),
  public.casa_provisional_prizes_v2(uuid)
  TO service_role;

-- Verificación (solo lectura) después de aplicar:
--   SELECT column_name FROM information_schema.columns WHERE table_name='casa_payouts'
--     AND column_name IN ('proof_path','proof_uploaded_at','paid_by','paid_reference');  -- 4 filas
--   SELECT proname, proacl FROM pg_proc WHERE proname IN
--     ('casa_mark_payout_paid_v2','casa_provisional_prizes_v2','casa_v2_write_guard'); -- solo postgres + service_role
--   SELECT prosrc LIKE '%paid_reference%' FROM pg_proc WHERE proname='casa_v2_write_guard'; -- true
