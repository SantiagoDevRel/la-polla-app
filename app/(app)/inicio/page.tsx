// app/(app)/inicio/page.tsx
//
// Inicio - Tribuna Caliente v0.1 redesign of the home screen. Built as a
// Server Component so all Supabase queries and the football-data.org
// fetches run before the client bundle ships. This route coexists with
// /dashboard during the transition. A separate PR will flip BottomNav
// and redirect /dashboard here.
//
// Render order (mobile-first, single column, max-w-lg):
//   1. Centered tricolor header (LA POLLA COLOMBIANA + pollito pibe)
//   2. Greeting (Hola + firstName + rank callout)
//   3. En vivo strip — horizontal scroll of LiveChips, live matches
//      in user's tournaments, each with optional "Pronóstico: X-Y"
//      or "Falta pronóstico" footer
//   4. Próximos strip — scheduled matches inside user's pollas with
//      kickoff today or tomorrow, capped at 15, tap-through to
//      /pollas/{slug}?tab=partidos
//   4b. Rival chip — nearest neighbour in user's top-ranked polla
//   5. Podium carousel across active pollas
//   6. Empty state (ActivePollasEmpty) replaces 3-5 when user has zero pollas
//
// Known workaround: uses createAdminClient() for polla_participants reads
// because auth.uid() does not propagate from the SSR cookie session to
// PostgREST. Tracked as a TODO in CLAUDE.md. Every admin query keeps an
// explicit user-scope filter.

import { redirect } from "next/navigation";
import { Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPollitoBase } from "@/lib/pollitos";
import {
  getTournamentName,
  TOURNAMENT_ICONS,
} from "@/lib/tournaments";
import { TERMINAL_MATCH_STATUSES } from "@/lib/matches/constants";
import { ensureMatchesFresh } from "@/lib/matches/ensure-fresh";
import { getLiveMatches } from "@/lib/football-api";
import { MatchHero } from "@/components/match/MatchHero";
import { LiveChip } from "@/components/match/LiveChip";
import { ActivePollasEmpty } from "@/components/inicio/ActivePollasEmpty";
import { PodiumCarousel } from "@/components/inicio/PodiumCarousel";
import { GreetingHero } from "@/components/inicio/GreetingHero";
import { RivalChip } from "@/components/inicio/RivalChip";
import { QuickPickStrip } from "@/components/inicio/QuickPickStrip";
import { type PodiumEntry } from "@/components/leaderboard/PodiumLeaderboard";

// ─── Local types ───────────────────────────────────────────────────────

// Shape of each enriched polla served to the carousel. Mirrors the
// contract returned by /api/pollas GET, but computed inline so we do not
// round-trip through HTTP.
interface EnrichedPolla {
  id: string;
  slug: string;
  name: string;
  tournament: string;
  status: string;
  effective_status: "active" | "ended" | string;
  match_ids: string[] | null;
  buy_in_amount: number | null;
  created_at: string;
  participant_count: number;
  total_matches: number;
  finished_matches: number;
  user_rank: number | null;
  user_total_points: number;
  is_leader: boolean;
  // Highest total_points across all participants in this polla. Used by
  // the featured-polla waterfall to detect "has activity" (any participant
  // with total_points > 0 counts).
  max_points: number;
  // Soonest upcoming kickoff within match_ids (ms since epoch). Used to
  // sort active pollas. Infinity when no upcoming match is knowable.
  soonest_upcoming_ms: number;
  winner: { winner_name: string; winner_points: number } | null;
}

// Minimal match row fetched to power finished-count + soonest-upcoming sort.
interface MatchLite {
  id: string;
  status: string;
  scheduled_at: string;
}

// ─── Query helpers ─────────────────────────────────────────────────────

