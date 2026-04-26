// scripts/seed-test-data.ts — Seed test data for La Polla
// Usage: npx ts-node -P scripts/tsconfig.scripts.json -r tsconfig-paths/register scripts/seed-test-data.ts
//
// Creates: 5 users, 3 pollas, 6 matches, predictions, and calculates points.
// Safe to re-run — uses upserts and skips existing records.

import { config } from "dotenv";
config({ path: ".env" });

import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { calculatePoints } from "@/lib/utils/points";

// ─── Supabase admin client ───

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ─── Helpers ───

function derivePassword(phone: string): string {
  return crypto
    .createHmac("sha256", serviceRoleKey)
    .update(phone)
    .digest("hex");
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// ─── Test data definitions ───

const TEST_USERS = [
  { phone: "573001111111", displayName: "Valentina" },
  { phone: "573002222222", displayName: "Camilo" },
  { phone: "573003333333", displayName: "Mariana" },
  { phone: "573004444444", displayName: "Felipe" },
];

const now = new Date();
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
const daysFromNow = (n: number) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000).toISOString();

const TEST_MATCHES = [
  {
    key: "col-bra",
    external_id: "seed-col-bra-001",
    tournament: "worldcup_2026",
    home_team: "Colombia",
    away_team: "Brasil",
    home_team_flag: "https://media.api-sports.io/flags/co.svg",
    away_team_flag: "https://media.api-sports.io/flags/br.svg",
    scheduled_at: daysAgo(3),
    status: "finished" as const,
    home_score: 2,
    away_score: 1,
    phase: "group_a",
  },
  {
    key: "arg-fra",
    external_id: "seed-arg-fra-001",
    tournament: "worldcup_2026",
    home_team: "Argentina",
    away_team: "Francia",
    home_team_flag: "https://media.api-sports.io/flags/ar.svg",
    away_team_flag: "https://media.api-sports.io/flags/fr.svg",
    scheduled_at: daysAgo(2),
    status: "finished" as const,
    home_score: 3,
    away_score: 3,
    phase: "group_b",
  },
  {
    key: "esp-por",
    external_id: "seed-esp-por-001",
    tournament: "worldcup_2026",
    home_team: "España",
    away_team: "Portugal",
    home_team_flag: "https://media.api-sports.io/flags/es.svg",
    away_team_flag: "https://media.api-sports.io/flags/pt.svg",
    scheduled_at: daysAgo(1),
    status: "finished" as const,
    home_score: 2,
    away_score: 0,
    phase: "group_c",
  },
  {
    key: "rma-bay",
    external_id: "seed-rma-bay-001",
    tournament: "champions_2025",
    home_team: "Real Madrid",
    away_team: "Bayern Munich",
    home_team_flag: null,
    away_team_flag: null,
    scheduled_at: daysAgo(2),
    status: "finished" as const,
    home_score: 1,
    away_score: 0,
    phase: "quarter_final",
  },
  {
    key: "col-uru",
    external_id: "seed-col-uru-001",
    tournament: "worldcup_2026",
    home_team: "Colombia",
    away_team: "Uruguay",
    home_team_flag: "https://media.api-sports.io/flags/co.svg",
    away_team_flag: "https://media.api-sports.io/flags/uy.svg",
    scheduled_at: now.toISOString(),
    status: "live" as const,
    home_score: 1,
    away_score: 0,
    phase: "group_a",
  },
  {
    key: "mci-psg",
    external_id: "seed-mci-psg-001",
    tournament: "champions_2025",
    home_team: "Manchester City",
    away_team: "PSG",
    home_team_flag: null,
    away_team_flag: null,
    scheduled_at: daysFromNow(1),
    status: "scheduled" as const,
    home_score: null,
    away_score: null,
    phase: "semi_final",
  },
];

