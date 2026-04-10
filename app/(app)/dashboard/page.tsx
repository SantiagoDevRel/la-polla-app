// app/(app)/dashboard/page.tsx — Dashboard principal "estadio de noche"
// Greeting, live matches banner, polla selector + leaderboard, quick stats
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { UserPlus } from "lucide-react";
import DashboardClient from "@/components/shared/DashboardClient";
import { getLiveMatches, getTodayMatches } from "@/lib/football-api";
import type { FootballMatch } from "@/lib/football-api";
import { getPollitoBase } from "@/lib/pollitos";

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
  const avatarUrl = getPollitoBase(publicUser?.avatar_url);

  // Participations
  const { data: participantRows } = await admin
    .from("polla_participants")
    .select("polla_id, role, total_points, rank")
    .eq("user_id", user.id);

  const pollaIds = participantRows?.map((r) => r.polla_id) || [];

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

  // ── Live matches from football-data.org API ──
  const tournaments = Array.from(
    new Set((pollas || []).map((p: { tournament: string }) => p.tournament))
  );

  let liveMatches: {
    id: string; home_team: string; away_team: string;
    home_team_flag: string | null; away_team_flag: string | null;
    home_score: number | null; away_score: number | null;
    status: "live" | "finished"; elapsed: number | null;
    tournament: string; predicted_home: number | null; predicted_away: number | null;
  }[] = [];

  if (tournaments.length > 0) {
    // Try real API first: live matches, then today's matches
    const apiMatches: FootballMatch[] = await (async () => {
      try {
        const [live, today] = await Promise.all([
          getLiveMatches(tournaments),
          getTodayMatches(tournaments),
        ]);
        const seen = new Set<string>();
        const merged: FootballMatch[] = [];
        for (const m of [...live, ...today]) {
          if (!seen.has(m.id) && (m.status === "live" || m.status === "finished")) {
            seen.add(m.id);
            merged.push(m);
          }
        }
        return merged;
      } catch (err) {
        console.error("[dashboard] Football API error:", err);
        return [];
      }
    })();

    if (apiMatches.length > 0) {
      // Use real API matches (no predictions for these since they're display-only)
      liveMatches = apiMatches.slice(0, 10).map((m) => ({
        id: m.id,
        home_team: m.home_team,
        away_team: m.away_team,
        home_team_flag: m.home_team_flag,
        away_team_flag: m.away_team_flag,
        home_score: m.home_score,
        away_score: m.away_score,
        status: m.status as "live" | "finished",
        elapsed: m.elapsed,
        tournament: m.tournament,
        predicted_home: null,
        predicted_away: null,
      }));
    } else {
      // Fallback: use Supabase seeded matches
      const { data: dbMatches } = await admin
        .from("matches")
        .select("id, home_team, away_team, home_team_flag, away_team_flag, home_score, away_score, status, tournament")
        .in("tournament", tournaments)
        .in("status", ["live", "finished"])
        .order("scheduled_at", { ascending: false })
        .limit(10);

      const matchIds = (dbMatches || []).map((m) => m.id);
      interface PredictionRow { match_id: string; predicted_home: number; predicted_away: number; }
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

      liveMatches = (dbMatches || [])
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
    }
  }

  // ── Leaderboard data for all user pollas ──
  let leaderboardData: { pollaId: string; userId: string; displayName: string; avatarUrl: string | null; totalPoints: number; rank: number }[] = [];
  if (pollaIds.length > 0) {
    const activePollaIds = pollaIds.filter((id) => (pollas || []).some((p: { id: string }) => p.id === id));
    if (activePollaIds.length > 0) {
      const { data: lbRows } = await admin
        .from("polla_participants")
        .select("polla_id, user_id, total_points, rank, users(display_name, avatar_url)")
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
          avatarUrl: userData?.avatar_url || null,
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
          <div className="flex items-center gap-2">
            <img src="/pollitos/logo_realistic.webp" alt="" style={{ width: 18, height: 18, objectFit: "contain" }} />
            <span className="font-display text-gold" style={{ fontSize: 18, letterSpacing: "0.1em" }}>La Polla</span>
          </div>
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
      </main>
    </div>
  );
}
