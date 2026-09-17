-- LOCAL DOCKER ONLY. Migración 135: invitaciones y cupos de regalo.
-- Fixtures nuevos; todo se revierte al final. No toca predictions reales.
--   docker exec -i supabase_db_la-polla psql -U postgres -v ON_ERROR_STOP=1 < scripts/casa-referrals-check.sql
-- Antes de instalar la 135 en local, se puede probar en la misma transacción:
--   { echo 'BEGIN;'; cat supabase/migrations/135_casa_referrals.sql scripts/casa-referrals-check.sql; } \
--     | docker exec -i supabase_db_la-polla psql -U postgres -v ON_ERROR_STOP=1
\set ON_ERROR_STOP on
BEGIN;
SELECT public.casa_transition_mode((SELECT mode FROM public.casa_operation_control),'v2');
SELECT public.casa_v2_context(2);

CREATE FUNCTION pg_temp.ref_must_fail(q text, expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE msg text;
BEGIN
  BEGIN EXECUTE q;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
    IF position(expected IN msg)=0 THEN RAISE EXCEPTION 'Expected %, got %',expected,msg; END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'Expected failure %, but operation succeeded',expected;
END $$;

-- Cuenta local con su cuenta de acceso, como en producción (la regla de persona
-- nueva mira auth.users). p_old = creada antes de que empezara el programa.
CREATE FUNCTION pg_temp.ref_user(p_name text, p_old boolean DEFAULT false) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid:=gen_random_uuid(); t timestamptz; phone text:='1777'||lpad(floor(random()*1e10)::bigint::text,10,'0');
BEGIN
  t:=CASE WHEN p_old THEN (SELECT accounts_since FROM public.casa_referral_settings)-interval '1 day'
    ELSE clock_timestamp() END;
  INSERT INTO auth.users(id,phone,created_at,updated_at) VALUES(v,phone,t,t);
  -- on_auth_user_created ya creó la fila pública.
  UPDATE public.users SET display_name=p_name,avatar_url='millos',created_at=t WHERE id=v;
  IF NOT FOUND THEN
    INSERT INTO public.users(id,whatsapp_number,display_name,avatar_url,created_at) VALUES(v,phone,p_name,'millos',t);
  END IF;
  RETURN v;
END $$;

CREATE FUNCTION pg_temp.ref_polla(p_admin uuid, p_name text, p_every integer DEFAULT 5, p_price integer DEFAULT 20000,
  p_max integer DEFAULT 10) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE p uuid:=gen_random_uuid(); mid uuid;
BEGIN
  mid:=public.upsert_match_safe('casa-ref-'||p,'local_casa_ref',1,'league','Ref H '||left(p::text,8),'Ref A '||left(p::text,8),
    NULL,NULL,clock_timestamp()+interval '2 hours',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);
  INSERT INTO public.casa_pollas(id,slug,name,kind,tournament,scoring_mode,status,closes_at,created_by,entry_price_cop,
      house_cut_pct,payout_method,payout_account,max_entries_per_user,referral_every)
    VALUES(p,'ref-'||p,p_name,'partidos','local_casa_ref','marcador','abierta',clock_timestamp()+interval '1 hour',
      p_admin,p_price,30,'nequi','fixture',p_max,p_every);
  INSERT INTO public.casa_polla_matches(polla_id,match_id) VALUES(p,mid);
  RETURN p;
END $$;

CREATE FUNCTION pg_temp.ref_review(p_entry uuid, p_admin uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE a uuid; rev integer;
BEGIN
  SELECT e.current_proof_attempt_id,x.review_revision INTO a,rev FROM public.casa_entries e
    JOIN public.casa_entry_proof_attempts x ON x.id=e.current_proof_attempt_id WHERE e.id=p_entry;
  PERFORM public.casa_review_attempt_v3(a,rev,'pagada',NULL,2,p_admin);
END $$;

CREATE FUNCTION pg_temp.ref_unpay(p_entry uuid, p_admin uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE a uuid; rev integer;
BEGIN
  SELECT e.current_proof_attempt_id,x.review_revision INTO a,rev FROM public.casa_entries e
    JOIN public.casa_entry_proof_attempts x ON x.id=e.current_proof_attempt_id WHERE e.id=p_entry;
  PERFORM public.casa_unpay_attempt_v2(a,rev,'Corrección de prueba',2,p_admin);
END $$;

-- Comprobante + aprobación de una participación nueva (o de la boleta p_ticket).
CREATE FUNCTION pg_temp.ref_pay(p_polla uuid, p_user uuid, p_admin uuid, p_sha text, p_ticket integer DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  r:=public.casa_begin_entry_proof_v3(p_polla,p_user,gen_random_uuid(),p_ticket,NULL,repeat(p_sha,64),'image/png',100,2);
  INSERT INTO storage.objects(bucket_id,name) VALUES('payment-proofs',r->>'proof_path');
  PERFORM public.casa_confirm_entry_proof_v2((r->>'attempt_id')::uuid,p_user,2);
  PERFORM pg_temp.ref_review((r->>'entry_id')::uuid,p_admin);
  RETURN (r->>'entry_id')::uuid;
END $$;

DO $$
DECLARE admin_id uuid; juan uuid; ana uuid; old_user uuid; sin_perfil uuid; spam uuid;
  inv uuid[]:='{}'; i integer; p uuid; q uuid; r2 uuid; off_p uuid; rifa_p uuid; free_p uuid;
  code_juan text; code_ana text; res jsonb; view jsonb; gift uuid; e5 uuid; juan_e uuid; x uuid; y uuid; mid uuid;
  settle jsonb; s uuid; sv uuid[]:='{}'; g1 uuid; g2 uuid; t1 uuid; t2 uuid; u uuid; code_x text;
BEGIN
  admin_id:=pg_temp.ref_user('Admin ref local');
  UPDATE public.users SET is_admin=true WHERE id=admin_id;
  juan:=pg_temp.ref_user('Juan Pérez',true);   -- quien invita puede ser una cuenta vieja
  ana:=pg_temp.ref_user('Ána');
  old_user:=pg_temp.ref_user('Cuenta vieja',true);
  sin_perfil:=pg_temp.ref_user('Sin pollito');
  UPDATE public.users SET avatar_url=NULL WHERE id=sin_perfil;
  spam:=pg_temp.ref_user('Prueba códigos');

  -- 1) Código personal: letras del nombre sin tildes + 4 dígitos, estable.
  code_juan:=public.casa_referral_code_v1(juan);
  ASSERT code_juan ~ '^JUANPE[0-9]{4}$', code_juan;
  ASSERT public.casa_referral_code_v1(juan)=code_juan, 'the code never changes';
  code_ana:=public.casa_referral_code_v1(ana);
  ASSERT code_ana ~ '^ANA[0-9]{4}$', code_ana;
  PERFORM pg_temp.ref_must_fail(format('SELECT public.casa_referral_code_v1(%L)',sin_perfil),'PROFILE_REQUIRED');
  RAISE NOTICE 'PASS personal codes';

  -- 2) Vincular: solo personas nuevas, nunca a sí mismas, código exacto.
  res:=public.casa_set_referrer_v1(old_user,code_juan,'codigo');
  ASSERT res->>'error'='NOT_NEW_USER', res::text;
  res:=public.casa_set_referrer_v1(ana,code_ana,'codigo');
  ASSERT res->>'error'='SELF_REFERRAL', res::text;
  res:=public.casa_set_referrer_v1(ana,'NOEXISTE0000','codigo');
  ASSERT res->>'error'='REFERRAL_CODE_NOT_FOUND', res::text;
  res:=public.casa_set_referrer_v1(ana,' '||lower(code_juan)||' ','enlace');
  ASSERT (res->>'ok')::boolean AND (res->>'changed')::boolean AND res->'referrer'->>'name'='Juan Pérez', res::text;
  ASSERT NOT (res->'referrer' ? 'user_id'), 'no internal ids leave SQL';
  res:=public.casa_set_referrer_v1(ana,code_juan,'codigo');
  ASSERT (res->>'ok')::boolean AND NOT (res->>'changed')::boolean, res::text;
  ASSERT (SELECT count(*) FROM public.casa_referrals WHERE referred_user_id=ana)=1;
  PERFORM pg_temp.ref_must_fail(format('INSERT INTO public.casa_referrals(referred_user_id,referrer_user_id,code,via) VALUES(%L,%L,''X'',''codigo'')',
    ana,old_user),'casa_referrals_pkey');
  FOR i IN 1..10 LOOP
    res:=public.casa_set_referrer_v1(spam,'MALO'||i,'codigo');
    ASSERT res->>'error'='REFERRAL_CODE_NOT_FOUND', res::text;
  END LOOP;
  res:=public.casa_set_referrer_v1(spam,code_juan,'codigo');
  ASSERT res->>'error'='REFERRAL_RATE_LIMITED', res::text;
  view:=public.casa_referral_invitee_v1(old_user,code_juan);
  ASSERT NOT (view->>'can_set_referrer')::boolean AND view->'hint'='null'::jsonb, view::text;
  view:=public.casa_referral_invitee_v1(ana,code_juan);
  ASSERT (view->>'can_set_referrer')::boolean AND view->'hint'='null'::jsonb AND view->'referrer'->>'name'='Juan Pérez', view::text;
  RAISE NOTICE 'PASS linking: one referrer per person, new people only, rate limit';

  -- 3) Cinco invitados nuevos pagan esta polla → cupo de regalo, aunque Juan pague de último.
  p:=pg_temp.ref_polla(admin_id,'Ofigolazo ref');
  FOR i IN 1..5 LOOP
    x:=pg_temp.ref_user('Invitado '||i);
    res:=public.casa_set_referrer_v1(x,code_juan,'enlace');
    ASSERT (res->>'ok')::boolean, res::text;
    inv:=inv||x;
  END LOOP;
  view:=public.casa_referral_invitee_v1(inv[1],code_ana);
  ASSERT view->'hint'->>'name'='Ána', 'a different link is offered as a change while unlocked';
  res:=public.casa_set_referrer_v1(inv[1],code_ana,'enlace');
  ASSERT res->>'error'='REFERRAL_EXISTS' AND res->'referrer'->>'name'='Juan Pérez', 'opening another link never replaces the referrer: '||res::text;
  FOR i IN 1..4 LOOP PERFORM pg_temp.ref_pay(p,inv[i],admin_id,'a'); END LOOP;
  view:=public.casa_referral_polla_view_v1(juan,p);
  ASSERT (view->>'counted')::integer=4 AND (view->>'earned')::integer=0 AND view->>'code'=code_juan, view::text;
  e5:=public.casa_begin_entry_proof_v3(p,inv[5],gen_random_uuid(),NULL,NULL,repeat('b',64),'image/png',100,2)->>'entry_id';
  INSERT INTO storage.objects(bucket_id,name) SELECT 'payment-proofs',a.proof_path FROM public.casa_entry_proof_attempts a
    JOIN public.casa_entries e ON e.current_proof_attempt_id=a.id WHERE e.id=e5;
  PERFORM public.casa_confirm_entry_proof_v2((SELECT current_proof_attempt_id FROM public.casa_entries WHERE id=e5),inv[5],2);
  view:=public.casa_referral_polla_view_v1(juan,p);
  ASSERT (view->>'counted')::integer=4 AND (view->>'in_review')::integer=1, view::text;
  PERFORM pg_temp.ref_review(e5,admin_id);
  view:=public.casa_referral_polla_view_v1(juan,p);
  ASSERT (view->>'counted')::integer=5 AND (view->>'earned')::integer=1 AND NOT (view->>'owner_paid')::boolean
    AND (view->>'active_gifts')::integer=0, view::text;
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_entries WHERE polla_id=p AND user_id=juan), 'no gift before the referrer pays';
  juan_e:=pg_temp.ref_pay(p,juan,admin_id,'c');
  SELECT id INTO gift FROM public.casa_entries WHERE polla_id=p AND user_id=juan AND origin='invitacion';
  ASSERT gift IS NOT NULL, 'the gift appears on its own';
  ASSERT (SELECT status='pagada' AND amount_cop=0 AND entry_number=2 AND proof_path IS NULL
    FROM public.casa_entries WHERE id=gift), 'gift shape';
  ASSERT (SELECT count(*) FROM public.casa_leaderboard(p) WHERE user_id=juan)=2, 'the gift competes';
  ASSERT (SELECT gross_cop FROM public.casa_polla_pot(p))=120000, 'the gift adds no money';
  ASSERT (SELECT paid_entries FROM public.casa_polla_pot(p))=7;
  ASSERT public.casa_my_entry_v2(p,juan)->>'origin'='compra', 'the main entry is a purchase';
  ASSERT (SELECT locked_at IS NOT NULL AND counted_polla_id=p FROM public.casa_referrals WHERE referred_user_id=inv[1]);
  res:=public.casa_set_referrer_v1(inv[1],code_ana,'codigo');
  ASSERT res->>'error'='REFERRAL_LOCKED', res::text;
  view:=public.casa_referral_invitee_v1(inv[1],code_ana);
  ASSERT NOT (view->>'can_set_referrer')::boolean AND view->'hint'='null'::jsonb, view::text;
  SELECT match_id INTO mid FROM public.casa_polla_matches WHERE polla_id=p;
  INSERT INTO public.casa_picks(polla_id,entry_id,user_id,match_id,home_score,away_score) VALUES(p,gift,juan,mid,2,1);
  RAISE NOTICE 'PASS five new people grant one gift automatically, whatever the order';

  -- 4) Otra polla: el conteo empieza de cero y los mismos invitados ya no cuentan.
  q:=pg_temp.ref_polla(admin_id,'Otra polla ref');
  PERFORM pg_temp.ref_pay(q,juan,admin_id,'d');
  FOR i IN 1..5 LOOP PERFORM pg_temp.ref_pay(q,inv[i],admin_id,'e'); END LOOP;
  view:=public.casa_referral_polla_view_v1(juan,q);
  ASSERT (view->>'counted')::integer=0 AND (view->>'active_gifts')::integer=0, view::text;
  -- Un invitado nuevo de Juan que empieza en q sí cuenta allí (y dispara el recuento),
  -- pero los cinco de p siguen sin contar: 1 de 5, sin regalo.
  x:=pg_temp.ref_user('Invitado q');
  ASSERT (public.casa_set_referrer_v1(x,code_juan,'enlace')->>'ok')::boolean;
  PERFORM pg_temp.ref_pay(q,x,admin_id,'f');
  view:=public.casa_referral_polla_view_v1(juan,q);
  ASSERT (view->>'counted')::integer=1, view::text;
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_entries WHERE polla_id=q AND origin='invitacion'), 'people counted in p do not count again in q';
  RAISE NOTICE 'PASS the count resets per pool and each invitee counts once';

  -- 5) Desmarcar pausa el regalo con sus pronósticos; aprobar otra vez lo reactiva.
  PERFORM pg_temp.ref_unpay(e5,admin_id);
  ASSERT (SELECT status FROM public.casa_entries WHERE id=gift)='anulada';
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_leaderboard(p) WHERE entry_id=gift);
  ASSERT EXISTS(SELECT 1 FROM public.casa_picks WHERE entry_id=gift), 'paused gift keeps its picks';
  PERFORM pg_temp.ref_must_fail(format('UPDATE public.casa_picks SET home_score=3 WHERE entry_id=%L',gift),'inscribirte');
  PERFORM pg_temp.ref_must_fail(format('SELECT public.casa_begin_entry_proof_v3(%L,%L,%L,NULL,2,%L,''image/png'',100,2)',
    p,juan,gen_random_uuid(),repeat('f',64)),'GIFT_ENTRY');
  res:=public.casa_begin_entry_proof_v3(p,juan,gen_random_uuid(),NULL,NULL,repeat('f',64),'image/png',100,2);
  ASSERT (res->>'entry_number')::integer=3 AND (res->>'entry_id')::uuid<>gift, 'a paused gift is never reused: '||res::text;
  PERFORM public.casa_fail_entry_proof_v2((res->>'attempt_id')::uuid,juan,2);
  res:=public.casa_begin_entry_proof_v2(p,juan,gen_random_uuid(),NULL,repeat('9',64),'image/png',100,2);
  ASSERT (res->>'entry_number')::integer=3, 'the bot path ignores gifts: '||res::text;
  PERFORM public.casa_fail_entry_proof_v2((res->>'attempt_id')::uuid,juan,2);
  PERFORM pg_temp.ref_review(e5,admin_id);
  ASSERT (SELECT status FROM public.casa_entries WHERE id=gift)='pagada', 'approving again restores the gift';
  ASSERT (SELECT count(*) FROM public.casa_entries WHERE polla_id=p AND user_id=juan AND origin='invitacion')=1;
  ASSERT (SELECT home_score FROM public.casa_picks WHERE entry_id=gift)=2;
  RAISE NOTICE 'PASS unmark pauses, approve restores, the gift number never takes a receipt';

  -- 6) Tope por persona: el regalo cuenta y espera espacio.
  PERFORM public.casa_set_max_entries_v2(p,2,admin_id,2);
  PERFORM pg_temp.ref_unpay(e5,admin_id);
  x:=pg_temp.ref_pay(p,juan,admin_id,'7');
  ASSERT (SELECT entry_number FROM public.casa_entries WHERE id=x)=3;
  PERFORM pg_temp.ref_review(e5,admin_id);
  ASSERT (SELECT status FROM public.casa_entries WHERE id=gift)='anulada', 'the gift waits: the person is at the cap';
  view:=public.casa_referral_polla_view_v1(juan,p);
  ASSERT (view->>'earned')::integer=1 AND (view->>'active_gifts')::integer=0 AND (view->>'slots_left')::integer=0
    AND (view->>'gifts')::integer=1 AND (view->>'waiting_gifts')::integer=1, view::text;
  PERFORM public.casa_set_max_entries_v2(p,3,admin_id,2);
  ASSERT (SELECT status FROM public.casa_entries WHERE id=gift)='pagada', 'raising the cap releases the gift';
  PERFORM pg_temp.ref_must_fail(format('SELECT public.casa_begin_entry_proof_v3(%L,%L,%L,NULL,NULL,%L,''image/png'',100,2)',
    p,juan,gen_random_uuid(),repeat('8',64)),'MAX_ENTRIES');
  RAISE NOTICE 'PASS the gift counts toward the per-person cap';

  -- 7) Remover y restaurar (solo administradores). Removido no vuelve solo.
  PERFORM pg_temp.ref_must_fail(format('SELECT public.casa_referral_remove_gift_v1(%L,''x'',%L,2)',gift,juan),'ADMIN_REQUIRED');
  PERFORM pg_temp.ref_must_fail(format('SELECT public.casa_referral_remove_gift_v1(%L,''x'',%L,2)',juan_e,admin_id),'GIFT_NOT_FOUND');
  PERFORM pg_temp.ref_must_fail(format('SELECT public.casa_referral_remove_gift_v1(%L,''  '',%L,2)',gift,admin_id),'INVALID_REASON');
  res:=public.casa_referral_remove_gift_v1(gift,'Varias cuentas de la misma persona',admin_id,2);
  ASSERT (res->>'changed')::boolean AND (SELECT status FROM public.casa_entries WHERE id=gift)='anulada', res::text;
  -- Un regalo en pausa solo lo protege casa_referral_entry_guard.
  PERFORM pg_temp.ref_must_fail(format('UPDATE public.casa_entries SET status=''pagada'' WHERE id=%L',gift),'REFERRAL_ENTRY_LOCKED');
  ASSERT NOT (public.casa_referral_remove_gift_v1(gift,'otra vez',admin_id,2)->>'changed')::boolean;
  PERFORM pg_temp.ref_unpay(e5,admin_id);
  PERFORM pg_temp.ref_review(e5,admin_id);
  ASSERT (SELECT status FROM public.casa_entries WHERE id=gift)='anulada', 'a removed gift does not come back by itself';
  ASSERT (SELECT count(*) FROM public.casa_entries WHERE polla_id=p AND user_id=juan AND origin='invitacion')=1, 'no replacement gift';
  ASSERT (SELECT jsonb_array_length(public.casa_referral_gifts_admin_v1(p,admin_id)))=1;
  ASSERT (SELECT public.casa_referral_gifts_admin_v1(p,admin_id)->0->>'invitados')='5';
  PERFORM pg_temp.ref_must_fail(format('SELECT public.casa_referral_gifts_admin_v1(%L,%L)',p,juan),'ADMIN_REQUIRED');
  res:=public.casa_referral_restore_gift_v1(gift,admin_id,2);
  ASSERT (res->>'active')::boolean, res::text;
  RAISE NOTICE 'PASS admin removal sticks until restored';

  -- 8) Nadie escribe un cupo de regalo por fuera del conteo.
  PERFORM pg_temp.ref_must_fail(format('UPDATE public.casa_entries SET reject_reason=''x'' WHERE id=%L',gift),'REFERRAL_ENTRY_LOCKED');
  -- Cada capa por separado: el parche de casa_v2_write_guard también bloquea un regalo pagado.
  ALTER TABLE public.casa_entries DISABLE TRIGGER casa_02_referral_guard;
  PERFORM pg_temp.ref_must_fail(format('UPDATE public.casa_entries SET reject_reason=''x'' WHERE id=%L',gift),'REFERRAL_ENTRY_LOCKED');
  ALTER TABLE public.casa_entries ENABLE TRIGGER casa_02_referral_guard;
  PERFORM pg_temp.ref_must_fail(format('INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop,entry_number,origin) VALUES(%L,%L,''pagada'',0,9,''invitacion'')',
    p,ana),'REFERRAL_ENTRY_LOCKED');
  x:=(public.casa_begin_entry_proof_v3(q,ana,gen_random_uuid(),NULL,NULL,repeat('2',64),'image/png',100,2)->>'entry_id')::uuid;
  PERFORM pg_temp.ref_must_fail(format('UPDATE public.casa_entries SET origin=''invitacion'' WHERE id=%L',x),'ENTRY_ORIGIN_IMMUTABLE');
  PERFORM set_config('app.casa_referral_sync',(SELECT id::text FROM public.casa_referral_events
    WHERE entry_id IS NOT NULL AND entry_id<>gift ORDER BY created_at LIMIT 1),true);
  PERFORM pg_temp.ref_must_fail(format('UPDATE public.casa_entries SET status=''anulada'' WHERE id=%L',gift),'REFERRAL_ENTRY_LOCKED');
  PERFORM set_config('app.casa_referral_sync','',true);
  RAISE NOTICE 'PASS gift rows are written only by the referral count';

  -- 9) Primer pago en una polla sin programa, rifa o gratis: el vínculo se fija
  --    (salvo gratis) y la persona cuenta en su primera polla con invitaciones.
  off_p:=pg_temp.ref_polla(admin_id,'Sin programa ref',NULL);
  free_p:=pg_temp.ref_polla(admin_id,'Gratis ref',5,0);
  rifa_p:=gen_random_uuid();
  INSERT INTO public.casa_pollas(id,slug,name,kind,status,closes_at,created_by,entry_price_cop,payout_method,payout_account,ticket_count,draw_method)
    VALUES(rifa_p,'ref-rifa-'||rifa_p,'Rifa ref','rifa','abierta',clock_timestamp()+interval '2 hours',admin_id,5000,'otro','fixture',100,'Sorteo');
  ASSERT (SELECT referral_every FROM public.casa_pollas WHERE id=rifa_p)=5, 'new pools get the default';
  ASSERT public.casa_referral_every((SELECT c FROM public.casa_pollas c WHERE c.id=rifa_p)) IS NULL, 'raffles never participate';
  ASSERT public.casa_referral_every((SELECT c FROM public.casa_pollas c WHERE c.id=free_p)) IS NULL, 'free pools never participate';
  ASSERT public.casa_referral_every((SELECT c FROM public.casa_pollas c WHERE c.id=off_p)) IS NULL;
  x:=pg_temp.ref_user('Carla');
  ASSERT (public.casa_set_referrer_v1(x,code_ana,'codigo')->>'ok')::boolean;
  PERFORM pg_temp.ref_pay(rifa_p,x,admin_id,'1',7);
  ASSERT (SELECT locked_at IS NOT NULL AND counted_polla_id IS NULL FROM public.casa_referrals WHERE referred_user_id=x),
    'a raffle payment locks the referrer but does not count';
  PERFORM pg_temp.ref_pay(off_p,x,admin_id,'2');
  ASSERT (SELECT counted_polla_id IS NULL FROM public.casa_referrals WHERE referred_user_id=x);
  PERFORM pg_temp.ref_pay(q,x,admin_id,'3');
  ASSERT (SELECT counted_polla_id FROM public.casa_referrals WHERE referred_user_id=x)=q, 'the first eligible pool counts';
  y:=pg_temp.ref_user('Fer');
  ASSERT (public.casa_set_referrer_v1(y,code_juan,'codigo')->>'ok')::boolean;
  PERFORM pg_temp.ref_pay(free_p,y,admin_id,'4');
  ASSERT (SELECT locked_at IS NULL FROM public.casa_referrals WHERE referred_user_id=y), 'a free entry is not a payment';
  ASSERT (public.casa_set_referrer_v1(y,code_ana,'codigo')->>'changed')::boolean;
  PERFORM pg_temp.ref_unpay((SELECT id FROM public.casa_entries WHERE polla_id=free_p AND user_id=y),admin_id);
  ASSERT public.casa_referral_is_new_user(y), 'correcting a free entry keeps the person new';
  RAISE NOTICE 'PASS first eligible pool anchors; raffles, free pools and pools without the program never grant';

  -- 10) Un pago aprobado (aunque luego se desmarque) quita la condición de persona nueva.
  x:=pg_temp.ref_user('Diego');
  PERFORM pg_temp.ref_pay(q,x,admin_id,'5');
  res:=public.casa_set_referrer_v1(x,code_juan,'codigo');
  ASSERT res->>'error'='NOT_NEW_USER', res::text;
  y:=pg_temp.ref_user('Elena');
  PERFORM pg_temp.ref_unpay(pg_temp.ref_pay(q,y,admin_id,'6'),admin_id);
  res:=public.casa_set_referrer_v1(y,code_juan,'codigo');
  ASSERT res->>'error'='NOT_NEW_USER', res::text;
  RAISE NOTICE 'PASS new-user rule';

  -- 11) Diez invitados → dos regalos; el pozo solo suma el dinero.
  r2:=pg_temp.ref_polla(admin_id,'Diez ref');
  PERFORM pg_temp.ref_pay(r2,ana,admin_id,'6');
  FOR i IN 1..10 LOOP
    x:=pg_temp.ref_user('Nuevo '||i);
    ASSERT (public.casa_set_referrer_v1(x,code_ana,'enlace')->>'ok')::boolean;
    PERFORM pg_temp.ref_pay(r2,x,admin_id,'a');
  END LOOP;
  ASSERT (SELECT count(*) FROM public.casa_entries WHERE polla_id=r2 AND user_id=ana AND origin='invitacion' AND status='pagada')=2;
  ASSERT (SELECT gross_cop FROM public.casa_polla_pot(r2))=220000;
  view:=public.casa_referral_profile_v1(ana);
  -- Carla, Fer (cambió a Ana antes de pagar) y los diez nuevos.
  ASSERT (view->>'invited')::integer=12 AND (view->>'gifts')::integer=2 AND view->>'code'=code_ana, view::text;
  RAISE NOTICE 'PASS every five invitees add one gift';

  -- 12) Reparto: un cupo de regalo puede ganar; el premio sale del dinero que entró.
  PERFORM public.casa_change_status_v2(p,'cerrar',2,admin_id,NULL);
  UPDATE public.matches SET status='finished',home_score=2,away_score=1,final_verified_at=clock_timestamp() WHERE id=mid;
  ASSERT (SELECT entry_id FROM public.casa_leaderboard(p) ORDER BY points DESC LIMIT 1)=gift;
  settle:=public.casa_settle_polla_v2(p,2,admin_id,NULL);
  ASSERT settle->>'outcome'='money_awarded', settle::text;
  ASSERT (settle->>'prize_cop')::bigint=98000, settle::text;
  ASSERT (SELECT amount_cop FROM public.casa_payouts WHERE polla_id=p AND user_id=juan)=98000;
  PERFORM pg_temp.ref_must_fail(format('SELECT public.casa_referral_remove_gift_v1(%L,''x'',%L,2)',gift,admin_id),'POLLA_FINAL');
  RAISE NOTICE 'PASS a gift can win; the prize comes only from real money';

  -- 13) Interruptor por polla: solo sin inscripciones.
  PERFORM pg_temp.ref_must_fail(format('SELECT public.casa_set_referral_every_v1(%L,NULL,%L,2)',q,admin_id),'POLLA_HAS_ENTRIES');
  PERFORM pg_temp.ref_must_fail(format('SELECT public.casa_set_referral_every_v1(%L,7,%L,2)',rifa_p,admin_id),'INVALID_POLLA_KIND');
  x:=pg_temp.ref_polla(admin_id,'Vacía ref');
  ASSERT (public.casa_set_referral_every_v1(x,NULL,admin_id,2)->>'changed')::boolean;
  ASSERT (SELECT referral_every FROM public.casa_pollas WHERE id=x) IS NULL;
  PERFORM pg_temp.ref_must_fail(format('SELECT public.casa_set_referral_every_v1(%L,5,%L,2)',x,juan),'ADMIN_REQUIRED');
  RAISE NOTICE 'PASS per-pool switch';

  -- 14) Permisos: solo el servidor.
  ASSERT NOT has_function_privilege('authenticated','public.casa_set_referrer_v1(uuid,text,text)','EXECUTE');
  ASSERT NOT has_function_privilege('anon','public.casa_referral_polla_view_v1(uuid,uuid)','EXECUTE');
  ASSERT has_function_privilege('service_role','public.casa_set_referrer_v1(uuid,text,text)','EXECUTE');
  ASSERT NOT has_function_privilege('service_role','public.casa_referral_sync(uuid,uuid)','EXECUTE');
  ASSERT NOT has_function_privilege('service_role','public.casa_referral_can_refer(uuid)','EXECUTE');
  ASSERT NOT has_function_privilege('service_role','public.casa_referral_lock_unsettled(uuid)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.casa_referral_is_new_user(uuid)','EXECUTE');
  ASSERT NOT has_function_privilege('service_role','public.casa_referral_log(text,uuid,uuid,uuid,uuid,uuid,jsonb)','EXECUTE');
  ASSERT has_table_privilege('service_role','public.casa_referrals','SELECT');
  ASSERT NOT has_table_privilege('service_role','public.casa_referrals','INSERT');
  ASSERT NOT has_table_privilege('service_role','public.casa_referral_events','INSERT');
  ASSERT NOT has_table_privilege('service_role','public.casa_referral_gift_removals','UPDATE');
  ASSERT NOT has_table_privilege('authenticated','public.casa_referral_codes','SELECT');
  RAISE NOTICE 'PASS server-only permissions';

  -- 15) Los regalos van en fila por número: remover descuenta justo ese regalo.
  s:=pg_temp.ref_polla(admin_id,'Fila ref');
  PERFORM pg_temp.ref_pay(s,ana,admin_id,'b');
  FOR i IN 1..10 LOOP
    x:=pg_temp.ref_user('Fila '||i);
    ASSERT (public.casa_set_referrer_v1(x,code_ana,'enlace')->>'ok')::boolean;
    sv:=sv||pg_temp.ref_pay(s,x,admin_id,'c');
  END LOOP;
  SELECT id INTO g1 FROM public.casa_entries WHERE polla_id=s AND user_id=ana AND origin='invitacion' AND entry_number=2;
  SELECT id INTO g2 FROM public.casa_entries WHERE polla_id=s AND user_id=ana AND origin='invitacion' AND entry_number=3;
  ASSERT g1 IS NOT NULL AND g2 IS NOT NULL, 'ten invitees, two gifts';
  -- a) Remover el #3 y después desmarcar a un invitado: el #2 sigue activo.
  PERFORM public.casa_referral_remove_gift_v1(g2,'Pago mal aprobado',admin_id,2);
  PERFORM pg_temp.ref_unpay(sv[1],admin_id);
  ASSERT (SELECT status FROM public.casa_entries WHERE id=g1)='pagada', 'removing #3 then losing an invitee keeps #2';
  ASSERT (SELECT status FROM public.casa_entries WHERE id=g2)='anulada';
  ASSERT (SELECT counted_polla_id IS NULL AND locked_at IS NOT NULL FROM public.casa_referrals
    WHERE referred_user_id=(SELECT user_id FROM public.casa_entries WHERE id=sv[1])), 'the unpaid invitee is released';
  -- b) Restaurar con un solo regalo ganado lo deja en pausa; vuelve con el pago.
  res:=public.casa_referral_restore_gift_v1(g2,admin_id,2);
  ASSERT (res->>'changed')::boolean AND NOT (res->>'active')::boolean, res::text;
  PERFORM pg_temp.ref_review(sv[1],admin_id);
  ASSERT (SELECT status FROM public.casa_entries WHERE id=g2)='pagada', 'the restored gift returns once earned';
  -- c) Remover el activo mientras otro está en pausa: nadie ocupa su lugar.
  PERFORM pg_temp.ref_unpay(sv[1],admin_id);
  ASSERT (SELECT status FROM public.casa_entries WHERE id=g1)='pagada' AND (SELECT status FROM public.casa_entries WHERE id=g2)='anulada',
    'losing an invitee pauses the last gift';
  PERFORM public.casa_referral_remove_gift_v1(g1,'Varias cuentas',admin_id,2);
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_entries WHERE polla_id=s AND user_id=ana AND origin='invitacion' AND status='pagada'),
    'a paused gift never takes the place of a removed one';
  view:=public.casa_referral_polla_view_v1(ana,s);
  ASSERT (view->>'earned')::integer=1 AND (view->>'gifts')::integer=0 AND (view->>'waiting_gifts')::integer=0, view::text;
  -- d) Remover uno en pausa no toca a los demás.
  PERFORM public.casa_referral_remove_gift_v1(g2,'Otra razón',admin_id,2);
  PERFORM public.casa_referral_restore_gift_v1(g1,admin_id,2);
  ASSERT (SELECT status FROM public.casa_entries WHERE id=g1)='pagada' AND (SELECT status FROM public.casa_entries WHERE id=g2)='anulada';
  -- e) Con el conteo completo, el removido sigue descontando; cinco más crean otro.
  PERFORM pg_temp.ref_review(sv[1],admin_id);
  ASSERT (SELECT count(*) FROM public.casa_entries WHERE polla_id=s AND user_id=ana AND origin='invitacion')=2
    AND (SELECT status FROM public.casa_entries WHERE id=g2)='anulada', 'a removed gift is not replaced';
  FOR i IN 11..15 LOOP
    x:=pg_temp.ref_user('Fila '||i);
    ASSERT (public.casa_set_referrer_v1(x,code_ana,'enlace')->>'ok')::boolean;
    PERFORM pg_temp.ref_pay(s,x,admin_id,'d');
  END LOOP;
  ASSERT (SELECT count(*) FROM public.casa_entries WHERE polla_id=s AND user_id=ana AND origin='invitacion' AND status='pagada')=2
    AND EXISTS(SELECT 1 FROM public.casa_entries WHERE polla_id=s AND user_id=ana AND origin='invitacion'
      AND entry_number=4 AND status='pagada'), 'fifteen invitees with one removal: two active gifts';
  view:=public.casa_referral_polla_view_v1(ana,s);
  ASSERT (view->>'earned')::integer=3 AND (view->>'gifts')::integer=2 AND (view->>'waiting_gifts')::integer=0
    AND (view->>'removed_gifts')::integer=1, view::text;
  ASSERT (SELECT bool_and(jsonb_array_length(g->'nombres')=(g->>'invitados')::integer)
    FROM jsonb_array_elements(public.casa_referral_gifts_admin_v1(s,admin_id)) g), 'the names match the count';
  -- f) Después del reparto no se remueve ni se restaura.
  PERFORM public.casa_change_status_v2(s,'cerrar',2,admin_id,NULL);
  UPDATE public.casa_pollas SET settled_at=clock_timestamp() WHERE id=s;
  PERFORM pg_temp.ref_must_fail(format('SELECT public.casa_referral_restore_gift_v1(%L,%L,2)',g2,admin_id),'ALREADY_SETTLED');
  PERFORM pg_temp.ref_must_fail(format('SELECT public.casa_referral_remove_gift_v1(%L,''x'',%L,2)',g1,admin_id),'ALREADY_SETTLED');
  UPDATE public.casa_pollas SET settled_at=NULL WHERE id=s;
  RAISE NOTICE 'PASS removing a gift discounts exactly that gift';

  -- 16) Persona nueva según su cuenta de acceso: reescribir public.users.created_at no sirve.
  x:=pg_temp.ref_user('Cuenta vieja 2',true);
  UPDATE public.users SET created_at=clock_timestamp() WHERE id=x;
  res:=public.casa_set_referrer_v1(x,code_juan,'codigo');
  ASSERT res->>'error'='NOT_NEW_USER', res::text;
  y:=gen_random_uuid();
  INSERT INTO public.users(id,whatsapp_number,display_name,avatar_url)
    VALUES(y,'1666'||lpad(floor(random()*1e10)::bigint::text,10,'0'),'Sin cuenta de acceso','millos');
  ASSERT NOT public.casa_referral_is_new_user(y), 'without an auth account nobody is new';
  RAISE NOTICE 'PASS new people are decided by the auth account';

  -- 17) Administradores: sin código; uno de antes deja de invitar y de sumar regalos.
  PERFORM pg_temp.ref_must_fail(format('SELECT public.casa_referral_code_v1(%L)',admin_id),'REFERRAL_NOT_AVAILABLE');
  ASSERT public.casa_referral_profile_v1(admin_id)->'code'='null'::jsonb;
  ASSERT public.casa_referral_polla_view_v1(admin_id,q)->'code'='null'::jsonb;
  x:=pg_temp.ref_user('Futura admin');
  code_x:=public.casa_referral_code_v1(x);
  UPDATE public.users SET is_admin=true WHERE id=x;
  y:=pg_temp.ref_user('Invitada de admin');
  ASSERT public.casa_referral_invitee_v1(y,code_x)->'hint'='null'::jsonb;
  res:=public.casa_set_referrer_v1(y,code_x,'enlace');
  ASSERT res->>'error'='REFERRAL_CODE_NOT_FOUND', res::text;
  ASSERT (SELECT count(*) FROM public.casa_entries WHERE polla_id=r2 AND user_id=ana AND origin='invitacion' AND status='pagada')=2;
  UPDATE public.users SET is_admin=true WHERE id=ana;
  PERFORM public.casa_set_max_entries_v2(r2,9,admin_id,2);
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_entries WHERE polla_id=r2 AND user_id=ana AND origin='invitacion' AND status='pagada'),
    'an admin keeps no gifts';
  UPDATE public.users SET is_admin=false WHERE id=ana;
  RAISE NOTICE 'PASS admins neither invite nor collect gifts';

  -- 18) Si se desmarca el pago que ancla a un invitado, cuenta con su otro cupo pagado
  --     ahí o, si no le queda ninguno, en la próxima polla donde pague.
  t1:=pg_temp.ref_polla(admin_id,'Ancla 1 ref');
  t2:=pg_temp.ref_polla(admin_id,'Ancla 2 ref');
  u:=pg_temp.ref_user('Gabriela');
  ASSERT (public.casa_set_referrer_v1(u,code_juan,'enlace')->>'ok')::boolean;
  x:=pg_temp.ref_pay(t1,u,admin_id,'e');
  y:=pg_temp.ref_pay(t1,u,admin_id,'f');
  ASSERT (SELECT counted_polla_id=t1 AND counted_entry_id=x FROM public.casa_referrals WHERE referred_user_id=u);
  PERFORM pg_temp.ref_unpay(x,admin_id);
  ASSERT (SELECT counted_polla_id=t1 AND counted_entry_id=y FROM public.casa_referrals WHERE referred_user_id=u),
    'the anchor moves to the other paid cupo';
  PERFORM pg_temp.ref_unpay(y,admin_id);
  ASSERT (SELECT counted_polla_id IS NULL AND counted_entry_id IS NULL AND locked_at IS NOT NULL
    FROM public.casa_referrals WHERE referred_user_id=u), 'released, the referrer stays fixed';
  PERFORM pg_temp.ref_pay(t2,u,admin_id,'0');
  ASSERT (SELECT counted_polla_id FROM public.casa_referrals WHERE referred_user_id=u)=t2, 'counts in the next paid pool';
  RAISE NOTICE 'PASS a reversed anchor moves or is released';
END $$;
ROLLBACK;
