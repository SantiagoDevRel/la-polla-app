// scripts/fix-digital-pool-paid.ts — Backfill paid=true on digital_pool
// participants that were materialized by the recovery script (paid was null/false).
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const DRY_RUN = process.env.DRY_RUN !== "false";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Missing supabase env");
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`[fix] DRY_RUN=${DRY_RUN}`);

  const { data: pollas, error: pollaErr } = await admin
    .from("pollas")
    .select("id, slug")
    .eq("payment_mode", "digital_pool");
  if (pollaErr) throw pollaErr;

  const ids = (pollas ?? []).map((p) => p.id);
  if (!ids.length) {
    console.log("[fix] No digital_pool pollas found");
    return;
  }

  const { data: stale, error: staleErr } = await admin
    .from("polla_participants")
    .select("id, polla_id, user_id, paid, payment_status")
    .in("polla_id", ids)
    .or("paid.is.null,paid.eq.false");
  if (staleErr) throw staleErr;

  console.log(`[fix] Found ${stale?.length ?? 0} rows to update`);
  for (const row of stale ?? []) {
    console.log(`  - polla=${row.polla_id.slice(0, 8)} user=${row.user_id.slice(0, 8)} paid=${row.paid} status=${row.payment_status}`);
  }

  if (DRY_RUN || !stale?.length) {
    if (DRY_RUN) console.log("[fix] DRY_RUN=true — no writes. Re-run with DRY_RUN=false to apply.");
    return;
  }

  const { error: updErr } = await admin
    .from("polla_participants")
    .update({
      paid: true,
      paid_at: new Date().toISOString(),
      payment_status: "approved",
    })
    .in("id", stale.map((r) => r.id));
  if (updErr) throw updErr;

  console.log(`[fix] ✅ Updated ${stale.length} rows`);
}

main().catch((e) => { console.error(e); process.exit(1); });
