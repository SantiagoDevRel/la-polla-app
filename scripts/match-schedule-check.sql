-- LOCAL ONLY. Every fixture belongs to this rollback-only regression suite.
BEGIN;
DO $$
DECLARE original uuid; confirmed uuid; result_time timestamptz; precise boolean; ambiguous boolean:=false;
BEGIN
 original:=public.upsert_match_safe('schedule-test:date','schedule_test',6,'regular_season',
   'Schedule Home','Schedule Away',null,null,'2030-09-16 00:00Z',null,null,null,'scheduled',null,null,null,false);
 SELECT scheduled_at_confirmed INTO precise FROM matches WHERE id=original;
 ASSERT precise=false, 'Provisional precision lost';
 confirmed:=public.upsert_match_safe('espn:schedule-test-confirmed','schedule_test',6,'regular_season',
   'Schedule Home','Schedule Away',null,null,'2030-09-16 19:30Z',null,null,null,'scheduled',null,null,null,true);
 ASSERT confirmed=original, 'Date-only to timed created a duplicate';
 SELECT scheduled_at,scheduled_at_confirmed INTO result_time,precise FROM matches WHERE id=original;
 ASSERT result_time='2030-09-16 19:30Z'::timestamptz AND precise, 'Confirmed kickoff not stored';
 PERFORM public.upsert_match_safe('schedule-test:date','schedule_test',6,'regular_season',
   'Schedule Home','Schedule Away',null,null,'2030-09-16 00:00Z',null,null,null,'scheduled',null,null,null,false);
 SELECT scheduled_at,scheduled_at_confirmed INTO result_time,precise FROM matches WHERE id=original;
 ASSERT result_time='2030-09-16 19:30Z'::timestamptz AND precise, 'Provisional feed overwrote confirmed kickoff';

 -- Legacy clients keep the 16-argument signature and cannot reintroduce midnight.
 original:=public.upsert_match_safe('998877661','schedule_test',7,'regular_season',
   'Legacy Home','Legacy Away',null,null,'2030-09-20 00:00Z',null,null,null,'scheduled',null,null,null);
 SELECT scheduled_at_confirmed INTO precise FROM matches WHERE id=original;
 ASSERT NOT precise, 'Legacy midnight must remain provisional';
 PERFORM public.upsert_match_safe('998877661','schedule_test',7,'regular_season',
   'Legacy Home','Legacy Away',null,null,'2030-09-21 17:00Z',null,null,null,'scheduled',null,null,null,true);
 PERFORM public.upsert_match_safe('998877661','schedule_test',7,'regular_season',
   'Legacy Home','Legacy Away',null,null,'2030-09-20 00:00Z',null,null,null,'scheduled',null,null,null);
 SELECT scheduled_at INTO result_time FROM matches WHERE id=original;
 ASSERT result_time='2030-09-21 17:00Z'::timestamptz, 'Legacy update erased confirmation';

 -- Midnight itself can be a real kickoff: explicit precision wins over heuristics.
 original:=public.upsert_match_safe('998877662','schedule_test',7,'regular_season',
   'Midnight Home','Midnight Away',null,null,'2030-09-21 00:00Z',null,null,null,'scheduled',null,null,null,true);
 SELECT scheduled_at_confirmed INTO precise FROM matches WHERE id=original;
 ASSERT precise, 'Actual midnight kickoff marked provisional';

 -- Confirmed reschedules from a second provider link once and retain BOTH IDs.
 original:=public.upsert_match_safe('espn:schedule-test:alias','schedule_test',10,'regular_season',
   'Alias Home','Alias Away',null,null,'2030-10-01 17:00Z',null,null,null,'scheduled',null,null,null,true);
 confirmed:=public.upsert_match_safe('998877663','schedule_test',10,'regular_season',
   'Alias Home','Alias Away',null,null,'2030-10-02 20:00Z',null,null,null,'scheduled',null,null,null,true);
 ASSERT confirmed=original, 'Confirmed reschedule >2 hours duplicated across providers';
 confirmed:=public.upsert_match_safe('998877663','schedule_test',10,'regular_season',
   'Alias Home','Alias Away',null,null,'2030-10-20 20:00Z',null,null,null,'scheduled',null,null,null,true);
 ASSERT confirmed=original, 'FD alias lost after linking to ESPN';
 SELECT scheduled_at INTO result_time FROM matches WHERE id=original;
 ASSERT result_time='2030-10-20 20:00Z'::timestamptz, 'Known provider cannot reschedule';

 -- Different legs of the same pair stay different; ambiguous provisional matches fail closed.
 PERFORM public.upsert_match_safe('schedule-test:leg1','schedule_test',8,'regular_season',
   'Leg Home','Leg Away',null,null,'2030-09-23 17:00Z',null,null,null,'scheduled',null,null,null,true);
 PERFORM public.upsert_match_safe('schedule-test:leg2','schedule_test',9,'regular_season',
   'Leg Home','Leg Away',null,null,'2030-09-25 17:00Z',null,null,null,'scheduled',null,null,null,true);
 BEGIN
   PERFORM public.upsert_match_safe('schedule-test:ambiguous','schedule_test',null,'regular_season',
     'Leg Home','Leg Away',null,null,'2030-09-24 00:00Z',null,null,null,'scheduled',null,null,null,false);
 EXCEPTION WHEN raise_exception THEN ambiguous:=true;
 END;
 ASSERT ambiguous, 'Ambiguous identity should not update or insert';
 ASSERT (SELECT count(*) FROM matches WHERE tournament='schedule_test' AND home_team='Leg Home')=2;
 ASSERT public.reserve_tournament_schedule_sync('schedule_test_reservation');
 ASSERT NOT public.reserve_tournament_schedule_sync('schedule_test_reservation');
 ASSERT NOT has_function_privilege('anon','public.upsert_match_safe(text,text,integer,text,text,text,text,text,timestamptz,text,integer,integer,text,integer,text,text,boolean)','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','public.reserve_tournament_schedule_sync(text)','EXECUTE');
 RAISE NOTICE 'Schedule precision, identity, legacy compatibility, reservation and permissions passed';
END $$;
ROLLBACK;
