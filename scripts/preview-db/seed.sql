-- PREVIEW ONLY (scripts/preview-db/replay.mjs). Synthetic data: three fake
-- users created through Auth (*.invalid emails), three future matches and one
-- published Casa polla with no entries, payments or picks. :admin_id is
-- replaced by the synthetic administrator's id. Never run on production.
DO $$
DECLARE m1 uuid; m2 uuid; m3 uuid; poll jsonb;
BEGIN
  PERFORM public.casa_v2_context(2);
  m1 := public.upsert_match_safe('preview:1','premier_2025',1,'league','Arsenal','Chelsea',NULL,NULL,date_trunc('hour',now())+interval '5 days',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);
  m2 := public.upsert_match_safe('preview:2','premier_2025',1,'league','Liverpool','Manchester City',NULL,NULL,date_trunc('hour',now())+interval '5 days 2 hours',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);
  m3 := public.upsert_match_safe('preview:3','premier_2025',1,'league','Tottenham','Newcastle',NULL,NULL,date_trunc('hour',now())+interval '6 days',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);
  poll := public.casa_create_polla_v2(jsonb_build_object(
    'name','Polla de prueba','kind','partidos','tournament','premier_2025','scoringMode','marcador',
    'prizeKind','pozo','entryPriceCop',10000,'houseCutPct',30,'closesAt',date_trunc('hour',now())+interval '4 days',
    'closeMode','manual','publicationMode','ahora','payoutMethod','otro','payoutAccount','Cuenta de prueba',
    'matchIds',jsonb_build_array(m1,m2,m3)),'polla-de-prueba',:admin_id,2);
  RAISE NOTICE 'preview polla %', poll->>'id';
END $$;