// Predictions: [matchKey][userName] = { home, away }
const PREDICTIONS: Record<string, Record<string, { home: number; away: number }>> = {
  "col-bra": { // actual: 2-1
    Santiago: { home: 2, away: 1 },  // exact → 5pts
    Valentina: { home: 2, away: 0 }, // winner correct → 2pts
    Camilo: { home: 1, away: 0 },    // winner correct → 2pts
    Mariana: { home: 1, away: 1 },   // wrong → 0pts
    Felipe: { home: 2, away: 1 },    // exact → 5pts
  },
  "arg-fra": { // actual: 3-3
    Santiago: { home: 2, away: 2 },  // winner correct (draw) → 2pts
    Valentina: { home: 3, away: 3 }, // exact → 5pts
    Camilo: { home: 1, away: 0 },    // wrong → 0pts
    Mariana: { home: 2, away: 2 },   // winner correct (draw) → 2pts
    Felipe: { home: 0, away: 0 },    // winner correct (draw) → 2pts
  },
  "esp-por": { // actual: 2-0
    Santiago: { home: 1, away: 0 },  // winner + same diff → 3pts
    Valentina: { home: 2, away: 1 }, // winner correct → 2pts
    Camilo: { home: 2, away: 0 },    // exact → 5pts
    Mariana: { home: 1, away: 0 },   // winner + same diff → 3pts
    Felipe: { home: 0, away: 1 },    // wrong → 0pts
  },
  "rma-bay": { // actual: 1-0
    Santiago: { home: 1, away: 0 },  // exact → 5pts
    Valentina: { home: 2, away: 0 }, // winner correct → 2pts
    Camilo: { home: 1, away: 0 },    // exact → 5pts
  },
  "col-uru": { // live, current: 1-0
    Santiago: { home: 2, away: 0 },
    Valentina: { home: 1, away: 0 },
    Camilo: { home: 0, away: 1 },
  },
};

// ─── Main seed function ───

