-- Run inside a transaction, after migration 153. Rolls back ONLY its own fixtures.
BEGIN;
DO $$
<<sms_campaigns_check>>
DECLARE owner_id uuid; pool_id uuid; campaign_id uuid:=gen_random_uuid(); claim boolean;
BEGIN
  SELECT id INTO owner_id FROM public.users WHERE is_admin ORDER BY id LIMIT 1;
  SELECT id INTO pool_id FROM public.casa_pollas ORDER BY id LIMIT 1;
  IF owner_id IS NULL OR pool_id IS NULL THEN RAISE EXCEPTION 'Test requires one admin and pool'; END IF;
  ASSERT NOT has_table_privilege('authenticated','public.sms_campaigns','SELECT');
  ASSERT NOT has_table_privilege('anon','public.sms_campaign_recipients','SELECT');
  ASSERT NOT has_function_privilege('authenticated','public.claim_sms_campaign(uuid,uuid,numeric)','EXECUTE');
  ASSERT NOT has_function_privilege('anon','public.ack_sms_campaign(text,text,boolean)','EXECUTE');
  INSERT INTO public.sms_campaigns(id,created_by,polla_id,template,message,subid,fingerprint,audience,recipient_count,segments,credits)
    VALUES(campaign_id,owner_id,pool_id,'opening','TEST - NEVER SEND','test-sms-sql','test-'||campaign_id,'{}',1,1,1);
  INSERT INTO public.sms_campaign_recipients(campaign_id,user_id,phone,country) VALUES(campaign_id,owner_id,'+570000000000','CO');
  ASSERT NOT public.claim_sms_campaign(campaign_id,gen_random_uuid(),1000000), 'Wrong owner must fail';
  ASSERT public.claim_sms_campaign(campaign_id,owner_id,1000000), 'First claim must succeed';
  ASSERT NOT public.claim_sms_campaign(campaign_id,owner_id,1000000), 'Double-click must fail';
  PERFORM public.ack_sms_campaign('test-sms-sql','+570000000000',true);
  PERFORM public.ack_sms_campaign('test-sms-sql','+570000000000',false);
  ASSERT (SELECT r.state='delivered' FROM public.sms_campaign_recipients r WHERE r.campaign_id=sms_campaigns_check.campaign_id);
END $$;
ROLLBACK;
