-- Run after migration160. Synthetic attempts only; transaction always rolls back.
BEGIN;
DO $$
DECLARE p text := '991' || lpad((floor(random() * 100000000)::bigint)::text,8,'0');
        ip text := md5(random()::text) || md5(random()::text);
        i integer;
BEGIN
  FOR i IN 1..5 LOOP
    ASSERT public.phone_password_reserve_attempt(p, ip), 'first five attempts allowed';
  END LOOP;
  ASSERT NOT public.phone_password_reserve_attempt(p, ip), 'sixth attempt blocked';
  ASSERT (SELECT count(*) = 5 FROM public.otp_rate_limits WHERE phone_number=p AND attempt_type='password'), 'blocked attempts not inserted';
  p := '992' || lpad((floor(random() * 100000000)::bigint)::text,8,'0');
  INSERT INTO public.otp_rate_limits(phone_number, attempt_type, ip_address, attempted_at)
    SELECT p, 'password', ip, now() - interval '1 hour' FROM generate_series(1,20);
  ASSERT NOT public.phone_password_reserve_attempt(p, ip), 'daily phone cap survives different IP';
  p := '993' || lpad((floor(random() * 100000000)::bigint)::text,8,'0');
  INSERT INTO public.otp_rate_limits(phone_number, attempt_type, ip_address)
    SELECT '994' || lpad(n::text,8,'0'), 'password', ip FROM generate_series(1,45) n;
  ASSERT NOT public.phone_password_reserve_attempt(p, ip), 'IP cap shared by different phones';
  ASSERT NOT public.phone_password_reserve_attempt(p, null), 'missing IP fails closed';
  ASSERT NOT has_table_privilege('anon', 'public.phone_password_credentials', 'SELECT'), 'anon cannot read hash';
  ASSERT NOT has_table_privilege('authenticated', 'public.phone_password_credentials', 'SELECT'), 'users cannot read hash';
  ASSERT NOT has_function_privilege('anon', 'public.phone_password_reserve_attempt(text,text)', 'EXECUTE'), 'anon cannot bypass login';
  ASSERT NOT has_function_privilege('authenticated', 'public.phone_password_reserve_attempt(text,text)', 'EXECUTE'), 'authenticated cannot reserve for others';
END;
$$;
ROLLBACK;