async function main() {
  console.log("═══════════════════════════════════════");
  console.log("  La Polla — Seed Test Data");
  console.log("═══════════════════════════════════════\n");

  // ────────────────────────────────────
  // STEP 1: Find Santiago (existing user)
  // ────────────────────────────────────
  console.log("1. Finding Santiago (existing user)...");

  // Look up via auth.users to get the correct auth UID (which is what RLS uses)
  const { data: authUsers } = await supabase.auth.admin.listUsers();
  const santiagoAuth = authUsers?.users?.find(
    (u) => u.email === "351934255581@wa.lapolla.app" || u.phone === "351934255581"
  );

  if (!santiagoAuth) {
    console.error("   ✗ Santiago not found in auth.users. Make sure he exists first.");
    process.exit(1);
  }

  // Also verify public.users row exists
  const { data: santiagoRow } = await supabase
    .from("users")
    .select("id, display_name")
    .eq("id", santiagoAuth.id)
    .single();

  console.log(`   ✓ Santiago found: auth.id=${santiagoAuth.id}, public.users=${santiagoRow?.display_name || "(missing)"}`);
  const santiagoId = santiagoAuth.id;

  // ────────────────────────────────────
  // STEP 2: Create test users via Supabase Auth
  // ────────────────────────────────────
  console.log("\n2. Creating test users...");

  const userIds: Record<string, string> = { Santiago: santiagoId };

  for (const testUser of TEST_USERS) {
    const email = `${testUser.phone}@wa.lapolla.app`;
    const password = derivePassword(testUser.phone);

    // Try to create auth user
    const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
      email,
      password,
      phone: `+${testUser.phone}`,
      email_confirm: true,
      phone_confirm: true,
      user_metadata: { phone: `+${testUser.phone}`, auth_method: "whatsapp_otp" },
    });

    let userId: string;

    if (authErr) {
      if (authErr.message.includes("already been registered")) {
        // User exists — find them
        const { data: existingUsers } = await supabase.auth.admin.listUsers();
        const existing = existingUsers?.users?.find((u) => u.email === email);
        if (!existing) {
          console.error(`   ✗ ${testUser.displayName}: exists but can't find ID. Skipping.`);
          continue;
        }
        userId = existing.id;
        console.log(`   ○ ${testUser.displayName} already exists: ${userId}`);
      } else {
        console.error(`   ✗ ${testUser.displayName}: ${authErr.message}`);
        continue;
      }
    } else {
      userId = authUser.user.id;
      console.log(`   ✓ ${testUser.displayName} created: ${userId}`);
    }

    userIds[testUser.displayName] = userId;

    // Upsert into public.users table (the trigger should handle this, but ensure display_name)
    const { error: upsertErr } = await supabase
      .from("users")
      .upsert(
        {
          id: userId,
          whatsapp_number: `+${testUser.phone}`,
          whatsapp_verified: true,
          display_name: testUser.displayName,
        },
        { onConflict: "id" }
      );

    if (upsertErr) {
      console.error(`   ⚠ ${testUser.displayName} users upsert error: ${upsertErr.message}`);
    }
  }

  console.log("\n   User IDs:", userIds);

  if (Object.keys(userIds).length < 5) {
    console.error("   ✗ Not all users created. Continuing with available users...");
  }

  // ────────────────────────────────────
  // STEP 3: Create test matches
  // ────────────────────────────────────
  console.log("\n3. Creating test matches...");

  const matchIds: Record<string, string> = {};

  for (const match of TEST_MATCHES) {
    const { key, ...matchData } = match;

    const { data: inserted, error: matchErr } = await supabase
      .from("matches")
      .upsert(matchData, { onConflict: "external_id" })
      .select("id")
      .single();

    if (matchErr) {
      console.error(`   ✗ ${key}: ${matchErr.message}`);
      // Try to find existing
      const { data: existing } = await supabase
        .from("matches")
        .select("id")
        .eq("external_id", match.external_id)
        .single();
      if (existing) {
        matchIds[key] = existing.id;
        console.log(`   ○ ${key} already exists: ${existing.id}`);
      }
    } else {
      matchIds[key] = inserted.id;
      console.log(`   ✓ ${key}: ${inserted.id} (${match.home_team} vs ${match.away_team})`);
    }
  }

  console.log("\n   Match IDs:", matchIds);

  // ────────────────────────────────────
  // STEP 4: Create pollas
  // ────────────────────────────────────
  console.log("\n4. Creating test pollas...");

  const POLLAS = [
    {
      key: "mundial-oficina",
      name: "Polla Mundial Oficina",
      tournament: "worldcup_2026",
      type: "closed",
      scope: "full",
      buy_in_amount: 10000,
      payment_mode: "admin_collects",
      admin_payment_instructions: "Enviar a Nequi 310-123-4567",
      participants: ["Santiago", "Valentina", "Camilo", "Mariana", "Felipe"],
    },
    {
      key: "champions-parceros",
      name: "Champions con los parceros",
      tournament: "champions_2025",
      type: "closed",
      scope: "full",
      buy_in_amount: 50000,
      payment_mode: "admin_collects",
      admin_payment_instructions: "Enviar a Bancolombia 123-456-789",
      participants: ["Santiago", "Valentina", "Camilo"],
    },
    {
      key: "test-novia",
      name: "Test con mi novia",
      tournament: "worldcup_2026",
      type: "closed",
      scope: "full",
      buy_in_amount: 10000,
      payment_mode: "admin_collects",
      admin_payment_instructions: "Paga por Nequi",
      participants: ["Santiago", "Valentina"],
    },
  ];

  const pollaIds: Record<string, string> = {};

  for (const polla of POLLAS) {
    const slug = generateSlug(polla.name);

    const { data: inserted, error: pollaErr } = await supabase
      .from("pollas")
      .upsert(
        {
          slug,
          name: polla.name,
          created_by: santiagoId,
          type: polla.type,
          status: "active",
          tournament: polla.tournament,
          scope: polla.scope,
          buy_in_amount: polla.buy_in_amount,
          currency: "COP",
          payment_mode: polla.payment_mode,
          admin_payment_instructions: polla.admin_payment_instructions,
        },
        { onConflict: "slug" }
      )
      .select("id")
      .single();

    if (pollaErr) {
      console.error(`   ✗ ${polla.name}: ${pollaErr.message}`);
      // Try to find existing
      const { data: existing } = await supabase
        .from("pollas")
        .select("id")
        .eq("slug", slug)
        .single();
      if (existing) {
        pollaIds[polla.key] = existing.id;
        console.log(`   ○ ${polla.name} already exists: ${existing.id}`);
      }
    } else {
      pollaIds[polla.key] = inserted.id;
      console.log(`   ✓ ${polla.name}: ${inserted.id}`);
    }
  }

  console.log("\n   Polla IDs:", pollaIds);

  // ────────────────────────────────────
  // STEP 5: Add participants to pollas
  // ────────────────────────────────────
  console.log("\n5. Adding participants to pollas...");

  for (const polla of POLLAS) {
    const pollaId = pollaIds[polla.key];
    if (!pollaId) {
      console.error(`   ✗ Skipping ${polla.name} — no polla ID`);
      continue;
    }

    for (const userName of polla.participants) {
      const userId = userIds[userName];
      if (!userId) {
        console.error(`   ✗ Skipping ${userName} — no user ID`);
        continue;
      }

      const role = userName === "Santiago" ? "admin" : "player";
      const { error: partErr } = await supabase
        .from("polla_participants")
        .upsert(
          {
            polla_id: pollaId,
            user_id: userId,
            role,
            status: "approved",
            paid: true,
            paid_at: new Date().toISOString(),
            paid_amount: polla.buy_in_amount,
            total_points: 0,
          },
          { onConflict: "polla_id,user_id" }
        );

      if (partErr) {
        console.error(`   ✗ ${userName} → ${polla.name}: ${partErr.message}`);
      } else {
        console.log(`   ✓ ${userName} → ${polla.name} (${role})`);
      }
    }
  }

  // ────────────────────────────────────
  // STEP 6: Insert predictions
  // ────────────────────────────────────
  console.log("\n6. Inserting predictions...");

  // Map: which pollas contain which matches (by tournament)
  const pollaMatchMap: Record<string, string[]> = {
    "mundial-oficina": ["col-bra", "arg-fra", "esp-por", "col-uru"],
    "champions-parceros": ["rma-bay"],
    "test-novia": ["col-bra", "arg-fra", "esp-por", "col-uru"],
  };

  // Map: which users are in which pollas
  const pollaParticipants: Record<string, string[]> = {};
  for (const p of POLLAS) {
    pollaParticipants[p.key] = p.participants;
  }

  // Temporarily disable the prediction lock trigger (blocks inserts for past matches)
  console.log("   Disabling prediction lock trigger...");
  const { error: disableTriggerErr } = await supabase.rpc("exec_sql", {
    query: "ALTER TABLE predictions DISABLE TRIGGER trigger_lock_predictions;",
  });
  if (disableTriggerErr) {
    // Fallback: try direct SQL via REST
    console.log("   RPC not available, trying direct SQL...");
    const { error: rawErr } = await supabase.from("predictions").select("id").limit(0);
    if (rawErr) console.error("   ⚠ Could not verify predictions table access");

    // Use the Supabase management API to disable trigger
    // Since we can't disable triggers via the client, we'll set match times to the future temporarily
    console.log("   Setting match times to future temporarily...");
    const futureDate = daysFromNow(7);
    for (const match of TEST_MATCHES) {
      await supabase
        .from("matches")
        .update({ scheduled_at: futureDate })
        .eq("external_id", match.external_id);
    }
    console.log("   ✓ Match times set to future");
  } else {
    console.log("   ✓ Trigger disabled");
  }

  let predictionsInserted = 0;

  for (const [pollaKey, matchKeys] of Object.entries(pollaMatchMap)) {
    const pollaId = pollaIds[pollaKey];
    if (!pollaId) continue;

    const participants = pollaParticipants[pollaKey] || [];

    for (const matchKey of matchKeys) {
      const matchId = matchIds[matchKey];
      if (!matchId) continue;

      const matchPredictions = PREDICTIONS[matchKey];
      if (!matchPredictions) continue;

      const matchDef = TEST_MATCHES.find((m) => m.key === matchKey)!;

      for (const userName of participants) {
        const userId = userIds[userName];
        const pred = matchPredictions[userName];
        if (!userId || !pred) continue;

        // Calculate points for finished matches
        let pointsEarned = 0;
        if (matchDef.status === "finished" && matchDef.home_score !== null && matchDef.away_score !== null) {
          pointsEarned = calculatePoints(
            { homeScore: pred.home, awayScore: pred.away },
            { homeScore: matchDef.home_score, awayScore: matchDef.away_score }
          );
        }

        const { error: predErr } = await supabase
          .from("predictions")
          .upsert(
            {
              polla_id: pollaId,
              user_id: userId,
              match_id: matchId,
              predicted_home: pred.home,
              predicted_away: pred.away,
              points_earned: pointsEarned,
              locked: matchDef.status !== "scheduled",
              visible: matchDef.status === "live" || matchDef.status === "finished",
            },
            { onConflict: "polla_id,user_id,match_id" }
          );

        if (predErr) {
          console.error(`   ✗ ${userName} ${matchKey} (${pollaKey}): ${predErr.message}`);
        } else {
          predictionsInserted++;
        }
      }
    }
  }
  console.log(`   ✓ ${predictionsInserted} predictions inserted/updated`);

  // Re-enable trigger or restore match times
  if (!disableTriggerErr) {
    console.log("   Re-enabling prediction lock trigger...");
    await supabase.rpc("exec_sql", {
      query: "ALTER TABLE predictions ENABLE TRIGGER trigger_lock_predictions;",
    });
    console.log("   ✓ Trigger re-enabled");
  } else {
    // Restore original match times
    console.log("   Restoring original match times...");
    for (const match of TEST_MATCHES) {
      await supabase
        .from("matches")
        .update({
          scheduled_at: match.scheduled_at,
          status: match.status,
          home_score: match.home_score,
          away_score: match.away_score,
        })
        .eq("external_id", match.external_id);
    }
    console.log("   ✓ Match times restored");
  }

  // ────────────────────────────────────
  // STEP 7: Calculate & update total points + ranks
  // ────────────────────────────────────
  console.log("\n7. Calculating total points and ranks...");

  for (const polla of POLLAS) {
    const pollaId = pollaIds[polla.key];
    if (!pollaId) continue;

    // Get all predictions for this polla
    const { data: predRows } = await supabase
      .from("predictions")
      .select("user_id, points_earned")
      .eq("polla_id", pollaId);

    // Aggregate points per user
    const userPoints: Record<string, number> = {};
    for (const row of predRows || []) {
      userPoints[row.user_id] = (userPoints[row.user_id] || 0) + (row.points_earned || 0);
    }

    // Sort by points descending for ranking
    const sorted = Object.entries(userPoints)
      .sort(([, a], [, b]) => b - a);

    // Update each participant
    for (let i = 0; i < sorted.length; i++) {
      const [userId, totalPts] = sorted[i];
      const rank = i + 1;

      const { error: updateErr } = await supabase
        .from("polla_participants")
        .update({ total_points: totalPts, rank })
        .eq("polla_id", pollaId)
        .eq("user_id", userId);

      if (updateErr) {
        console.error(`   ✗ Update points for ${userId}: ${updateErr.message}`);
      }
    }

    // Log leaderboard
    const userNameById = Object.fromEntries(
      Object.entries(userIds).map(([name, id]) => [id, name])
    );

    console.log(`\n   📊 ${polla.name}:`);
    for (let i = 0; i < sorted.length; i++) {
      const [userId, pts] = sorted[i];
      const name = userNameById[userId] || userId;
      console.log(`      ${i + 1}. ${name}: ${pts} pts`);
    }
  }

  // ────────────────────────────────────
  // STEP 8: Verify data
  // ────────────────────────────────────
  console.log("\n\n8. Verifying inserted data...\n");

  // Verify pollas
  const { data: verifyPollas } = await supabase
    .from("pollas")
    .select("id, name, slug, tournament, status, buy_in_amount, type")
    .in("slug", ["polla-mundial-oficina", "champions-con-los-parceros", "test-con-mi-novia"]);

  console.log("   Pollas:");
  for (const p of verifyPollas || []) {
    console.log(`      ${p.name} | ${p.tournament} | ${p.type} | ${p.status} | $${p.buy_in_amount}`);
  }

  // Verify participants
  const { data: verifyParts } = await supabase
    .from("polla_participants")
    .select("polla_id, user_id, role, total_points, rank, status")
    .in("polla_id", Object.values(pollaIds))
    .order("rank", { ascending: true });

  console.log("\n   Participants:");
  const userNameById = Object.fromEntries(
    Object.entries(userIds).map(([name, id]) => [id, name])
  );
  for (const p of verifyParts || []) {
    const pollaName = Object.entries(pollaIds).find(([, id]) => id === p.polla_id)?.[0] || "?";
    const userName = userNameById[p.user_id] || p.user_id;
    console.log(`      ${pollaName} | ${userName} | ${p.role} | ${p.total_points}pts | rank:${p.rank} | ${p.status}`);
  }

  // Verify predictions count
  const { count: predCount } = await supabase
    .from("predictions")
    .select("id", { count: "exact", head: true })
    .in("polla_id", Object.values(pollaIds));

  console.log(`\n   Total predictions: ${predCount}`);

  // Verify matches
  const { data: verifyMatches } = await supabase
    .from("matches")
    .select("id, home_team, away_team, status, home_score, away_score, tournament")
    .in("external_id", TEST_MATCHES.map((m) => m.external_id));

  console.log("\n   Matches:");
  for (const m of verifyMatches || []) {
    const score = m.home_score !== null ? `${m.home_score}-${m.away_score}` : "—";
    console.log(`      ${m.home_team} vs ${m.away_team} | ${m.status} | ${score} | ${m.tournament}`);
  }

  console.log("\n═══════════════════════════════════════");
  console.log("  Seed complete!");
  console.log("═══════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