// Fetch every polla the user belongs to (creator or participant) and
// enrich each row with Phase 3b contract fields plus a soonest-upcoming
// key for the Inicio sort order.
async function fetchEnrichedPollas(userId: string): Promise<EnrichedPolla[]> {
  const admin = createAdminClient();

  // Step 1: fetch the user's participant rows. Supabase anon/SSR client
  // cannot read polla_participants because auth.uid() is NULL; the admin
  // client with an explicit user_id filter is the approved workaround.
  const { data: participantRows } = await admin
    .from("polla_participants")
    .select("polla_id")
    .eq("user_id", userId);

  const participantIds: string[] = (participantRows || []).map(
    (r: { polla_id: string }) => r.polla_id,
  );

  // Step 2: fetch creator and participant pollas in two queries and merge.
  // A single PostgREST .or() with .in.() silently drops the IN branch when
  // the list contains UUIDs, so we keep the two-query merge from Phase 3b.
  const [createdRes, participantRes] = await Promise.all([
    admin.from("pollas").select("*").eq("created_by", userId),
    participantIds.length > 0
      ? admin.from("pollas").select("*").in("id", participantIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  type PollaRow = {
    id: string;
    slug: string;
    name: string;
    tournament: string;
    status: string;
    match_ids: string[] | null;
    buy_in_amount: number | null;
    created_at: string;
  };

  const byId = new Map<string, PollaRow>();
  for (const p of (createdRes.data || []) as PollaRow[]) byId.set(p.id, p);
  for (const p of (participantRes.data || []) as PollaRow[]) {
    if (!byId.has(p.id)) byId.set(p.id, p);
  }

  const pollas: PollaRow[] = Array.from(byId.values());
  if (pollas.length === 0) return [];

  const allPollaIds = pollas.map((p) => p.id);

  // Step 3: fetch every referenced match row once. Used for both
  // finished_matches count and the soonest-upcoming sort key.
  const allMatchIds = Array.from(
    new Set(
      pollas.flatMap((p) => (p.match_ids as string[] | null) || []),
    ),
  );
  const matchById = new Map<string, MatchLite>();
  if (allMatchIds.length > 0) {
    const { data: matchRows } = await admin
      .from("matches")
      .select("id, status, scheduled_at")
      .in("id", allMatchIds);
    for (const m of (matchRows || []) as MatchLite[]) {
      matchById.set(m.id, m);
    }
  }

  // Step 4: participant counts + max points per polla. One query, two
  // rollups. max_points is used by the featured-polla waterfall to gate
  // "has activity"; a participant_count tally rides along because we have
  // the rows in hand anyway.
  const participantCountByPolla: Record<string, number> = {};
  const maxPointsByPolla: Record<string, number> = {};
  {
    const { data: rows } = await admin
      .from("polla_participants")
      .select("polla_id, total_points")
      .in("polla_id", allPollaIds);
    for (const row of (rows || []) as {
      polla_id: string;
      total_points: number | null;
    }[]) {
      participantCountByPolla[row.polla_id] =
        (participantCountByPolla[row.polla_id] || 0) + 1;
      const pts = row.total_points ?? 0;
      const prev = maxPointsByPolla[row.polla_id] ?? 0;
      if (pts > prev) maxPointsByPolla[row.polla_id] = pts;
    }
  }

  // Step 5: current user's cached rank + points in each polla.
  const myMembershipByPolla: Record<
    string,
    { rank: number | null; total_points: number }
  > = {};
  {
    const { data: rows } = await admin
      .from("polla_participants")
      .select("polla_id, rank, total_points")
      .eq("user_id", userId)
      .in("polla_id", allPollaIds);
    for (const row of (rows || []) as {
      polla_id: string;
      rank: number | null;
      total_points: number | null;
    }[]) {
      myMembershipByPolla[row.polla_id] = {
        rank: row.rank ?? null,
        total_points: row.total_points ?? 0,
      };
    }
  }

  // Step 6: compute effective_status. A polla flips to "ended" when every
  // listed match is terminal (finished or cancelled). Mirrors the rule
  // used by /api/pollas so the two surfaces agree.
  const effectiveStatus = (p: PollaRow): "active" | "ended" | string => {
    if (p.status === "ended") return "ended";
    if (p.status !== "active") return p.status;
    const ids = p.match_ids || [];
    if (ids.length === 0) return p.status;
    const allDone = ids.every((id) => {
      const m = matchById.get(id);
      if (!m) return false;
      return TERMINAL_MATCH_STATUSES.has(m.status);
    });
    return allDone ? "ended" : "active";
  };

  // Step 7: winner lookup for pollas whose effective_status is ended.
  const withEffective = pollas.map((p) => ({
    ...p,
    effective_status: effectiveStatus(p),
  }));
  const endedIds = withEffective
    .filter((p) => p.effective_status === "ended")
    .map((p) => p.id);
  const winnerByPolla: Record<
    string,
    { winner_name: string; winner_points: number }
  > = {};
  if (endedIds.length > 0) {
    const { data: winners } = await admin
      .from("polla_participants")
      .select("polla_id, total_points, users:user_id ( display_name )")
      .in("polla_id", endedIds)
      .eq("rank", 1);
    for (const w of (winners || []) as {
      polla_id: string;
      total_points: number | null;
      users: { display_name: string } | { display_name: string }[] | null;
    }[]) {
      const u = Array.isArray(w.users) ? w.users[0] : w.users;
      winnerByPolla[w.polla_id] = {
        winner_name: u?.display_name || "Ganador",
        winner_points: w.total_points ?? 0,
      };
    }
  }

  // Step 8: compute soonest-upcoming kickoff for each polla. A match counts
  // as upcoming when its status is scheduled or live and it belongs to the
  // polla's match_ids list. Infinity marks pollas with no knowable next
  // kickoff (either custom scope with all matches terminal, or non-custom
  // scope with match_ids NULL).
  const now = Date.now();
  const soonestUpcomingMs = (p: PollaRow): number => {
    const ids = p.match_ids || [];
    if (ids.length === 0) return Number.POSITIVE_INFINITY;
    let soonest = Number.POSITIVE_INFINITY;
    for (const id of ids) {
      const m = matchById.get(id);
      if (!m) continue;
      if (TERMINAL_MATCH_STATUSES.has(m.status)) continue;
      const t = new Date(m.scheduled_at).getTime();
      // Ignore kickoffs deep in the past (stale scheduled rows). A match
      // 48h past kickoff that is still "scheduled" is a sync gap, not a
      // real upcoming fixture.
      if (Number.isNaN(t)) continue;
      if (t < now - 48 * 60 * 60 * 1000) continue;
      if (t < soonest) soonest = t;
    }
    return soonest;
  };

  return withEffective.map((p) => {
    const matchIds = p.match_ids || [];
    const finishedCount = matchIds.filter((id) => {
      const m = matchById.get(id);
      return m ? TERMINAL_MATCH_STATUSES.has(m.status) : false;
    }).length;
    const my = myMembershipByPolla[p.id];
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      tournament: p.tournament,
      status: p.status,
      effective_status: p.effective_status,
      match_ids: p.match_ids,
      buy_in_amount: p.buy_in_amount,
      created_at: p.created_at,
      participant_count: participantCountByPolla[p.id] || 0,
      total_matches: matchIds.length,
      finished_matches: finishedCount,
      user_rank: my?.rank ?? null,
      user_total_points: my?.total_points ?? 0,
      is_leader: my?.rank === 1,
      max_points: maxPointsByPolla[p.id] ?? 0,
      soonest_upcoming_ms: soonestUpcomingMs(p),
      winner: winnerByPolla[p.id] || null,
    };
  });
}

// ─── Pollas sort ───────────────────────────────────────────────────────

// Active first (soonest upcoming kickoff leads, created_at desc breaks
// ties), then ended pollas (created_at desc).
function sortPollasForCarousel(pollas: EnrichedPolla[]): EnrichedPolla[] {
  const active = pollas.filter((p) => p.effective_status !== "ended");
  const ended = pollas.filter((p) => p.effective_status === "ended");

  active.sort((a, b) => {
    if (a.soonest_upcoming_ms !== b.soonest_upcoming_ms) {
      return a.soonest_upcoming_ms - b.soonest_upcoming_ms;
    }
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
  ended.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  return [...active, ...ended];
}

// ─── Podium data ───────────────────────────────────────────────────────

// Fetch the top three participants for a polla.
//
// Sort rule (per the active-only refactor): total_points DESC, tiebreak
// joined_at ASC. When every participant is at 0 points (brand-new polla
// with no results yet) the ranking falls back to "first to join wins" —
// intentional, so the podium always has a visible #1 for the pollito to
// sit on even before any match plays.
async function fetchPodiumTop3(pollaId: string): Promise<PodiumEntry[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("polla_participants")
    .select(
      "user_id, total_points, joined_at, users:user_id ( display_name, avatar_url )",
    )
    .eq("polla_id", pollaId)
    .eq("status", "approved")
    .order("total_points", { ascending: false })
    .order("joined_at", { ascending: true })
    .limit(3);

  type Row = {
    user_id: string;
    total_points: number | null;
    joined_at: string | null;
    users:
      | { display_name: string | null; avatar_url: string | null }
      | { display_name: string | null; avatar_url: string | null }[]
      | null;
  };

  return ((data || []) as Row[]).map((r) => {
    const u = Array.isArray(r.users) ? r.users[0] : r.users;
    return {
      userId: r.user_id,
      name: u?.display_name || "Jugador",
      // Pollito image source for the podium avatar slot. Falls back to the
      // generic waiting pollito when the user has not picked a character.
      avatarUrl: getPollitoBase(u?.avatar_url ?? null),
      points: r.total_points ?? 0,
    };
  });
}

// Fetch podium top 3 for every active polla in parallel. Returns items in
// the same order as the input array; the caller chooses which is the
// default visible page (e.g. polla with the soonest upcoming match).
async function fetchPodiumsForPollas(
  pollas: EnrichedPolla[],
): Promise<Array<{ pollaSlug: string; pollaName: string; top3: PodiumEntry[] }>> {
  const top3s = await Promise.all(pollas.map((p) => fetchPodiumTop3(p.id)));
  return pollas.map((p, i) => ({
    pollaSlug: p.slug,
    pollaName: p.name,
    top3: top3s[i],
  }));
}

// ─── Rival lookup ──────────────────────────────────────────────────────

interface RivalPayload {
  pollaSlug: string;
  pollaName: string;
  rivalName: string;
  rivalPollitoType: string | null;
  userPoints: number;
  rivalPoints: number;
  mode: "chasing" | "behind";
}

// Pick the polla most likely to produce an interesting rival story for
// the user: the one where the user has the best rank (ties break by
// smallest gap to the adjacent participant). When the user is rank 1 we
// pull rank 2 as the rival (they are chasing us). Otherwise we pull the
// rank directly above and directly below and pick whichever gap is
// smaller. Returns null when there is no neighbour to compare against.
async function findRivalForUser(
  userId: string,
  activePollas: EnrichedPolla[],
): Promise<RivalPayload | null> {
  const ranked = activePollas.filter((p) => p.user_rank != null);
  if (ranked.length === 0) return null;
  // Prefer the polla where the user is best-ranked; tie-break by most
  // total points so higher-stakes leagues win when ranks are equal.
  ranked.sort((a, b) => {
    const ra = a.user_rank ?? 99999;
    const rb = b.user_rank ?? 99999;
    if (ra !== rb) return ra - rb;
    return b.user_total_points - a.user_total_points;
  });

  const admin = createAdminClient();

  type NeighbourRow = {
    rank: number | null;
    total_points: number | null;
    paid: boolean | null;
    users:
      | { display_name: string | null; avatar_url: string | null }
      | { display_name: string | null; avatar_url: string | null }[]
      | null;
  };

  // Walk the ranked list; return the first polla that has a real,
  // eligible neighbour. "Eligible" = status approved, and for
  // admin_collects pollas also paid=true (unpaid participants cannot
  // predict yet and should not appear as rivals). Previously the lookup
  // only inspected the user's top-ranked polla and trusted the raw
  // participant_count; admin_collects pollas with a single paid player
  // slipped through and produced phantom rivals.
  for (const target of ranked) {
    const userRank = target.user_rank!;
    const candidateRanks = userRank === 1 ? [2] : [userRank - 1, userRank + 1];

    const { data: pollaRow } = await admin
      .from("pollas")
      .select("payment_mode")
      .eq("id", target.id)
      .maybeSingle();
    const requirePaid = pollaRow?.payment_mode === "admin_collects";

    let query = admin
      .from("polla_participants")
      .select("rank, total_points, paid, users:user_id ( display_name, avatar_url )")
      .eq("polla_id", target.id)
      .eq("status", "approved")
      .in("rank", candidateRanks);
    if (requirePaid) {
      query = query.eq("paid", true);
    }

    const { data } = await query;
    const rows = (data || []) as NeighbourRow[];
    if (rows.length === 0) continue;

    const userPoints = target.user_total_points;
    let best: { row: NeighbourRow; gap: number } | null = null;
    for (const row of rows) {
      const gap = Math.abs((row.total_points ?? 0) - userPoints);
      if (!best || gap < best.gap) best = { row, gap };
    }
    if (!best) continue;

    const u = Array.isArray(best.row.users) ? best.row.users[0] : best.row.users;
    if (!u) continue;
    const rivalPoints = best.row.total_points ?? 0;
    const rivalRank = best.row.rank ?? 0;
    const mode: "chasing" | "behind" = rivalRank > userRank ? "chasing" : "behind";
    const displayName = u.display_name || "Tu rival";
    const firstName = displayName.split(" ")[0];

    return {
      pollaSlug: target.slug,
      pollaName: target.name,
      rivalName: firstName,
      rivalPollitoType: u.avatar_url ?? null,
      userPoints,
      rivalPoints,
      mode,
    };
  }

  return null;
}

// Pick the best rank callout for the greeting bubble. Prefers rank 1 in
// any polla (most pride); falls back to the overall best rank the user
// holds. Returns null when the user has no ranked memberships.
function pickRankCallout(activePollas: EnrichedPolla[]): { rank: number; pollaName: string } | null {
  const ranked = activePollas.filter((p) => p.user_rank != null);
  if (ranked.length === 0) return null;
  ranked.sort((a, b) => (a.user_rank ?? 99999) - (b.user_rank ?? 99999));
  const top = ranked[0];
  return { rank: top.user_rank!, pollaName: top.name };
}

// ─── Quick-pick preset pool ────────────────────────────────────────────

// Strip common prefixes/articles from a team name and take the first word
// to get a 3-letter code fallback ("FC Barcelona" → "BAR",
// "RC Celta de Vigo" → "CEL"). Used as the shortCode for MatchHero
// crests since our matches table does not store a TLA column.
function teamShortCode(name: string): string {
  const cleaned = name.replace(/^(FC |CF |RC |Real |Club |Atlético |Athletic |AC |SC |Deportivo |CD )/i, "");
  const first = cleaned.split(/\s+/)[0] || cleaned;
  return first.slice(0, 3).toUpperCase();
}

// Quick-pick preset pool. Each hero card samples four per render so
// the row of suggested scores never feels static across reloads.
const QUICK_PICK_POOL: ReadonlyArray<{ home: number; away: number }> = [
  { home: 0, away: 0 },
  { home: 1, away: 0 },
  { home: 0, away: 1 },
  { home: 2, away: 1 },
  { home: 1, away: 2 },
  { home: 1, away: 1 },
  { home: 2, away: 2 },
  { home: 3, away: 2 },
  { home: 2, away: 3 },
  { home: 3, away: 3 },
];

function sampleQuickPickPresets(n = 4): Array<{ home: number; away: number }> {
  const pool = [...QUICK_PICK_POOL];
  const out: Array<{ home: number; away: number }> = [];
  while (out.length < n && pool.length > 0) {
    const idx = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

function heroPropsFromDb(m: {
  home_team: string;
  away_team: string;
  home_team_flag: string | null;
  away_team_flag: string | null;
  scheduled_at: string;
  status: string;
  tournament: string;
}): React.ComponentProps<typeof MatchHero> {
  const kickoffAt = new Date(m.scheduled_at);
  const lockAt = m.status === "scheduled"
    ? new Date(kickoffAt.getTime() - 5 * 60 * 1000)
    : undefined;
  return {
    competition: {
      name: getTournamentName(m.tournament) ?? m.tournament,
      logoUrl: TOURNAMENT_ICONS[m.tournament],
    },
    kickoffAt,
    homeTeam: {
      name: m.home_team,
      shortCode: teamShortCode(m.home_team),
      crestUrl: m.home_team_flag ?? undefined,
    },
    awayTeam: {
      name: m.away_team,
      shortCode: teamShortCode(m.away_team),
      crestUrl: m.away_team_flag ?? undefined,
    },
    lockAt,
  };
}

// ─── Page ──────────────────────────────────────────────────────────────

export default async function InicioPage() {
  void ensureMatchesFresh();
  // Validate session. Middleware already gates /inicio, but the explicit
  // redirect keeps the page safe if middleware order ever changes.
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  // Fetch profile: display_name for the greeting, avatar_url for the pollito
  // character key.
  const { data: publicUser } = await admin
    .from("users")
    .select("display_name, avatar_url")
    .eq("id", user.id)
    .single();

  const displayName = publicUser?.display_name || user.phone || "Usuario";
  const firstName = displayName.split(" ")[0];

  // Enriched pollas + sort + cap.
  const allPollas = await fetchEnrichedPollas(user.id);
  const sortedPollas = sortPollasForCarousel(allPollas);
  // Active-only filter (Phase 3c follow-up: ended pollas do not appear on
  // Inicio — users see them on /pollas). This is the canonical source
  // feeding the podium carousel below.
  const activePollas = sortedPollas.filter(
    (p) => p.effective_status !== "ended",
  );
  const isActiveEmpty = activePollas.length === 0;

  // Pollito character key fallback. The spec names "pibe" as the default
  // when the user has never picked a character. Must be a string key that
  // exists in /public/pollitos/pollito_{key}_{estado}.webp.
  const pollitoType: string = publicUser?.avatar_url || "pibe";

  // Derive the greeting's rank callout + an optional rival row from data
  // already fetched above. The rival lookup makes one tiny extra query
  // (adjacent ranks in the user's best polla); the callout is pure.
  const rankCallout = pickRankCallout(activePollas);
  const rival = isActiveEmpty ? null : await findRivalForUser(user.id, activePollas);
  // Podium carousel: one card per active polla, ordered by created_at via
  // activePollas' existing sort. Default visible page = the polla with
  // the soonest upcoming match (smallest soonest_upcoming_ms). When every
  // active polla has Infinity (no knowable next match), the first card
  // wins by index.
  const podiumItems = isActiveEmpty
    ? []
    : await fetchPodiumsForPollas(activePollas);
  const podiumDefaultIndex = isActiveEmpty
    ? 0
    : activePollas.reduce(
        (bestIdx, p, i, arr) =>
          p.soonest_upcoming_ms < arr[bestIdx].soonest_upcoming_ms ? i : bestIdx,
        0,
      );

  const userTournaments = Array.from(
    new Set(sortedPollas.map((p) => p.tournament)),
  );

  // Hero match = the soonest live-or-upcoming match across every active
  // polla's match_ids, read straight from our matches table. This is why
  // the hero is never empty as long as at least one scheduled match
  // exists in the user's pollas — even if it is months away.
  const allUserMatchIds = Array.from(
    new Set(activePollas.flatMap((p) => p.match_ids || [])),
  );

  type HeroRow = {
    id: string;
    home_team: string;
    away_team: string;
    home_team_flag: string | null;
    away_team_flag: string | null;
    scheduled_at: string;
    status: string;
    tournament: string;
  };

  // Próximos strip scope: scheduled matches inside the user's pollas,
  // kickoff between (now + 5 min) and end-of-tomorrow, in chronological
  // order. Capped at 15 so the horizontal scroll is fast but every
  // actionable kickoff for today/tomorrow is surfaced. Dropping the
  // previous "hero" selector — Inicio no longer single-features one
  // match inline; the full score input lives in the polla Partidos
  // tab where bulk fills + auto-jump already work.
  let upcomingStripMatches: HeroRow[] = [];
  if (allUserMatchIds.length > 0) {
    const lockCutoff = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const tomorrowEnd = new Date();
    tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);
    tomorrowEnd.setHours(23, 59, 59, 999);
    const { data: rows } = await admin
      .from("matches")
      .select("id, home_team, away_team, home_team_flag, away_team_flag, scheduled_at, status, tournament")
      .in("id", allUserMatchIds)
      .eq("status", "scheduled")
      .gt("scheduled_at", lockCutoff)
      .lt("scheduled_at", tomorrowEnd.toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(15);
    upcomingStripMatches = ((rows || []) as HeroRow[]);
  }

  // Prediction map for the upcoming strip so each chip can surface
  // "Tu pred: X-Y" or "Falta pronóstico".
  const upcomingPredByMatch = new Map<string, { home: number; away: number }>();
  if (upcomingStripMatches.length > 0) {
    const { data: preds } = await admin
      .from("predictions")
      .select("match_id, predicted_home, predicted_away")
      .eq("user_id", user.id)
      .in("match_id", upcomingStripMatches.map((m) => m.id));
    for (const p of (preds || []) as Array<{
      match_id: string;
      predicted_home: number;
      predicted_away: number;
    }>) {
      upcomingPredByMatch.set(p.match_id, {
        home: p.predicted_home,
        away: p.predicted_away,
      });
    }
  }

  // Polla slug resolver for chip tap-through (→ /pollas/{slug}?tab=partidos).
  function pollaForMatch(matchId: string): EnrichedPolla | null {
    return (
      activePollas.find((p) => (p.match_ids || []).includes(matchId)) ?? null
    );
  }

  // Live strip uses football-data for real-time scores/minutes.
  const userLive = userTournaments.length > 0 ? await getLiveMatches(userTournaments) : [];
  const stripMatches = userLive
    .sort(
      (a, b) =>
        new Date(a.match_date).getTime() - new Date(b.match_date).getTime(),
    )
    .slice(0, 10);
  const showStrip = !isActiveEmpty && stripMatches.length >= 1;

  // Enrich each live strip entry with the user's prediction context so
  // LiveChip can show "Tu pred: X-Y" or "Falta pronóstico" in its
  // footer. One roundtrip per load:
  //   1. external_id → DB UUID for every strip match
  //   2. predictions for this user on those UUIDs
  //   3. which of those UUIDs actually belong to one of the user's
  //      active pollas (otherwise we cannot say "Falta pronóstico" —
  //      the user is not supposed to predict this match at all)
  const stripExternalToUuid = new Map<string, string>();
  const stripPredByMatchUuid = new Map<string, { home: number; away: number }>();
  const stripMatchInUserPolla = new Set<string>();
  if (stripMatches.length > 0) {
    const { data: dbRows } = await admin
      .from("matches")
      .select("id, external_id")
      .in("external_id", stripMatches.map((m) => m.id));
    for (const row of (dbRows || []) as Array<{ id: string; external_id: string }>) {
      stripExternalToUuid.set(row.external_id, row.id);
    }
    const uuids = Array.from(stripExternalToUuid.values());
    if (uuids.length > 0) {
      const { data: preds } = await admin
        .from("predictions")
        .select("match_id, predicted_home, predicted_away")
        .eq("user_id", user.id)
        .in("match_id", uuids);
      for (const p of (preds || []) as Array<{
        match_id: string;
        predicted_home: number;
        predicted_away: number;
      }>) {
        stripPredByMatchUuid.set(p.match_id, {
          home: p.predicted_home,
          away: p.predicted_away,
        });
      }
      const pollaMatchIds = new Set(
        activePollas.flatMap((p) => p.match_ids || []),
      );
      for (const uuid of uuids) {
        if (pollaMatchIds.has(uuid)) stripMatchInUserPolla.add(uuid);
      }
    }
  }

  return (
    <div className="min-h-screen">
      {/* Block 1 - Centered wordmark header. Profile access moved to
          the BottomNav FAB (pollito face) so the header stays focused
          on brand. Pibe pollito stands in as the logo per spec. */}
      <header className="px-4 pt-4 pb-4">
        <div className="max-w-lg mx-auto flex items-center justify-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/pollitos/pollito_pibe_lider.webp"
            alt=""
            width={52}
            height={52}
            style={{ objectFit: "contain" }}
          />
          <span
            className="font-display leading-none tracking-[0.04em] flex items-baseline gap-[5px]"
            style={{
              fontSize: 22,
              WebkitTextStroke: "1px #000",
              textShadow: "0 2px 6px rgba(0,0,0,0.55)",
              paintOrder: "stroke fill",
            }}
          >
            <span style={{ color: "#FFD700" }}>LA</span>
            <span style={{ color: "#2F6DF4" }}>POLLA</span>
            <span style={{ color: "#E4463A" }}>COLOMBIANA</span>
          </span>
        </div>
      </header>

      {/* Block 2 - Talking-pollito greeting */}
      <GreetingHero
        firstName={firstName}
        pollitoType={pollitoType}
        rankCallout={rankCallout}
      />

      <main className="pb-[110px]">
        <div className="max-w-lg mx-auto space-y-8">
          {/* Block 7 - Empty state. Replaces blocks 3/4/5/6 entirely when
              the user has no active pollas. Offers two paths out: create
              a new polla, or join an existing one with a 6-char code. */}
          {isActiveEmpty ? (
            <section className="px-4">
              <ActivePollasEmpty userPollitoType={pollitoType} />
            </section>
          ) : null}

          {/* Block 3 - Live strip (LIVE matches in user's tournaments).
              Moved above the hero card so in-play action leads; when
              something is actually live it steals the user's eye before
              they see the next-match quick-pick. Hides cleanly when the
              list is empty. */}
          {showStrip ? (
            <section>
              <h2 className="px-4 mb-3 font-display text-[20px] tracking-[0.04em] uppercase text-text-primary flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-alert animate-pulse" aria-hidden="true" />
                En vivo
              </h2>
              <div className="overflow-x-auto hide-scrollbar">
                <div className="flex gap-3 px-4 pb-1 snap-x snap-mandatory">
                  {stripMatches.map((m) => {
                    const uuid = stripExternalToUuid.get(m.id);
                    const myPred = uuid ? stripPredByMatchUuid.get(uuid) : undefined;
                    const inMyPolla = uuid ? stripMatchInUserPolla.has(uuid) : false;
                    const predictionStatus =
                      !myPred && inMyPolla ? ("pending" as const) : undefined;
                    // Fallback minute: football-data's free tier sometimes
                    // omits the `minute` field even for IN_PLAY matches.
                    // If so, compute a rough elapsed from kickoff so the
                    // chip still reads "VIVO · 32'" instead of just
                    // "VIVO". Live games max at ~95' regular time; we
                    // cap at 120 so extra time still looks sane.
                    let displayMinute = m.elapsed ?? undefined;
                    if (
                      displayMinute === undefined &&
                      m.status === "live" &&
                      m.match_date
                    ) {
                      const diffMs = Date.now() - new Date(m.match_date).getTime();
                      const diffMin = Math.max(0, Math.floor(diffMs / 60000));
                      if (diffMin <= 120) displayMinute = diffMin;
                    }
                    return (
                      <div key={m.id} className="snap-start">
                        <LiveChip
                          kind={m.status === "live" ? "live" : "upcoming"}
                          homeCode={m.home_team_tla}
                          awayCode={m.away_team_tla}
                          homeScore={m.status === "live" ? m.home_score ?? undefined : undefined}
                          awayScore={m.status === "live" ? m.away_score ?? undefined : undefined}
                          minute={displayMinute}
                          kickoffAt={m.status !== "live" ? new Date(m.match_date) : undefined}
                          myPrediction={myPred}
                          predictionStatus={predictionStatus}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          ) : null}

          {/* Block 4 - Próximos strip: one full MatchHero + QuickPick
              card per scheduled match inside the user's pollas with
              kickoff today or tomorrow. Horizontal scroll, one card
              per "page", so users swipe left-right through every
              prediction they still owe. Cap 15 cards — more than that
              and they should use the polla Partidos tab. */}
          {!isActiveEmpty && upcomingStripMatches.length > 0 ? (
            <section>
              <h2 className="px-4 mb-3 font-display text-[20px] tracking-[0.04em] uppercase text-text-primary flex items-center gap-2">
                <Clock className="w-4 h-4 text-gold" aria-hidden="true" />
                Próximos
              </h2>
              <div className="overflow-x-auto hide-scrollbar">
                <div className="flex gap-3 px-4 pb-1 snap-x snap-mandatory">
                  {upcomingStripMatches.map((m) => {
                    const polla = pollaForMatch(m.id);
                    const myPred = upcomingPredByMatch.get(m.id);
                    return (
                      <div
                        key={m.id}
                        className="snap-center shrink-0 w-[88vw] max-w-[420px]"
                      >
                        <MatchHero
                          {...heroPropsFromDb(m)}
                          myPrediction={myPred ?? undefined}
                          quickPickSlot={
                            polla ? (
                              <QuickPickStrip
                                pollaSlug={polla.slug}
                                pollaName={polla.name}
                                matchId={m.id}
                                initialPrediction={myPred ?? undefined}
                                presets={sampleQuickPickPresets(4)}
                                locked={false}
                              />
                            ) : undefined
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          ) : null}

          {/* Block 4b - Rival callout (only when we have a neighbour).
              Deep-links straight to the ranking tab so the user lands on
              the leaderboard where the rival actually lives, not the
              default Partidos view. */}
          {rival ? (
            <RivalChip
              pollaHref={`/pollas/${rival.pollaSlug}?tab=ranking`}
              pollaName={rival.pollaName}
              rivalName={rival.rivalName}
              rivalPollitoType={rival.rivalPollitoType}
              userPoints={rival.userPoints}
              rivalPoints={rival.rivalPoints}
              mode={rival.mode}
            />
          ) : null}

          {/* Block 5 - Swipeable podium carousel across all active pollas.
              The dedicated "Mis Pollas" carousel was removed — users who
              want the full list tap the Pollas tab; Podio already surfaces
              each active polla with rank context. */}
          {!isActiveEmpty && podiumItems.length > 0 ? (
            <section>
              <h2 className="px-4 mb-3 font-display text-[20px] tracking-[0.04em] uppercase text-text-primary">
                Podio
              </h2>
              <PodiumCarousel
                items={podiumItems}
                currentUserId={user.id}
                defaultIndex={podiumDefaultIndex}
              />
            </section>
          ) : null}

        </div>
      </main>
    </div>
  );
}
