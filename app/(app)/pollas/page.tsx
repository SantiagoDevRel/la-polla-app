// app/(app)/pollas/page.tsx — Mis Pollas: Activas (siempre visibles) + Finalizadas (colapsables)
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import PollaCard, { TOURNAMENT_ICONS } from "@/components/shared/PollaCard";
import { AnimatedList, AnimatedItem } from "@/components/ui/AnimatedList";
import { Plus, Mail, ChevronDown, ChevronRight } from "lucide-react";
import FootballLoader from "@/components/ui/FootballLoader";

interface PollaData {
  id: string; name: string; slug: string; description?: string;
  tournament: string; status: string;
  effective_status?: string;
  buy_in_amount: number;
  currency: string; payment_mode: string; type: string;
  participant_count?: number;
  winner?: { display_name: string; total_points: number } | null;
}

interface PendingInvite {
  id: string;
  token: string;
  expires_at: string;
  polla: { id: string; name: string; slug: string; tournament: string } | null;
  inviter: { id: string; display_name: string } | null;
}

import { getTournamentName } from "@/lib/tournaments";

export default function MisPollasPage() {
  const router = useRouter();
  const [pollas, setPollas] = useState<PollaData[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [endedOpen, setEndedOpen] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [pollasRes, invitesRes] = await Promise.all([
          axios.get("/api/pollas"),
          axios.get("/api/invites/pending").catch(() => ({ data: { invites: [] } })),
        ]);
        setPollas(pollasRes.data.pollas || []);
        setPendingInvites(invitesRes.data.invites || []);
      } catch { /* silently fail */ }
      finally { setLoading(false); }
    }
    load();
  }, []);

  // Use server-computed effective_status so a polla whose matches are all past
  // shows under Finalizadas even if the auto-close trigger hasn't run.
  const statusOf = (p: PollaData) => p.effective_status || p.status;
  const active = pollas.filter((p) => statusOf(p) === "active");
  const ended = pollas.filter((p) => statusOf(p) === "ended");

  return (
    <div className="min-h-screen">
      <header className="px-4 pt-4 pb-3" style={{ background: "linear-gradient(180deg, #0a1628 0%, var(--bg-base) 100%)" }}>
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button onClick={() => router.push("/dashboard")} className="text-text-secondary text-xl">
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#7a8499" strokeWidth="2"><path d="M19 12H5M12 5l-7 7 7 7" /></svg>
          </button>
          <h1 className="text-xl font-bold text-text-primary flex items-center gap-2">
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#FFD700" strokeWidth="2">
              <path d="M6 9H4.5a2.5 2.5 0 010-5H6" /><path d="M18 9h1.5a2.5 2.5 0 000-5H18" />
              <path d="M4 22h16" /><path d="M18 2H6v7a6 6 0 0012 0V2z" />
            </svg>
            Mis Pollas
          </h1>
        </div>
      </header>

      <main className="max-w-lg mx-auto p-4 space-y-4">
        {/* Pending invites */}
        {pendingInvites.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-bold text-gold flex items-center gap-1.5">
              <Mail className="w-4 h-4" /> Te invitaron
            </h3>
            {pendingInvites.map((invite) => (
              <div
                key={invite.id}
                className="rounded-xl p-3 bg-gold/10 border border-gold/20 flex items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-text-primary truncate">
                    {invite.polla?.name || "Polla"}
                  </p>
                  <p className="text-xs text-text-secondary truncate">
                    {invite.inviter?.display_name ? `Invitó: ${invite.inviter.display_name}` : ""}{" "}
                    {invite.polla?.tournament ? `· ${getTournamentName(invite.polla.tournament)}` : ""}
                  </p>
                </div>
                <button
                  onClick={() => router.push(`/invites/${invite.token}`)}
                  className="flex-shrink-0 bg-gold text-bg-base text-xs font-semibold px-3 py-2 rounded-lg hover:brightness-110 transition-all cursor-pointer"
                >
                  Ver
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── Activas ── */}
        <section className="space-y-2">
          <h2 className="text-sm font-bold text-text-primary flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-live dot-active-pulse" style={{ boxShadow: "0 0 5px rgba(0,230,118,0.6)" }} />
            Mis pollas activas
            <span className="text-text-muted font-normal">· {active.length}</span>
          </h2>

          {loading ? (
            <div className="flex flex-col items-center gap-2 py-6">
              <FootballLoader />
              <p className="text-text-muted text-sm">Cargando pollas...</p>
            </div>
          ) : active.length > 0 ? (
            <AnimatedList className="space-y-0">
              {active.map((polla) => (
                <AnimatedItem key={polla.id}>
                  <PollaCard
                    name={polla.name}
                    tournamentName={getTournamentName(polla.tournament)}
                    tournamentIconPath={TOURNAMENT_ICONS[polla.tournament] || ""}
                    entryFee={polla.buy_in_amount}
                    participantCount={polla.participant_count ?? 0}
                    visibility={polla.type === "open" ? "publica" : "privada"}
                    isActive
                    onPress={() => router.push(`/pollas/${polla.slug}`)}
                  />
                </AnimatedItem>
              ))}
            </AnimatedList>
          ) : (
            <div className="rounded-2xl p-6 text-center bg-bg-card border border-border-subtle">
              <p className="text-text-muted text-sm">No tenés pollas activas</p>
            </div>
          )}
        </section>

        {/* ── Finalizadas (colapsable) ── */}
        {ended.length > 0 && (
          <section className="space-y-2">
            <button
              type="button"
              onClick={() => setEndedOpen((v) => !v)}
              className="w-full flex items-center gap-2 text-sm font-bold text-text-secondary cursor-pointer"
            >
              {endedOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              Finalizadas
              <span className="text-text-muted font-normal">· {ended.length}</span>
            </button>

            {endedOpen && (
              <AnimatedList className="space-y-0">
                {ended.map((polla) => (
                  <AnimatedItem key={polla.id}>
                    <PollaCard
                      name={polla.name}
                      tournamentName={getTournamentName(polla.tournament)}
                      tournamentIconPath={TOURNAMENT_ICONS[polla.tournament] || ""}
                      entryFee={polla.buy_in_amount}
                      participantCount={polla.participant_count ?? 0}
                      visibility={polla.type === "open" ? "publica" : "privada"}
                      isActive={false}
                      ended
                      winnerName={polla.winner?.display_name}
                      winnerPoints={polla.winner?.total_points}
                      onPress={() => router.push(`/pollas/${polla.slug}`)}
                    />
                  </AnimatedItem>
                ))}
              </AnimatedList>
            )}
          </section>
        )}

        {/* Create button */}
        <button
          onClick={() => router.push("/pollas/crear")}
          style={{
            width: "100%",
            background: "#FFD700",
            color: "#080c10",
            fontWeight: 700,
            borderRadius: 11,
            padding: 12,
            border: "none",
            cursor: "pointer",
            fontFamily: "'Outfit', sans-serif",
            fontSize: 13,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
          }}
        >
          <Plus size={14} strokeWidth={2.5} />
          Crear nueva polla
        </button>
      </main>
    </div>
  );
}
