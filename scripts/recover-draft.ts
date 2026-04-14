// scripts/recover-draft.ts — One-off recovery for a specific Wompi draft.
// Replicates the inline materialization logic from app/api/webhooks/wompi/route.ts
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const REFERENCE = process.env.RECOVERY_REFERENCE || "draft_74eaa8b0_1776166538278";
const DRY_RUN = process.env.DRY_RUN !== "false"; // default DRY

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Missing supabase env");
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`[recover] DRY_RUN=${DRY_RUN}  reference=${REFERENCE}`);

  const { data: draft, error: draftErr } = await admin
    .from("polla_drafts")
    .select("*")
    .eq("reference", REFERENCE)
    .maybeSingle();

  if (draftErr) throw draftErr;
  if (!draft) {
    console.error("[recover] Draft not found");
    process.exit(1);
  }

  console.log("\n[recover] Draft row:");
  console.log(JSON.stringify({
    id: draft.id,
    reference: draft.reference,
    creator_id: draft.creator_id,
    expires_at: draft.expires_at,
    completed_polla_slug: draft.completed_polla_slug,
    completed_at: draft.completed_at,
    created_at: draft.created_at,
  }, null, 2));

  console.log("\n[recover] polla_data:");
  console.log(JSON.stringify(draft.polla_data, null, 2));

  if (draft.completed_polla_slug) {
    console.log(`\n[recover] Already materialized as ${draft.completed_polla_slug}. Aborting.`);
    process.exit(0);
  }
  if (new Date(draft.expires_at) < new Date()) {
    console.error(`\n[recover] Draft EXPIRED at ${draft.expires_at}. Aborting.`);
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log("\n[recover] DRY_RUN=true — no writes performed. Re-run with DRY_RUN=false to apply.");
    return;
  }

  const data = draft.polla_data as {
    name: string; description: string; slug: string; tournament: string;
    scope: string; type: string; buy_in_amount: number; payment_mode: string;
    admin_payment_instructions: string | null; match_ids: string[] | null;
  };

  let finalSlug = data.slug;
  let pollaId: string | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: polla, error: insertErr } = await admin
      .from("pollas")
      .insert({
        name: data.name,
        description: data.description,
        slug: finalSlug,
        tournament: data.tournament,
        scope: data.scope,
        type: data.type,
        buy_in_amount: data.buy_in_amount,
        currency: "COP",
        payment_mode: data.payment_mode,
        admin_payment_instructions: data.admin_payment_instructions,
        match_ids: data.match_ids,
        created_by: draft.creator_id,
        prize_pool: data.buy_in_amount,
      })
      .select("id, slug")
      .single();

    if (polla) {
      pollaId = polla.id;
      finalSlug = polla.slug;
      break;
    }
    if (insertErr?.code === "23505" && insertErr.message.includes("slug")) {
      finalSlug = `${data.slug}-${Math.random().toString(36).substring(2, 6)}`;
      console.log(`[recover] Slug collision, retrying with ${finalSlug}`);
      continue;
    }
    console.error("[recover] Insert failed:", insertErr);
    process.exit(1);
  }

  if (!pollaId) {
    console.error("[recover] Could not insert polla after 3 attempts");
    process.exit(1);
  }

  const { error: partErr } = await admin.from("polla_participants").insert({
    polla_id: pollaId,
    user_id: draft.creator_id,
    role: "admin",
    status: "approved",
    payment_status: "approved",
    paid: true,
  });
  if (partErr) {
    console.error("[recover] Participant insert failed:", partErr);
    process.exit(1);
  }

  const { error: updErr } = await admin
    .from("polla_drafts")
    .update({
      completed_polla_slug: finalSlug,
      completed_at: new Date().toISOString(),
    })
    .eq("id", draft.id);
  if (updErr) {
    console.error("[recover] Draft update failed:", updErr);
    process.exit(1);
  }

  console.log(`\n[recover] ✅ Materialized draft → polla "${finalSlug}" (id ${pollaId})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
