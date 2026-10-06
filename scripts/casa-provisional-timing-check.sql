-- Disposable local database only. Fresh fixtures roll back; no historical data.
\set ON_ERROR_STOP on
BEGIN;
SELECT public.casa_v2_context(2);
DO $$
DECLARE u uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); mid uuid; mid2 uuid; e uuid; msg text; cfg jsonb;
BEGIN
  INSERT INTO public.users(id,whatsapp_number,display_name,is_admin)
    VALUES(u,'+1998'||substr(replace(u::text,'-',''),1,10),'Provisional timing fixture',true);
  mid:=public.upsert_match_safe('provisional-'||u,'premier_2025',1,'league','Fixture home '||u,'Fixture away '||u,
    NULL,NULL,clock_timestamp()+interval '2 hours',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);
  UPDATE public.matches SET scheduled_at=clock_timestamp()-interval '1 hour',scheduled_at_confirmed=false WHERE id=mid;
  cfg:=jsonb_build_object('name','Provisional timing fixture','kind','partidos','tournament','premier_2025',
    'scoringMode','marcador','prizeKind','pozo','entryPriceCop',10000,'houseCutPct',30,
    'closesAt',clock_timestamp()+interval '1 hour','closeMode','auto','publicationMode','ahora',
    'payoutMethod','otro','payoutAccount','synthetic','matchIds',jsonb_build_array(mid));
  p:=(public.casa_create_polla_v2(cfg,'timing-auto-'||p,u,2)->>'id')::uuid;
  ASSERT (SELECT closes_at>clock_timestamp() FROM public.casa_pollas WHERE id=p), 'Provisional timestamp advanced the fallback closure';
  mid2:=public.upsert_match_safe('editor-'||u,'premier_2025',2,'league','Editor home '||u,'Editor away '||u,
    NULL,NULL,clock_timestamp()+interval '2 hours',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);
  UPDATE public.matches SET scheduled_at=clock_timestamp()-interval '1 hour',scheduled_at_confirmed=false WHERE id=mid2;
  PERFORM public.casa_edit_polla_v2(p,'{}'::jsonb,ARRAY[mid2],ARRAY[]::uuid[],u,2);
  ASSERT (SELECT count(*)=2 FROM public.casa_polla_matches WHERE polla_id=p), 'Editor rejected a provisional match';
  INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop) VALUES(p,u,'pagada',10000) RETURNING id INTO e;
  INSERT INTO public.casa_picks(polla_id,entry_id,user_id,match_id,home_score,away_score) VALUES(p,e,u,mid,2,1);
  UPDATE public.casa_picks SET home_score=3 WHERE entry_id=e;
  ASSERT (SELECT home_score=3 FROM public.casa_picks WHERE entry_id=e);
  UPDATE public.matches SET scheduled_at=clock_timestamp()+interval '2 hours' WHERE id=mid;
  ASSERT (SELECT closes_at<clock_timestamp()+interval '90 minutes' FROM public.casa_pollas WHERE id=p), 'Unconfirmed time changed fallback';
  UPDATE public.matches SET scheduled_at_confirmed=true WHERE id=mid;
  ASSERT (SELECT closes_at>clock_timestamp()+interval '110 minutes' FROM public.casa_pollas WHERE id=p), 'Precision-only confirmation did not update closure';
  ASSERT (public.casa_edit_polla_v2(p,'{}'::jsonb,ARRAY[mid2],ARRAY[]::uuid[],u,2)->>'ok')::boolean;
  UPDATE public.matches SET scheduled_at_confirmed=true,scheduled_at=clock_timestamp()+interval '5 minutes' WHERE id=mid;
  BEGIN
    UPDATE public.casa_picks SET home_score=4 WHERE entry_id=e;
    RAISE EXCEPTION 'Confirmed cutoff did not block';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  UPDATE public.matches SET scheduled_at_confirmed=false,status='live',elapsed=1 WHERE id=mid;
  BEGIN
    UPDATE public.casa_picks SET home_score=4 WHERE entry_id=e;
    RAISE EXCEPTION 'Live provisional fixture did not block';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  ASSERT NOT EXISTS(SELECT 1 FROM public.predictions WHERE match_id=mid);
  RAISE NOTICE 'PASS provisional picks, automatic publication with fallback, precision-only sync, confirmed cutoff, live cutoff and untouched historical predictions';
END $$;
ROLLBACK;
