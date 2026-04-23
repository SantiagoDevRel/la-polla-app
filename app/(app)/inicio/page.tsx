// app/(app)/inicio/page.tsx
//
// Inicio - Tribuna Caliente v0.1 redesign of the home screen. Built as a
// Server Component so all Supabase queries and the football-data.org
// fetches run before the client bundle ships. This route coexists with
// /dashboard during the transition. A separate PR will flip BottomNav
// and redirect /dashboard here.
//
// Render order (mobile-first, single column, max-w-lg):
//   1. Header (logo + wordmark left, user pollito avatar right)
//   2. Greeting (Hola + firstName + sub)
//   3. Today's hero match (MatchHero), optional
//   4. Live/upcoming strip (horizontal scroll of LiveChip), optional
//   5. Mis pollas carousel (PollaCard horizontal scroll), capped at 6 + tail
//   6. Featured polla podium (PodiumLeaderboard), optional
//   7. Empty state (PollitoMoment M1 inline) replaces 3-6 when user has zero pollas
//
// Known workaround: uses createAdminClient() for polla_participants reads
// because auth.uid() does not propagate from the SSR cookie session to
// PostgREST. Tracked as a TODO in CLAUDE.md. Every admin query keeps an
// explicit user-scope filter.

import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
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
import PollaCard from "@/components/polla/PollaCard";
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

// ─── Adapter: EnrichedPolla → PollaCard props ──────────────────────────

function toPollaCardPolla(p: EnrichedPolla): React.ComponentProps<typeof PollaCard>["polla"] {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    competitionName: getTournamentName(p.tournament) ?? "Desconocido",
    competitionLogoUrl: TOURNAMENT_ICONS[p.tournament],
    participantCount: p.participant_count,
    buyInAmount: p.buy_in_amount ?? 0,
    totalMatches: p.total_matches,
    finishedMatches: p.finished_matches,
  };
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
  const ranked = activePollas.filter((p) => p.user_rank != null && p.participant_count > 1);
  if (ranked.length === 0) return null;
  // Prefer the polla where the user is best-ranked; tie-break by most
  // total points so higher-stakes leagues win when ranks are equal.
  ranked.sort((a, b) => {
    const ra = a.user_rank ?? 99999;
    const rb = b.user_rank ?? 99999;
    if (ra !== rb) return ra - rb;
    return b.user_total_points - a.user_total_points;
  });
  const target = ranked[0];
  const userRank = target.user_rank!;
  const candidateRanks = userRank === 1 ? [2] : [userRank - 1, userRank + 1];

  const admin = createAdminClient();
  const { data } = await admin
    .from("polla_participants")
    .select("rank, total_points, users:user_id ( display_name, avatar_url )")
    .eq("polla_id", target.id)
    .in("rank", candidateRanks);

  type NeighbourRow = {
    rank: number | null;
    total_points: number | null;
    users:
      | { display_name: string | null; avatar_url: string | null }
      | { display_name: string | null; avatar_url: string | null }[]
      | null;
  };

  const rows = (data || []) as NeighbourRow[];
  if (rows.length === 0) return null;

  const userPoints = target.user_total_points;

  // Choose the neighbour with the smallest point gap to the user. In the
  // rank-1 case there is only one candidate so this is a no-op.
  let best: { row: NeighbourRow; gap: number } | null = null;
  for (const row of rows) {
    const gap = Math.abs((row.total_points ?? 0) - userPoints);
    if (!best || gap < best.gap) best = { row, gap };
  }
  if (!best) return null;

  const u = Array.isArray(best.row.users) ? best.row.users[0] : best.row.users;
  if (!u) return null;
  const rivalPoints = best.row.total_points ?? 0;
  const rivalRank = best.row.rank ?? 0;
  // "chasing" when the user is ahead of the rival (user leads), "behind"
  // when the rival is ahead. Ties default to "chasing" so the framing
  // stays positive.
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

// Pool of plausible scoreline presets. Inicio samples 4 of these per
// render so the quick-pick row never feels static. Chosen to balance
// common low-scoring draws with realistic wins in both directions.
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

// ─── DB hero match → MatchHero props ───────────────────────────────────

