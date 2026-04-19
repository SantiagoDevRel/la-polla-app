// scripts/backfill-join-codes.ts — Idempotent backfill for pollas.join_code.
//
// Assigns a unique 6-char code to every polla that currently has NULL
// join_code. Uses the unambiguous alphabet (no 0/O/I/1). On the off
// chance of a UNIQUE collision, retries up to 10 times per polla.
//
// Safe to run multiple times: it only touches rows where join_code IS NULL.
// Run once after migration 014 is applied:
//   npx tsx scripts/backfill-join-codes.ts
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateCode(): string {
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: pollas, error } = await db
    .from("pollas")
    .select("id, slug, name, join_code")
    .is("join_code", null);

  if (error) throw error;
  if (!pollas || pollas.length === 0) {
    console.log("No pollas need codes. Nothing to do.");
    return;
  }

  console.log(`Backfilling ${pollas.length} pollas...`);
  for (const p of pollas) {
    let assigned = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = generateCode();
      const { error: upErr } = await db
        .from("pollas")
        .update({ join_code: code })
        .eq("id", p.id)
        .is("join_code", null);
      if (!upErr) {
        console.log(`  ${p.slug}  ->  ${code}`);
        assigned = true;
        break;
      }
      // Retry only on unique-violation-looking errors; bail on anything else.
      if (!String(upErr.message).toLowerCase().includes("unique")) {
        throw upErr;
      }
    }
    if (!assigned) {
      throw new Error(`Could not assign code to polla ${p.slug} after 10 retries`);
    }
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
