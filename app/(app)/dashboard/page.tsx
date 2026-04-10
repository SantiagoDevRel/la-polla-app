// app/(app)/dashboard/page.tsx — Dashboard principal "estadio de noche"
// Greeting, pollas activas, partidos próximos, quick stats
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import PollaCard from "@/components/polla/PollaCard";

export default async function DashboardPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Perfil público
  const { data: publicUser } = await supabase
    .from("users")
    .select("display_name, avatar_url")
    .eq("id", user.id)
    .single();

  const displayName = publicUser?.display_name || user.phone || "Usuario";
  const firstName = displayName.split(" ")[0];
  const initial = firstName.charAt(0).toUpperCase();

  // Participaciones
  const { data: participantRows } = await supabase
    .from("polla_participants")
    .select("polla_id, role, total_points, rank")
    .eq("user_id", user.id);

  const pollaIds = participantRows?.map((r) => r.polla_id) || [];
  const isAdminOfAnyPolla = participantRows?.some((r) => r.role === "admin") || false;

  // Pollas activas
  const { data: pollas } = pollaIds.length > 0
    ? await supabase
        .from("pollas")
        .select("*")
        .in("id", pollaIds)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(10)
    : { data: [] };

  // Contar participantes
  const participantCounts: Record<string, number> = {};
  if (pollaIds.length > 0) {
    const { data: counts } = await supabase
      .from("polla_participants")
      .select("polla_id")
      .in("polla_id", pollaIds);
    if (counts) {
      for (const c of counts) {
        participantCounts[c.polla_id] = (participantCounts[c.polla_id] || 0) + 1;
      }
    }
  }

  // Partidos próximos 24h
  const tournaments = Array.from(
    new Set((pollas || []).map((p: { tournament: string }) => p.tournament))
  );
  const in24h = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  let upcomingMatches: {
    id: string; home_team: string; away_team: string;
    home_team_flag: string | null; away_team_flag: string | null;
    scheduled_at: string; tournament: string;
  }[] = [];

  if (tournaments.length > 0) {
    const { data: matches } = await supabase
      .from("matches")
      .select("id, home_team, away_team, home_team_flag, away_team_flag, scheduled_at, tournament")
      .in("tournament", tournaments)
      .eq("status", "scheduled")
      .gte("scheduled_at", now)
      .lte("scheduled_at", in24h)
      .order("scheduled_at", { ascending: true })
      .limit(5);
    upcomingMatches = matches || [];
  }

  // Quick stats
  const totalPollas = participantRows?.length || 0;
  const ranks = (participantRows || []).map((r) => r.rank).filter((r): r is number => r !== null);
  const bestRank = ranks.length > 0 ? Math.min(...ranks) : null;

  function getParticipantData(pollaId: string) {
    const row = participantRows?.find((r) => r.polla_id === pollaId);
    return {
      myPoints: row?.total_points ?? undefined,
      myRank: row?.rank ?? undefined,
      isAdmin: row?.role === "admin",
    };
  }

  return (
    <div className="min-h-screen">
      {/* Header — gradiente */}
      <header
        className="px-4 pt-4 pb-6"
        style={{ background: "linear-gradient(180deg, #0a1628 0%, var(--bg-base) 100%)" }}
      >
        <div className="max-w-lg mx-auto flex items-center justify-between mb-6">
          <h1 className="font-display text-[28px] text-gold tracking-wide">
            ⚽ La Polla
          </h1>
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-text-primary"
            style={{
              backgroundColor: "var(--bg-card-elevated)",
              border: "1px solid var(--border-gold)",
            }}
          >
            {initial}
          </div>
        </div>

        <div className="max-w-lg mx-auto">
          <h2 className="text-2xl font-bold text-text-primary">
            Hola, {firstName} 👋
          </h2>
          <p className="text-text-secondary text-sm mt-0.5">
            ¿Listo para pronosticar?
          </p>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 space-y-6 -mt-1">
        {/* Quick stats */}
        {totalPollas > 0 && (
          <div className="flex gap-2">
            <div className="flex-1 rounded-xl px-3 py-2 bg-bg-elevated text-center">
              <span className="text-text-primary font-bold text-sm">{totalPollas}</span>
              <span className="text-text-muted text-[11px] ml-1">pollas</span>
            </div>
            {bestRank && (
              <div className="flex-1 rounded-xl px-3 py-2 bg-bg-elevated text-center">
                <span className="text-gold font-bold text-sm">#{bestRank}</span>
                <span className="text-text-muted text-[11px] ml-1">mejor pos</span>
              </div>
            )}
          </div>
        )}

        {/* Próximos partidos */}
        {upcomingMatches.length > 0 && (
          <section>
            <h3 className="text-[11px] font-bold text-gold uppercase tracking-widest mb-2">
              Hoy
            </h3>
            <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
              {upcomingMatches.map((match) => (
                <div
                  key={match.id}
                  className="rounded-xl p-3 min-w-[200px] flex-shrink-0"
                  style={{
                    backgroundColor: "var(--bg-card)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <div className="text-[11px] text-text-secondary mb-2">
                    {new Date(match.scheduled_at).toLocaleTimeString("es-CO", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                  <div className="flex items-center gap-2">
                    {match.home_team_flag && (
                      <img src={match.home_team_flag} alt="" className="w-4 h-4 rounded-full" />
                    )}
                    <span className="text-xs font-medium text-text-primary truncate flex-1">
                      {match.home_team}
                    </span>
                  </div>
                  <div className="text-[10px] text-text-muted text-center my-0.5">vs</div>
                  <div className="flex items-center gap-2">
                    {match.away_team_flag && (
                      <img src={match.away_team_flag} alt="" className="w-4 h-4 rounded-full" />
                    )}
                    <span className="text-xs font-medium text-text-primary truncate flex-1">
                      {match.away_team}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Pollas activas */}
        {pollas && pollas.length > 0 ? (
          <section>
            <h3 className="text-[11px] font-bold text-text-secondary uppercase tracking-widest mb-2">
              Tus pollas
            </h3>
            <div className="space-y-3">
              {pollas.map((polla) => {
                const { myPoints, myRank, isAdmin } = getParticipantData(polla.id);
                return (
                  <PollaCard
                    key={polla.id}
                    polla={polla}
                    participantCount={participantCounts[polla.id]}
                    myPoints={myPoints}
                    myRank={myRank}
                    isAdmin={isAdmin}
                  />
                );
              })}
            </div>
          </section>
        ) : (
          <section
            className="rounded-2xl p-8 text-center"
            style={{
              backgroundColor: "var(--bg-card)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            {/* Minimalist pitch outline */}
            <svg viewBox="0 0 120 80" className="w-24 h-16 mx-auto mb-4 opacity-10">
              <rect x="1" y="1" width="118" height="78" rx="2" fill="none" stroke="white" strokeWidth="1" />
              <line x1="60" y1="1" x2="60" y2="79" stroke="white" strokeWidth="0.5" />
              <circle cx="60" cy="40" r="12" fill="none" stroke="white" strokeWidth="0.5" />
              <rect x="1" y="20" width="18" height="40" fill="none" stroke="white" strokeWidth="0.5" />
              <rect x="101" y="20" width="18" height="40" fill="none" stroke="white" strokeWidth="0.5" />
            </svg>
            <h3 className="font-bold text-text-primary text-lg mb-1">
              ¡Bienvenido a La Polla!
            </h3>
            <p className="text-text-secondary text-sm mb-4">
              Creá tu primera polla o unite a una existente
            </p>
            <a
              href="/pollas/crear"
              className="inline-block bg-gold text-bg-base font-semibold py-3 px-6 rounded-xl hover:brightness-110 transition-all"
            >
              Crear tu primera polla 🏆
            </a>
          </section>
        )}

        {/* Admin link */}
        {isAdminOfAnyPolla && (
          <a
            href="/admin/matches"
            className="block text-center text-sm text-text-muted hover:text-gold transition-colors"
          >
            ⚙️ Panel admin de partidos
          </a>
        )}
      </main>
    </div>
  );
}
