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
  TOURNAMENTS,
} from "@/lib/tournaments";
import { TERMINAL_MATCH_STATUSES } from "@/lib/matches/constants";
import {
  getLiveMatches,
  getTodayMatches,
  type FootballMatch,
} from "@/lib/football-api";
import { MatchHero } from "@/components/match/MatchHero";
import { LiveChip } from "@/components/match/LiveChip";
import PollaCard from "@/components/polla/PollaCard";
import { EmptyStateM1 } from "@/components/inicio/EmptyStateM1";
import {
  PodiumLeaderboard,
  type PodiumEntry,
} from "@/components/leaderboard/PodiumLeaderboard";

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

  // Step 4: participant counts per polla.
  const participantCountByPolla: Record<string, number> = {};
  {
    const { data: rows } = await admin
      .from("polla_participants")
      .select("polla_id")
      .in("polla_id", allPollaIds);
    for (const row of (rows || []) as { polla_id: string }[]) {
      participantCountByPolla[row.polla_id] =
        (participantCountByPolla[row.polla_id] || 0) + 1;
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

// ─── Featured polla selection ──────────────────────────────────────────

// Pick the polla the podium should feature. Order is deliberate:
//   1. Active polla where the user is rank 1. Ties resolve by most recent.
//   2. Else active polla with the soonest upcoming match.
//   3. Else most recently created polla regardless of status.
//   4. Else null (only happens when the user has zero pollas, but the
//      empty-state branch already owns that case).
function selectFeaturedPolla(pollas: EnrichedPolla[]): EnrichedPolla | null {
  if (pollas.length === 0) return null;

  const active = pollas.filter((p) => p.effective_status !== "ended");

  // Rule 1 - active + user is leader. Newest wins ties.
  const leaders = active.filter((p) => p.is_leader);
  if (leaders.length > 0) {
    return [...leaders].sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )[0];
  }

  // Rule 2 - active, soonest upcoming. created_at desc breaks ties.
  if (active.length > 0) {
    return [...active].sort((a, b) => {
      if (a.soonest_upcoming_ms !== b.soonest_upcoming_ms) {
        return a.soonest_upcoming_ms - b.soonest_upcoming_ms;
      }
      return (
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    })[0];
  }

  // Rule 3 - fall back to most recent polla, active or ended.
  return [...pollas].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )[0];
}

// Fetch the top three participants for the featured polla. Uses the admin
// client for the polla_participants read (RLS workaround) and filters by
// the exact polla_id, so the scope is tight.
async function fetchPodiumTop3(pollaId: string): Promise<PodiumEntry[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("polla_participants")
    .select(
      "user_id, total_points, rank, users:user_id ( display_name, avatar_url )",
    )
    .eq("polla_id", pollaId)
    .eq("status", "approved")
    .order("rank", { ascending: true, nullsFirst: false })
    .order("total_points", { ascending: false })
    .limit(3);

  type Row = {
    user_id: string;
    total_points: number | null;
    rank: number | null;
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

// ─── Hero match + strip selection ──────────────────────────────────────

// Deduplicate matches by id, preferring the first occurrence. getLiveMatches
// and getTodayMatches overlap when a match kicks off today and is currently
// live, so we merge with a seen-set.
function mergeMatchesUnique(...lists: FootballMatch[][]): FootballMatch[] {
  const seen = new Set<string>();
  const out: FootballMatch[] = [];
  for (const list of lists) {
    for (const m of list) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
  }
  return out;
}

// Returns true when the match is within the "today + next 24h" window
// relevant to the Inicio hero + strip. Live matches are always eligible;
// scheduled matches must kick off within 24h of now.
function isHeroEligible(m: FootballMatch, nowMs: number): boolean {
  if (m.status === "live") return true;
  if (m.status !== "scheduled") return false;
  const t = new Date(m.match_date).getTime();
  if (Number.isNaN(t)) return false;
  return t >= nowMs && t <= nowMs + 24 * 60 * 60 * 1000;
}

// Pick the hero match following the spec's 5-step waterfall. Returns null
// if no eligible match exists.
function selectHeroMatch(
  userMatches: FootballMatch[],
  allMatches: FootballMatch[],
  nowMs: number,
): FootballMatch | null {
  const byKickoffAsc = (a: FootballMatch, b: FootballMatch) =>
    new Date(a.match_date).getTime() - new Date(b.match_date).getTime();

  // Rule 1 - live match in user tournaments.
  const userLive = userMatches.filter((m) => m.status === "live");
  if (userLive.length > 0) return userLive.sort(byKickoffAsc)[0];

  // Rule 2 - upcoming (next 24h) in user tournaments, soonest first.
  const userUpcoming = userMatches.filter(
    (m) => m.status === "scheduled" && isHeroEligible(m, nowMs),
  );
  if (userUpcoming.length > 0) return userUpcoming.sort(byKickoffAsc)[0];

  // Rule 3 - any live match across all tournaments.
  const anyLive = allMatches.filter((m) => m.status === "live");
  if (anyLive.length > 0) return anyLive.sort(byKickoffAsc)[0];

  // Rule 4 - any upcoming match within 24h across all tournaments.
  const anyUpcoming = allMatches.filter(
    (m) => m.status === "scheduled" && isHeroEligible(m, nowMs),
  );
  if (anyUpcoming.length > 0) return anyUpcoming.sort(byKickoffAsc)[0];

  return null;
}

// Convert a FootballMatch into MatchHero's Date-based props. Lock is
// approximated as 5 minutes before kickoff, matching the app's business
// rule for when predictions close.
function heroPropsFor(
  m: FootballMatch,
): React.ComponentProps<typeof MatchHero> {
  const kickoffAt = new Date(m.match_date);
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
      shortCode: m.home_team_tla,
      crestUrl: m.home_team_flag ?? undefined,
    },
    awayTeam: {
      name: m.away_team,
      shortCode: m.away_team_tla,
      crestUrl: m.away_team_flag ?? undefined,
    },
    lockAt,
  };
}

// ─── Page ──────────────────────────────────────────────────────────────

export default async function InicioPage() {
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
  const isEmptyState = allPollas.length === 0;
  const sortedPollas = sortPollasForCarousel(allPollas);
  const CAROUSEL_CAP = 6;
  const pollasForCarousel = sortedPollas.slice(0, CAROUSEL_CAP);
  const hasOverflow = sortedPollas.length > CAROUSEL_CAP;

  // Pollito character key fallback. The spec names "pibe" as the default
  // when the user has never picked a character. Must be a string key that
  // exists in /public/pollitos/pollito_{key}_{estado}.webp.
  const pollitoType: string = publicUser?.avatar_url || "pibe";

  // Featured polla + podium. Podium renders only when at least one
  // participant has total_points > 0, which is a cheap proxy for
  // "someone has actually made predictions in this polla".
  const featuredPolla = selectFeaturedPolla(sortedPollas);
  const podiumTop3 = featuredPolla
    ? await fetchPodiumTop3(featuredPolla.id)
    : [];
  const podiumHasActivity = podiumTop3.some((p) => p.points > 0);
  const showPodium = !isEmptyState && !!featuredPolla && podiumHasActivity;

  // Fetch today's live + scheduled matches from football-data.org. Run
  // both calls in parallel. We scope to the user's tournaments first, and
  // fall back to all tournaments only when the user has no pollas (the
  // empty-state branch already owns that path, so this is defensive).
  const userTournaments = Array.from(
    new Set(sortedPollas.map((p) => p.tournament)),
  );
  const heroScopeTournaments =
    userTournaments.length > 0
      ? userTournaments
      : TOURNAMENTS.map((t) => t.slug);

  const [userLive, userToday, globalLive, globalToday] = await Promise.all([
    userTournaments.length > 0 ? getLiveMatches(userTournaments) : Promise.resolve([]),
    userTournaments.length > 0 ? getTodayMatches(userTournaments) : Promise.resolve([]),
    // Global fallback lists cover hero rules 3 and 4.
    getLiveMatches(heroScopeTournaments),
    getTodayMatches(heroScopeTournaments),
  ]);

  const now = Date.now();
  const userMatches = mergeMatchesUnique(userLive, userToday).filter((m) =>
    isHeroEligible(m, now),
  );
  const allMatches = mergeMatchesUnique(globalLive, globalToday).filter((m) =>
    isHeroEligible(m, now),
  );

  const heroMatch = selectHeroMatch(userMatches, allMatches, now);

  // Strip: remaining matches in the user's scope minus the hero. Fall back
  // to the global pool if the user scope has fewer than 2 after removing
  // the hero, so the strip is not starved on quiet days.
  const stripBase =
    userMatches.length >= 2 ? userMatches : allMatches;
  const stripMatches = stripBase
    .filter((m) => !heroMatch || m.id !== heroMatch.id)
    .sort(
      (a, b) =>
        new Date(a.match_date).getTime() - new Date(b.match_date).getTime(),
    )
    .slice(0, 10);
  const showStrip = !isEmptyState && stripMatches.length >= 2;

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

      {/* Block 2 - Greeting */}
      <section className="px-4 pb-8">
        <div className="max-w-lg mx-auto">
          <p className="font-body text-[12px] text-text-muted">Hola,</p>
          <h1 className="font-display text-[40px] leading-none tracking-[0.02em] text-gold">
            {firstName}
          </h1>
          <p className="font-body text-[13px] text-text-secondary mt-2">
            ¿Listo pa&apos; pronosticar?
          </p>
        </div>
      </section>

      <main className="pb-[110px]">
        <div className="max-w-lg mx-auto space-y-8">
          {/* Block 7 - Empty state. Replaces blocks 3/4/5/6 entirely when
              the user has no pollas yet. M1 is the onboarding script and
              the inline variant keeps it in-flow under the greeting. */}
          {isEmptyState ? (
            <section className="px-4">
              <EmptyStateM1
                userPollitoType={pollitoType}
                nextHref="/pollas/crear"
              />
            </section>
          ) : null}

          {/* Block 3 - Today's hero match */}
          {!isEmptyState && heroMatch ? (
            <section className="px-4">
              <MatchHero {...heroPropsFor(heroMatch)} />
            </section>
          ) : null}

          {/* Block 4 - Live / upcoming strip */}
          {showStrip ? (
            <section>
              <h2 className="px-4 mb-3 font-display text-[20px] tracking-[0.04em] uppercase text-text-primary">
                En vivo y próximos
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

          {/* Block 5 - Mis pollas carousel */}
          {!isEmptyState && pollasForCarousel.length > 0 ? (
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

          {/* Block 6 - Featured polla podium */}
          {showPodium && featuredPolla ? (
            <section className="px-4">
              <h2 className="font-display text-[20px] tracking-[0.04em] uppercase text-text-primary mb-3">
                Podio
                <span className="ml-2 font-body text-[12px] font-semibold tracking-[0.04em] uppercase text-text-muted">
                  {featuredPolla.name}
                </span>
              </h2>
              <div className="rounded-lg border border-border-subtle bg-bg-card p-4">
                <PodiumLeaderboard
                  top3={podiumTop3}
                  currentUserId={user.id}
                />
                <div className="mt-5 flex justify-center">
                  <Link
                    href={`/pollas/${featuredPolla.slug}`}
                    className="inline-flex items-center gap-2 rounded-full bg-gold text-bg-base font-display tracking-[0.06em] uppercase text-[14px] h-9 px-4 shadow-[0_8px_24px_-6px_rgba(255,215,0,0.4)] hover:-translate-y-px transition-transform"
                  >
                    Ver polla
                    <ArrowRight className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
                  </Link>
                </div>
              </div>
            </section>
          ) : null}

        </div>
      </main>
    </div>
  );
}
