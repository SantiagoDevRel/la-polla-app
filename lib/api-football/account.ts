import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

/** /status is not billed. Persist the verified subscription, never trust a client plan flag. */
export async function apiFootballProActive(): Promise<boolean> {
  if (!process.env.API_FOOTBALL_KEY) return false;
  const admin = createAdminClient();
  const {data: account} = await admin.from('api_football_budget')
    .select('plan,plan_expires_at,plan_checked_at').eq('singleton', true).maybeSingle();
  const age = Date.now() - Date.parse(account?.plan_checked_at ?? '');
  const paid = account?.plan !== 'Free' && Date.parse(account?.plan_expires_at ?? '') > Date.now();
  if (age < (paid ? 300_000 : 60_000)) return paid;
  try {
    const res = await fetch('https://v3.football.api-sports.io/status', {
      headers: {'x-apisports-key': process.env.API_FOOTBALL_KEY},
      next: {revalidate: 60}, signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error('Account unavailable');
    const {response, errors} = await res.json();
    if (errors && Object.keys(errors).length) throw new Error('Account unavailable');
    const subscription = response?.subscription, requests = response?.requests;
    if (!subscription || !Number.isInteger(requests?.current) || !Number.isInteger(requests?.limit_day)
      || !Number.isFinite(Date.parse(subscription.end))) throw new Error('Invalid account');
    const active = subscription.active === true && requests.limit_day >= 7500 && Date.parse(subscription.end) > Date.now();
    const {error} = await admin.rpc('record_api_football_account', {
      p_plan: active ? subscription.plan : 'Free', p_expires: subscription.end,
      p_used: requests.current, p_limit: active ? requests.limit_day : 100,
    });
    return !error && active;
  } catch {
    // A short provider outage can use the last verified plan, up to one hour.
    return Boolean(paid && age < 3600_000);
  }
}
