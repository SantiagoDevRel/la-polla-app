// app/(app)/pollas/page.tsx — Mis Pollas: Activas (siempre visibles) + Finalizadas (colapsables)
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import PollaCard from "@/components/polla/PollaCard";
import { PollitoMoment } from "@/components/pollito/PollitoMoment";
import { JoinByCodeSheet } from "@/components/pollas/JoinByCodeSheet";
import { useToast } from "@/components/ui/Toast";
import { TOURNAMENT_ICONS } from "@/lib/tournaments";
import { AnimatedList, AnimatedItem } from "@/components/ui/AnimatedList";
import { Plus, Mail, ChevronDown, ChevronRight, KeyRound, ArrowRight } from "lucide-react";
import FootballLoader from "@/components/ui/FootballLoader";

interface PollaData {
  id: string; name: string; slug: string; description?: string;
  tournament: string; status: string;
  effective_status?: string;
  buy_in_amount: number;
  currency: string; payment_mode: string; type: string;
  participant_count?: number;
  winner?: { display_name: string; total_points: number } | null;
  // Phase 3b enrichment — from /api/pollas
  total_matches?: number;
  finished_matches?: number;
  user_rank?: number | null;
  user_total_points?: number;
  is_leader?: boolean;
}

interface PendingInvite {
  id: string;
  token: string;
  expires_at: string;
  polla: { id: string; name: string; slug: string; tournament: string } | null;
  inviter: { id: string; display_name: string } | null;
}

import { getTournamentName } from "@/lib/tournaments";
import { formatPhone } from "@/lib/format-phone";

function adaptPolla(raw: PollaData): React.ComponentProps<typeof PollaCard>["polla"] {
  return {
    id: raw.id,
    slug: raw.slug,
    name: raw.name,
    competitionName: getTournamentName(raw.tournament) ?? "Desconocido",
    competitionLogoUrl: TOURNAMENT_ICONS[raw.tournament],
    participantCount: raw.participant_count ?? 0,
    buyInAmount: raw.buy_in_amount ?? 0,
    totalMatches: raw.total_matches ?? 0,
    finishedMatches: raw.finished_matches ?? 0,
  };
}

export default function MisPollasPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [pollas, setPollas] = useState<PollaData[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [endedOpen, setEndedOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);

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
      <header className="px-4 pt-4 pb-3">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button onClick={() => router.push("/inicio")} className="text-text-secondary text-xl">
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#F5F7FA" strokeWidth="2"><path d="M19 12H5M12 5l-7 7 7 7" /></svg>
          </button>
          <h1 className="lp-section-title flex items-center gap-2 text-[22px]">
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#FFD700" strokeWidth="2">
              <path d="M6 9H4.5a2.5 2.5 0 010-5H6" /><path d="M18 9h1.5a2.5 2.5 0 000-5H18" />
              <path d="M4 22h16" /><path d="M18 2H6v7a6 6 0 0012 0V2z" />
            </svg>
            Mis Pollas
          </h1>
        </div>
      </header>

      <main className="max-w-lg mx-auto p-4 space-y-4">
        {/* Join by code entry */}
        <button
          type="button"
          onClick={() => setJoinOpen(true)}
          className="w-full flex items-center justify-between rounded-lg border border-gold/25 bg-gold/5 px-4 py-3 hover:bg-gold/10 transition-colors"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-gold">
            <KeyRound className="w-4 h-4" aria-hidden="true" />
            ¿Tienes un código? Únete
          </span>
          <ArrowRight className="w-4 h-4 text-gold" aria-hidden="true" />
        </button>

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
                    {invite.inviter?.display_name && (
                      <>Invitó: {formatPhone(invite.inviter.display_name)}</>
                    )}{" "}
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
          <h2 className="lp-section-title flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-live dot-active-pulse" style={{ boxShadow: "0 0 5px rgba(0,230,118,0.6)" }} />
            Mis pollas activas
            <span className="text-text-primary font-normal">· {active.length}</span>
          </h2>

          {loading ? (
            <div className="flex flex-col items-center gap-2 py-6">
              <FootballLoader />
              <p className="text-text-muted text-sm">Cargando pollas...</p>
            </div>
          ) : active.length > 0 ? (
            <AnimatedList className="space-y-3">
              {active.map((polla) => (
                <AnimatedItem key={polla.id}>
                  <PollaCard
                    polla={adaptPolla(polla)}
                    userContext={
                      polla.user_rank != null
                        ? {
                            rank: polla.user_rank,
                            totalPoints: polla.user_total_points ?? 0,
                            isLeader: polla.is_leader ?? false,
                          }
                        : undefined
                    }
                    onTap={() => router.push(`/pollas/${polla.slug}`)}
                  />
                </AnimatedItem>
              ))}
            </AnimatedList>
          ) : (
            <PollitoMoment
              moment="M1"
              estado="base"
              userPollitoType="goleador"
              forceDisplay="inline"
              cta={{
                label: "Crear mi primera polla",
                onClick: () => router.push("/pollas/crear"),
              }}
            />
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
              <AnimatedList className="space-y-3">
                {ended.map((polla) => (
                  <AnimatedItem key={polla.id}>
                    <PollaCard
                      polla={adaptPolla(polla)}
                      endedState={
                        polla.winner
                          ? {
                              winnerName: polla.winner.display_name,
                              winnerPoints: polla.winner.total_points,
                            }
                          : undefined
                      }
                      onTap={() => router.push(`/pollas/${polla.slug}`)}
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
          className="w-full bg-gold text-bg-base font-bold rounded-lg py-3 text-sm inline-flex items-center justify-center gap-1.5 hover:brightness-110 transition-all cursor-pointer"
        >
          <Plus size={14} strokeWidth={2.5} />
          Crear nueva polla
        </button>
      </main>

      <JoinByCodeSheet
        open={joinOpen}
        onOpenChange={setJoinOpen}
        onSuccess={(polla) => {
          setJoinOpen(false);
          showToast(`Te uniste a ${polla.name}`, "success");
          router.push(`/pollas/${polla.slug}`);
        }}
      />
    </div>
  );
}