// Strip common prefixes/articles from a team name and take the first word
// to get a 3-letter code fallback ("FC Barcelona" → "BAR",
// "RC Celta de Vigo" → "CEL"). Used only when we have a DB match but no
// shortCode column — safe approximation for display.
function teamShortCode(name: string): string {
  const cleaned = name.replace(/^(FC |CF |RC |Real |Club |Atlético |Athletic |AC |SC |Deportivo |CD )/i, "");
  const first = cleaned.split(/\s+/)[0] || cleaned;
  return first.slice(0, 3).toUpperCase();
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
  const avatarSrc = getPollitoBase(publicUser?.avatar_url);

  // Enriched pollas + sort + cap.
  const allPollas = await fetchEnrichedPollas(user.id);
  const sortedPollas = sortPollasForCarousel(allPollas);
  // Active-only filter (Phase 3c follow-up: ended pollas do not appear on
  // Inicio — users see them on /pollas). This is the canonical source
  // for both the Mis Pollas carousel and the podium carousel below.
  const activePollas = sortedPollas.filter(
    (p) => p.effective_status !== "ended",
  );
  const isActiveEmpty = activePollas.length === 0;

  const CAROUSEL_CAP = 6;
  const pollasForCarousel = activePollas.slice(0, CAROUSEL_CAP);
  const hasOverflow = activePollas.length > CAROUSEL_CAP;

  // Pollito character key fallback. The spec names "pibe" as the default
  // when the user has never picked a character. Must be a string key that
  // exists in /public/pollitos/pollito_{key}_{estado}.webp.
  const pollitoType: string = publicUser?.avatar_url || "pibe";

  // Derive the greeting's rank callout + an optional rival row from data
  // already fetched above. The rival lookup makes one tiny extra query
  // (adjacent ranks in the user's best polla); the callout is pure.
  const rankCallout = pickRankCallout(activePollas);
  const rival = isActiveEmpty ? null : await findRivalForUser(user.id, activePollas);
  // Quick-pick target: the active polla that actually contains the hero
  // match in its match_ids. Only then does a preset button have somewhere
  // to post to; otherwise we hide the strip entirely.
  let quickPickInitial: { home: number; away: number } | null = null;

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

  let heroDbMatch: HeroRow | null = null;
  if (allUserMatchIds.length > 0) {
    // Only matches the user can actually predict on: status=scheduled AND
    // kickoff is more than the 5-minute lock window in the future. Live
    // and finished matches are intentionally skipped so the hero card is
    // always actionable. Live scores belong in the strip below, not here.
    const lockCutoff = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const { data: rows } = await admin
      .from("matches")
      .select("id, home_team, away_team, home_team_flag, away_team_flag, scheduled_at, status, tournament")
      .in("id", allUserMatchIds)
      .eq("status", "scheduled")
      .gt("scheduled_at", lockCutoff)
      .order("scheduled_at", { ascending: true })
      .limit(1);
    heroDbMatch = ((rows || []) as HeroRow[])[0] ?? null;
  }

  const heroPolla: EnrichedPolla | null = heroDbMatch
    ? activePollas.find((p) => (p.match_ids || []).includes(heroDbMatch!.id)) ?? null
    : null;

  if (heroDbMatch && heroPolla) {
    const { data: existingPred } = await admin
      .from("predictions")
      .select("predicted_home, predicted_away")
      .eq("polla_id", heroPolla.id)
      .eq("user_id", user.id)
      .eq("match_id", heroDbMatch.id)
      .maybeSingle();
    if (existingPred) {
      quickPickInitial = {
        home: existingPred.predicted_home,
        away: existingPred.predicted_away,
      };
    }
  }

  // Live strip keeps using football-data for real-time live updates of
  // the user's tournaments (separate concern from the hero selector).
  const userLive = userTournaments.length > 0 ? await getLiveMatches(userTournaments) : [];

  // Strip: LIVE matches the user can actually play (their tournaments
  // only — no global fallback). The hero match is excluded so the strip
  // never duplicates what is already featured above. Football-data ids
  // are compared against external ids pulled from our matches table.
  let heroExternalId: string | null = null;
  if (heroDbMatch) {
    const { data: ext } = await admin
      .from("matches")
      .select("external_id")
      .eq("id", heroDbMatch.id)
      .maybeSingle();
    heroExternalId = (ext?.external_id as string | null | undefined) ?? null;
  }
  const liveMatchesUser = userLive.filter(
    (m) => !heroExternalId || m.id !== heroExternalId,
  );
  const stripMatches = liveMatchesUser
    .sort(
      (a, b) =>
        new Date(a.match_date).getTime() - new Date(b.match_date).getTime(),
    )
    .slice(0, 10);
  const showStrip = !isActiveEmpty && stripMatches.length >= 1;

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0a1628] via-bg-base to-bg-base">
      {/* Block 1 - Header strip */}
      <header className="px-4 pt-4 pb-4">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <Link href="/inicio" className="flex items-center gap-2 no-underline">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/pollitos/logo_realistic.webp"
              alt=""
              width={54}
              height={54}
              style={{ objectFit: "contain" }}
            />
            <span className="font-body text-gold text-[20px] font-bold tracking-[0.08em]">
              La Polla
            </span>
          </Link>
          <Link
            href="/perfil"
            aria-label="Mi perfil"
            className="w-12 h-12 rounded-full overflow-hidden border border-gold/30 bg-bg-elevated flex items-center justify-center"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={avatarSrc}
              alt={firstName}
              width={48}
              height={48}
              style={{ objectFit: "cover", width: 48, height: 48 }}
            />
          </Link>
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

          {/* Block 3 - Soonest hero match w/ inline quick-pick */}
          {!isActiveEmpty && heroDbMatch ? (
            <section className="px-4">
              <MatchHero
                {...heroPropsFromDb(heroDbMatch)}
                myPrediction={quickPickInitial ?? undefined}
                quickPickSlot={
                  heroPolla ? (
                    <QuickPickStrip
                      pollaSlug={heroPolla.slug}
                      pollaName={heroPolla.name}
                      matchId={heroDbMatch.id}
                      initialPrediction={quickPickInitial ?? undefined}
                      presets={sampleQuickPickPresets(4)}
                      locked={
                        heroDbMatch.status === "live" ||
                        heroDbMatch.status === "finished" ||
                        new Date(heroDbMatch.scheduled_at).getTime() - Date.now() <
                          5 * 60 * 1000
                      }
                    />
                  ) : undefined
                }
              />
            </section>
          ) : null}

          {/* Block 3b - Rival callout (only when we have a neighbour) */}
          {rival ? (
            <RivalChip
              pollaHref={`/pollas/${rival.pollaSlug}`}
              pollaName={rival.pollaName}
              rivalName={rival.rivalName}
              rivalPollitoType={rival.rivalPollitoType}
              userPoints={rival.userPoints}
              rivalPoints={rival.rivalPoints}
              mode={rival.mode}
            />
          ) : null}

          {/* Block 4 - Live strip (LIVE only, with global fallback) */}
          {showStrip ? (
            <section>
              <h2 className="px-4 mb-3 font-display text-[20px] tracking-[0.04em] uppercase text-text-primary">
                En vivo
              </h2>
              <div className="overflow-x-auto hide-scrollbar">
                <div className="flex gap-3 px-4 pb-1 snap-x snap-mandatory">
                  {stripMatches.map((m) => (
                    <div key={m.id} className="snap-start">
                      <LiveChip
                        kind={m.status === "live" ? "live" : "upcoming"}
                        homeCode={m.home_team_tla}
                        awayCode={m.away_team_tla}
                        homeScore={m.status === "live" ? m.home_score ?? undefined : undefined}
                        awayScore={m.status === "live" ? m.away_score ?? undefined : undefined}
                        minute={m.elapsed ?? undefined}
                        kickoffAt={m.status !== "live" ? new Date(m.match_date) : undefined}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </section>
          ) : null}

          {/* Block 5 - Mis pollas carousel (active-only) */}
          {!isActiveEmpty && pollasForCarousel.length > 0 ? (
            <section>
              <div className="px-4 mb-3 flex items-center justify-between">
                <h2 className="font-display text-[20px] tracking-[0.04em] uppercase text-text-primary">
                  Mis Pollas
                </h2>
                <Link
                  href="/pollas"
                  className="font-body text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary hover:text-gold transition-colors"
                >
                  Ver todas
                </Link>
              </div>

              {/* Horizontal scroll strip. 16px gap between cards per §4.2. */}
              <div className="overflow-x-auto hide-scrollbar">
                <div className="flex gap-4 px-4 pb-1">
                  {pollasForCarousel.map((p) => (
                    <PollaCard
                      key={p.id}
                      variant="carousel"
                      polla={toPollaCardPolla(p)}
                      userContext={
                        p.user_rank != null
                          ? {
                              rank: p.user_rank,
                              totalPoints: p.user_total_points,
                              isLeader: p.is_leader,
                            }
                          : undefined
                      }
                      endedState={
                        p.effective_status === "ended" && p.winner
                          ? {
                              winnerName: p.winner.winner_name,
                              winnerPoints: p.winner.winner_points,
                            }
                          : undefined
                      }
                    />
                  ))}

                  {/* Tail "ver todas" tile - styled to match the carousel's
                      210px card width and radius. Shown only when we had to
                      truncate the list. */}
                  {hasOverflow ? (
                    <Link
                      href="/pollas"
                      className="w-[210px] flex-shrink-0 rounded-lg border border-dashed border-border-default p-4 flex flex-col items-center justify-center gap-2 bg-bg-card/50 text-text-secondary hover:text-gold hover:border-gold/40 transition-colors"
                    >
                      <ArrowRight className="w-5 h-5" strokeWidth={2} aria-hidden="true" />
                      <span className="font-display text-[14px] tracking-[0.06em] uppercase">
                        Ver todas
                      </span>
                      <span className="font-body text-[11px] text-text-muted">
                        {sortedPollas.length} pollas
                      </span>
                    </Link>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          {/* Block 6 - Swipeable podium carousel across all active pollas */}
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
