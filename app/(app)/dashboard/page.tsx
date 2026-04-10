// app/(app)/dashboard/page.tsx — Dashboard principal "estadio de noche"
// Greeting, live matches banner, polla selector + leaderboard, quick stats
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { Trophy, UserPlus, Settings } from "lucide-react";
import DashboardClient from "@/components/shared/DashboardClient";

const TOURNAMENT_NAMES: Record<string, string> = {
  champions_2025: "Champions League",
  worldcup_2026: "Mundial 2026",
  la_liga_2025: "La Liga",
};

export default async function DashboardPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Use admin client for data queries to bypass RLS infinite recursion on polla_participants
  const admin = createAdminClient();

  // User profile
  const { data: publicUser } = await admin
    .from("users")
    .select("display_name, avatar_url")
    .eq("id", user.id)
    .single();

  const displayName = publicUser?.display_name || user.phone || "Usuario";
  const firstName = displayName.split(" ")[0];
  // Temporary: all users get the same pollito logo
  const avatarUrl = "/pollitos/logo.png";

  // Participations
  const { data: participantRows } = await admin
    .from("polla_participants")
    .select("polla_id, role, total_points, rank")
    .eq("user_id", user.id);

  const pollaIds = participantRows?.map((r) => r.polla_id) || [];
  const isAdminOfAnyPolla = participantRows?.some((r) => r.role === "admin") || false;

  // Active pollas
  const { data: pollas } = pollaIds.length > 0
    ? await admin
        .from("pollas")
        .select("*")
        .in("id", pollaIds)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(10)
    : { data: [] };

  // Participant counts per polla
  const participantCounts: Record<string, number> = {};
  if (pollaIds.length > 0) {
    const { data: counts } = await admin
      .from("polla_participants")
      .select("polla_id")
      .in("polla_id", pollaIds);
    if (counts) {
      for (const c of counts) {
        participantCounts[c.polla_id] = (participantCounts[c.polla_id] || 0) + 1;
      }
    }
  }

  // Quick stats
  const totalPollas = participantRows?.length || 0;
  const ranks = (participantRows || []).map((r) => r.rank).filter((r): r is number => r !== null);
  const bestRank = ranks.length > 0 ? Math.min(...ranks) : null;

  // ── Live/recent matches from user's active pollas' tournaments ──
  const tournaments = Array.from(
    new Set((pollas || []).map((p: { tournament: string }) => p.tournament))
  );

  interface LiveMatchRaw {
    id: string; home_team: string; away_team: string;
    home_team_flag: string | null; away_team_flag: string | null;
    home_score: number | null; away_score: number | null;
    status: string; tournament: string;
  }

  let liveMatchesRaw: LiveMatchRaw[] = [];
  if (tournaments.length > 0) {
    const { data: matches } = await admin
      .from("matches")
      .select("id, home_team, away_team, home_team_flag, away_team_flag, home_score, away_score, status, tournament")
      .in("tournament", tournaments)
      .in("status", ["live", "finished"])
      .order("scheduled_at", { ascending: false })
      .limit(10);
    liveMatchesRaw = (matches || []) as LiveMatchRaw[];
  }

  // Get user predictions for these matches
  const matchIds = liveMatchesRaw.map((m) => m.id);
  interface PredictionRow {
    match_id: string; predicted_home: number; predicted_away: number;
  }
  let userPredictions: PredictionRow[] = [];
  if (matchIds.length > 0) {
    const { data: preds } = await admin
      .from("predictions")
      .select("match_id, predicted_home, predicted_away")
      .eq("user_id", user.id)
      .in("match_id", matchIds);
    userPredictions = (preds || []) as PredictionRow[];
  }

  const predMap = new Map(userPredictions.map((p) => [p.match_id, p]));

  const liveMatches = liveMatchesRaw
    .filter((m) => m.status === "live" || m.status === "finished")
    .map((m) => {
      const pred = predMap.get(m.id);
      return {
        id: m.id,
        home_team: m.home_team,
        away_team: m.away_team,
        home_team_flag: m.home_team_flag,
        away_team_flag: m.away_team_flag,
        home_score: m.home_score,
        away_score: m.away_score,
        status: m.status as "live" | "finished",
        elapsed: null,
        tournament: m.tournament,
        predicted_home: pred?.predicted_home ?? null,
        predicted_away: pred?.predicted_away ?? null,
      };
    });

  // ── Leaderboard data for all user pollas ──
  let leaderboardData: { pollaId: string; userId: string; displayName: string; totalPoints: number; rank: number }[] = [];
  if (pollaIds.length > 0) {
    const activePollaIds = pollaIds.filter((id) => (pollas || []).some((p: { id: string }) => p.id === id));
    if (activePollaIds.length > 0) {
      const { data: lbRows } = await admin
        .from("polla_participants")
        .select("polla_id, user_id, total_points, rank, users(display_name)")
        .in("polla_id", activePollaIds)
        .order("rank", { ascending: true })
        .limit(50);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      leaderboardData = ((lbRows || []) as any[]).map((r) => {
        const userData = Array.isArray(r.users) ? r.users[0] : r.users;
        return {
          pollaId: r.polla_id,
          userId: r.user_id,
          displayName: userData?.display_name || "Usuario",
          totalPoints: r.total_points || 0,
          rank: r.rank || 999,
        };
      });
    }
  }

  // Build polla tabs for selector
  const userPollas = (pollas || []).map((p: { id: string; name: string; tournament: string; status: string; buy_in_amount: number }) => ({
    id: p.id,
    name: p.name,
    tournament: p.tournament,
    tournamentName: TOURNAMENT_NAMES[p.tournament] || p.tournament,
    isActive: p.status === "active",
    participantCount: participantCounts[p.id] || 0,
    entryFee: p.buy_in_amount || 0,
  }));

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0a1628] via-bg-base to-bg-base">
      {/* Header */}
      <header className="px-4 pt-4 pb-6">
        <div className="max-w-lg mx-auto flex items-center justify-between mb-6">
          <h1 className="font-display text-3xl text-gold tracking-wide flex items-center gap-2">
            <Trophy className="w-7 h-7 text-gold" />
            La Polla
          </h1>
          <div style={{
            width: 32, height: 32, borderRadius: "50%",
            border: "1.5px solid rgba(255,215,0,0.3)", overflow: "hidden",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "#1a2540",
          }}>
            <img src={avatarUrl} alt={firstName} style={{ width: 32, height: 32, objectFit: "cover", borderRadius: "50%" }} />
          </div>
        </div>

        <div className="max-w-lg mx-auto">
          <p style={{ fontSize: 12, color: "#7a8499" }}>Hola,</p>
          <h2 style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.1 }}>
            <span style={{ color: "#FFD700" }}>{firstName}</span>
          </h2>
          <p style={{ fontSize: 12, color: "#7a8499", marginTop: 2 }}>
            ¿Listo pa&apos; pronosticar?
          </p>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 space-y-2 -mt-1">
        {/* Quick stats */}
        {totalPollas > 0 && (
          <div className="flex gap-2 mb-2">
            <div className="flex-1 rounded-xl px-3 py-2 bg-bg-elevated border border-border-subtle text-center">
              <span className="font-display text-xl text-text-primary tabular-nums">{totalPollas}</span>
              <span className="text-text-muted text-[11px] ml-1">pollas</span>
            </div>
            {bestRank && (
              <div className="flex-1 rounded-xl px-3 py-2 bg-bg-elevated border border-border-subtle text-center">
                <span className="font-display text-xl text-gold tabular-nums">#{bestRank}</span>
                <span className="text-text-muted text-[11px] ml-1">mejor pos</span>
              </div>
            )}
          </div>
        )}

        {pollas && pollas.length > 0 ? (
          <DashboardClient
            liveMatches={liveMatches}
            userPollas={userPollas}
            leaderboardData={leaderboardData}
          />
        ) : (
          <section className="rounded-2xl p-8 text-center bg-bg-card/80 backdrop-blur-sm border border-gold/20 shadow-[0_0_24px_rgba(255,215,0,0.12)]">
            <svg viewBox="0 0 120 80" className="w-24 h-16 mx-auto mb-4 opacity-20">
              <rect x="1" y="1" width="118" height="78" rx="2" fill="none" stroke="#FFD700" strokeWidth="1" />
              <line x1="60" y1="1" x2="60" y2="79" stroke="#FFD700" strokeWidth="0.5" />
              <circle cx="60" cy="40" r="12" fill="none" stroke="#FFD700" strokeWidth="0.5" />
              <rect x="1" y="20" width="18" height="40" fill="none" stroke="#FFD700" strokeWidth="0.5" />
              <rect x="101" y="20" width="18" height="40" fill="none" stroke="#FFD700" strokeWidth="0.5" />
            </svg>
            <h3 className="font-display text-2xl text-text-primary tracking-wide mb-1">
              Bienvenido a La Polla
            </h3>
            <p className="text-text-secondary text-sm mb-5">
              Creá tu primera polla o unite a una existente
            </p>
            <a
              href="/pollas/crear"
              className="inline-flex items-center gap-2 bg-gold text-bg-base font-semibold py-3 px-6 rounded-xl hover:scale-[1.02] hover:shadow-[0_0_24px_rgba(255,215,0,0.25)] active:scale-[0.98] hover:brightness-110 transition-all duration-200 cursor-pointer"
            >
              <UserPlus className="w-5 h-5" />
              Crear tu primera polla
            </a>
          </section>
        )}

        {/* Admin link */}
        {isAdminOfAnyPolla && (
          <a
            href="/admin/matches"
            className="flex items-center justify-center gap-2 text-sm text-text-muted hover:text-gold transition-colors duration-200 py-4"
          >
            <Settings className="w-4 h-4" />
            Panel admin de partidos
          </a>
        )}
      </main>
    </div>
  );
}
