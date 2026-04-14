// scripts/seed-test-users.ts — Insert 5 fake users, add them as participants
// to a target polla (default slug "champions-test"), and seed predictions
// for today's Champions League matches.
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const DRY_RUN = process.env.DRY_RUN !== "false";
const POLLA_SLUG = process.env.POLLA_SLUG || "champions-test";
const TOURNAMENT = process.env.TOURNAMENT || "champions_2025";

interface FakeUser {
  phone: string;
  name: string;
  predictions: { match: string; home: number; away: number }[];
}

const MATCH_ATM = { home: "Atl", away: "Barc" }; // team-name substring match
const MATCH_LIV = { home: "Liverpool", away: "Paris" };

const FAKE_USERS: FakeUser[] = [
  { phone: "573100000001", name: "Andrés Test",    predictions: [{ match: "atm", home: 1, away: 2 }, { match: "liv", home: 2, away: 1 }] },
  { phone: "573100000002", name: "Camila Test",    predictions: [{ match: "atm", home: 0, away: 1 }, { match: "liv", home: 3, away: 2 }] },
  { phone: "573100000003", name: "Felipe Test",    predictions: [{ match: "atm", home: 2, away: 2 }, { match: "liv", home: 1, away: 1 }] },
  { phone: "573100000004", name: "Valentina Test", predictions: [{ match: "atm", home: 1, away: 1 }, { match: "liv", home: 0, away: 1 }] },
  { phone: "573100000005", name: "Sebastián Test", predictions: [{ match: "atm", home: 3, away: 1 }, { match: "liv", home: 2, away: 0 }] },
];

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Missing supabase env");
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`[seed] DRY_RUN=${DRY_RUN}  polla=${POLLA_SLUG}  tournament=${TOURNAMENT}`);

  const { data: polla, error: pollaErr } = await admin
    .from("pollas")
    .select("id, slug, match_ids, tournament")
    .eq("slug", POLLA_SLUG)
    .maybeSingle();
  if (pollaErr) throw pollaErr;
  if (!polla) {
    console.error(`[seed] Polla "${POLLA_SLUG}" not found.`);
    process.exit(1);
  }
  console.log(`[seed] Polla id=${polla.id}  match_ids=${(polla.match_ids ?? []).length}`);

  // Today's window in the polla tournament
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd   = new Date(); dayEnd.setUTCHours(23, 59, 59, 999);

  const { data: todays, error: matchErr } = await admin
    .from("matches")
    .select("id, home_team, away_team, scheduled_at, status")
    .eq("tournament", polla.tournament || TOURNAMENT)
    .gte("scheduled_at", dayStart.toISOString())
    .lte("scheduled_at", dayEnd.toISOString());
  if (matchErr) throw matchErr;

  console.log(`[seed] Found ${todays?.length ?? 0} matches today:`);
  for (const m of todays ?? []) console.log(`  - ${m.home_team} vs ${m.away_team}  (${m.scheduled_at})  [${m.id.slice(0, 8)}]`);

  function findMatch(homeHint: string, awayHint: string) {
    const h = homeHint.toLowerCase();
    const a = awayHint.toLowerCase();
    return (todays ?? []).find((m) =>
      m.home_team.toLowerCase().includes(h) && m.away_team.toLowerCase().includes(a)
    );
  }

  const atm = findMatch(MATCH_ATM.home, MATCH_ATM.away);
  const liv = findMatch(MATCH_LIV.home, MATCH_LIV.away);
  if (!atm || !liv) {
    console.error(`[seed] Could not locate today's matches. atm=${!!atm} liv=${!!liv}`);
    process.exit(1);
  }

  // If the polla has a fixed match_ids list, honor it — only seed predictions
  // for matches actually included in that polla.
  const pollaMatchIds: string[] | null = polla.match_ids;
  const wantedIds = [atm.id, liv.id].filter((id) => !pollaMatchIds || pollaMatchIds.includes(id));
  if (!wantedIds.length) {
    console.error(`[seed] Neither match is part of the polla's match_ids.`);
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log(`[seed] DRY_RUN=true — plan:`);
    for (const u of FAKE_USERS) {
      console.log(`  user ${u.phone} "${u.name}"`);
      for (const p of u.predictions) {
        const target = p.match === "atm" ? atm : liv;
        if (!wantedIds.includes(target.id)) continue;
        console.log(`    - ${target.home_team} ${p.home} - ${p.away} ${target.away_team}`);
      }
    }
    console.log(`[seed] Re-run with DRY_RUN=false to apply.`);
    return;
  }

  for (const u of FAKE_USERS) {
    // ── 1) user upsert by whatsapp_number (unique) ──
    let userId: string;
    const { data: existing } = await admin
      .from("users")
      .select("id")
      .eq("whatsapp_number", u.phone)
      .maybeSingle();
    if (existing) {
      userId = existing.id;
      console.log(`[seed] user ${u.phone} already exists (${userId.slice(0, 8)})`);
    } else {
      const { data: inserted, error: insErr } = await admin
        .from("users")
        .insert({
          whatsapp_number: u.phone,
          display_name: u.name,
          whatsapp_verified: true,
        })
        .select("id")
        .single();
      if (insErr) throw insErr;
      userId = inserted!.id;
      console.log(`[seed] created user ${u.phone} → ${userId.slice(0, 8)}`);
    }

    // ── 2) participant row (upsert: skip if already there) ──
    const { data: existingPart } = await admin
      .from("polla_participants")
      .select("id")
      .eq("polla_id", polla.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!existingPart) {
      const { error: partErr } = await admin.from("polla_participants").insert({
        polla_id: polla.id,
        user_id: userId,
        role: "player",
        status: "approved",
        payment_status: "approved",
        paid: true,
        paid_at: new Date().toISOString(),
      });
      if (partErr) throw partErr;
      console.log(`  ↳ added as participant`);
    } else {
      console.log(`  ↳ already a participant`);
    }

    // ── 3) predictions (insert, ignore on conflict via select-then-insert) ──
    for (const p of u.predictions) {
      const target = p.match === "atm" ? atm : liv;
      if (!wantedIds.includes(target.id)) continue;

      const { data: existingPred } = await admin
        .from("predictions")
        .select("id")
        .eq("polla_id", polla.id)
        .eq("user_id", userId)
        .eq("match_id", target.id)
        .maybeSingle();
      if (existingPred) {
        console.log(`    ↳ prediction exists for ${target.home_team} vs ${target.away_team}`);
        continue;
      }
      const { error: predErr } = await admin.from("predictions").insert({
        polla_id: polla.id,
        user_id: userId,
        match_id: target.id,
        predicted_home: p.home,
        predicted_away: p.away,
        locked: false,
        visible: false,
      });
      if (predErr) throw predErr;
      console.log(`    ↳ ${target.home_team} ${p.home}-${p.away} ${target.away_team}`);
    }
  }

  console.log(`[seed] ✅ done`);
}

main().catch((e) => { console.error(e); process.exit(1); });
