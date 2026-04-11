// app/(app)/pollas/[slug]/page.tsx — Vista completa de polla "estadio de noche"
// 4 tabs: Partidos, Ranking, Pagos, Info — con marcadores Bebas Neue y inputs gold glow
"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import axios from "axios";
import { motion } from "framer-motion";
import { staggerContainer, fadeUp } from "@/lib/animations";
import { useToast } from "@/components/ui/Toast";
import ParticipantPayment from "@/components/polla/ParticipantPayment";
import InviteModal from "@/components/polla/InviteModal";
import ScoringExplanation from "@/components/polla/ScoringExplanation";
import UserAvatar from "@/components/ui/UserAvatar";
import TournamentBadge from "@/components/shared/TournamentBadge";
import { getTournamentBySlug } from "@/lib/tournaments";
import { Target, Trophy, Banknote, Info, Lock, Share2, Handshake } from "lucide-react";

// ─── Tipos ───

interface Polla {
  id: string; slug: string; name: string; description: string;
  tournament: string; status: string; buy_in_amount: number; currency: string;
  payment_mode: string; points_exact: number; points_winner: number;
  points_one_team: number; created_by: string; scope: string; type: string;
  admin_payment_instructions: string | null;
}
interface Participant {
  id: string; user_id: string; role: string; total_points: number; rank: number;
  paid: boolean;
  users: { id: string; display_name: string; whatsapp_number: string; avatar_url: string | null };
}
interface Match {
  id: string; home_team: string; away_team: string; home_team_flag: string;
  away_team_flag: string; scheduled_at: string; status: string;
  home_score: number | null; away_score: number | null; phase: string;
}
interface Prediction {
  id: string; match_id: string; predicted_home: number; predicted_away: number;
  locked: boolean; visible: boolean; points_earned: number;
}

type TabType = "partidos" | "ranking" | "pagos" | "info";

// TeamCrest — renders flag URL as img, falls back to 3-letter abbreviation
function TeamCrest({ flagUrl, teamName }: { flagUrl: string | null; teamName: string }) {
  if (flagUrl) {
    return (
      <img
        src={flagUrl}
        alt={teamName}
        width={24}
        height={24}
        style={{ objectFit: "contain", borderRadius: "50%" }}
        onError={(e) => { e.currentTarget.style.display = "none"; }}
      />
    );
  }
  return (
    <span style={{
      width: 24, height: 24, borderRadius: "50%",
      background: "#1a2540", display: "flex",
      alignItems: "center", justifyContent: "center",
      fontSize: 8, fontWeight: 700, color: "#7a8499",
    }}>
      {teamName.slice(0, 3).toUpperCase()}
    </span>
  );
}

export default function PollaSlugPage() {
  const params = useParams();
  const router = useRouter();
  const { showToast } = useToast();
  const slug = params.slug as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<TabType>("partidos");
  const [showInviteModal, setShowInviteModal] = useState(false);

  const [polla, setPolla] = useState<Polla | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [currentUserRole, setCurrentUserRole] = useState("");

  const [drafts, setDrafts] = useState<Record<string, { home: string; away: string }>>({});
  const [savingAll, setSavingAll] = useState(false);
  const [isNonParticipant, setIsNonParticipant] = useState(false);
  const [joining, setJoining] = useState(false);
  const [touchedMatches, setTouchedMatches] = useState<Set<string>>(new Set());
  const awayInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await axios.get(`/api/pollas/${slug}`);
      setPolla(data.polla);
      setParticipants(data.participants);
      setMatches(data.matches);
      setPredictions(data.predictions);
      setCurrentUserId(data.currentUserId);
      setCurrentUserRole(data.currentUserRole);
      setIsNonParticipant(data.isNonParticipant || false);
      const d: Record<string, { home: string; away: string }> = {};
      data.predictions.forEach((p: Prediction) => {
        d[p.match_id] = { home: p.predicted_home.toString(), away: p.predicted_away.toString() };
      });
      setDrafts(d);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error || "Error cargando la polla");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { loadData(); }, [loadData]);

  // Get match IDs that have been touched and have both scores filled
  const pendingSaveIds = Array.from(touchedMatches).filter((matchId) => {
    const d = drafts[matchId];
    return d && d.home !== "" && d.away !== "" && !isLocked(matches.find((m) => m.id === matchId)!);
  });

  async function saveAllPreds() {
    if (pendingSaveIds.length === 0) return;
    setSavingAll(true);
    try {
      await Promise.all(
        pendingSaveIds.map((matchId) => {
          const d = drafts[matchId];
          return axios.post(`/api/pollas/${slug}/predictions`, {
            matchId, predictedHome: parseInt(d.home), predictedAway: parseInt(d.away),
          });
        })
      );
      showToast(`${pendingSaveIds.length} pronóstico${pendingSaveIds.length > 1 ? "s" : ""} guardado${pendingSaveIds.length > 1 ? "s" : ""}`, "success");
      setTouchedMatches(new Set());
      const { data } = await axios.get(`/api/pollas/${slug}`);
      setPredictions(data.predictions);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      showToast(e.response?.data?.error || "Error guardando", "error");
    } finally {
      setSavingAll(false);
    }
  }

  function getPred(matchId: string) { return predictions.find((p) => p.match_id === matchId); }

  function fmtDate(d: string) {
    return new Date(d).toLocaleDateString("es-CO", {
      weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  }

  function isLocked(m: Match) {
    if (m.status === "live" || m.status === "finished") return true;
    return Date.now() >= new Date(m.scheduled_at).getTime() - 5 * 60 * 1000;
  }

  // Loading skeleton
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center animate-fade-in">
          <div className="mb-3"><Target className="w-10 h-10 text-gold mx-auto" /></div>
          <p className="text-text-secondary font-medium">Cargando polla...</p>
        </div>
      </div>
    );
  }

  if (error || !polla) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="rounded-2xl p-6 text-center max-w-sm w-full bg-bg-card border border-border-subtle">
          <div className="mb-3"><Info className="w-10 h-10 text-text-muted mx-auto" /></div>
          <p className="text-text-primary font-medium mb-4">{error || "Polla no encontrada"}</p>
          <button onClick={() => router.push("/dashboard")} className="bg-gold text-bg-base px-6 py-2 rounded-xl font-semibold">
            Volver
          </button>
        </div>
      </div>
    );
  }

  async function joinPolla() {
    setJoining(true);
    try {
      await axios.post(`/api/pollas/${slug}/join`);
      showToast("Te uniste a la polla", "success");
      setIsNonParticipant(false);
      loadData();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      showToast(e.response?.data?.error || "Error al unirse", "error");
    } finally {
      setJoining(false);
    }
  }

  const myP = participants.find((p) => p.user_id === currentUserId);

  // Non-participant view for open pollas
  if (isNonParticipant && polla.type === "open") {
    return (
      <div className="min-h-screen">
        <header className="px-4 pt-4 pb-3" style={{ background: "linear-gradient(180deg, #0a1628 0%, var(--bg-base) 100%)" }}>
          <div className="max-w-lg mx-auto">
            <div className="flex items-center gap-3 mb-2">
              <button onClick={() => router.push("/pollas")} className="text-text-secondary text-xl">←</button>
              <h1 className="text-lg font-bold text-text-primary truncate flex-1">{polla.name}</h1>
            </div>
          </div>
        </header>
        <main className="max-w-lg mx-auto p-4 space-y-4">
          <div className="rounded-2xl p-6 text-center bg-bg-card border border-border-subtle space-y-4">
            <Target className="w-12 h-12 text-gold mx-auto" />
            <h2 className="font-display text-2xl text-text-primary tracking-wide">POLLA ABIERTA</h2>
            {polla.description && <p className="text-sm text-text-secondary">{polla.description}</p>}
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-xl p-2 bg-bg-elevated">
                <p className="text-[10px] text-text-muted">Torneo</p>
                <p className="font-medium text-text-primary text-sm">{getTournamentBySlug(polla.tournament)?.name || polla.tournament}</p>
              </div>
              <div className="rounded-xl p-2 bg-bg-elevated">
                <p className="text-[10px] text-text-muted">Buy-in</p>
                <p className="font-medium text-text-primary text-sm">${polla.buy_in_amount?.toLocaleString("es-CO")} {polla.currency}</p>
              </div>
            </div>
            <button
              onClick={joinPolla}
              disabled={joining}
              className="w-full bg-gold text-bg-base font-semibold py-3 rounded-xl hover:brightness-110 transition-all disabled:opacity-50 cursor-pointer"
            >
              {joining ? "Uniéndose..." : "Unirse a la polla"}
            </button>
          </div>
        </main>
      </div>
    );
  }

  // Non-participant view for closed pollas (should rarely reach here due to API 403)
  if (isNonParticipant && polla.type === "closed") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="rounded-2xl p-6 text-center max-w-sm w-full bg-bg-card border border-border-subtle space-y-3">
          <Lock className="w-10 h-10 text-text-muted mx-auto" />
          <p className="text-text-primary font-medium">Esta polla es privada</p>
          <p className="text-sm text-text-secondary">El admin debe invitarte para participar.</p>
          <button onClick={() => router.push("/pollas")} className="bg-gold text-bg-base px-6 py-2 rounded-xl font-semibold cursor-pointer">
            Volver
          </button>
        </div>
      </div>
    );
  }

  const TABS: { key: TabType; label: string; icon: React.ReactNode; show: boolean }[] = [
    { key: "partidos", label: "Partidos", icon: <Target className="w-4 h-4" />, show: true },
    { key: "ranking", label: "Ranking", icon: <Trophy className="w-4 h-4" />, show: true },
    { key: "pagos", label: "Pagos", icon: <Banknote className="w-4 h-4" />, show: polla.payment_mode === "admin_collects" },
    { key: "info", label: "Info", icon: <Info className="w-4 h-4" />, show: true },
  ];

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="px-4 pt-4 pb-3" style={{ background: "linear-gradient(180deg, #0a1628 0%, var(--bg-base) 100%)" }}>
        <div className="max-w-lg mx-auto">
          <div className="flex items-center gap-3 mb-2">
            <button onClick={() => router.push("/pollas")} className="text-text-secondary text-xl">←</button>
            <h1 className="text-lg font-bold text-text-primary truncate flex-1">{polla.name}</h1>
            <span
              className="text-[11px] text-text-secondary rounded-full flex items-center"
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 20,
                padding: "4px 10px",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <TournamentBadge tournamentSlug={polla.tournament} size="sm" />
            </span>
          </div>
        </div>
      </header>

      {/* Position band */}
      {myP && (
        <div className="px-4 py-1.5" style={{ backgroundColor: "var(--gold-dim)" }}>
          <div className="max-w-lg mx-auto flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gold">#{myP.rank || "—"} · {myP.total_points} pts</span>
              <ScoringExplanation />
            </div>
            <span className="text-xs text-text-secondary">{myP.paid ? "Pagado" : "Pendiente"}</span>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="max-w-lg mx-auto px-4 pt-3">
        <div className="flex overflow-x-auto gap-0 border-b border-border-subtle" style={{ scrollbarWidth: "none" }}>
          {TABS.filter((t) => t.show).map((t) => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              className={`flex-shrink-0 px-4 py-2.5 text-[13px] font-semibold whitespace-nowrap transition-colors border-b-2 flex items-center gap-1.5 ${
                activeTab === t.key ? "text-gold border-gold" : "text-text-muted border-transparent hover:text-text-secondary"
              }`}
              style={{ color: activeTab === t.key ? "#FFD700" : "#7a8499" }}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <main className="max-w-lg mx-auto p-4 space-y-3">
        {/* ── TAB PARTIDOS ── */}
        {activeTab === "partidos" && (
          <>
            {matches.length === 0 ? (
              <div className="rounded-2xl p-6 text-center bg-bg-card border border-border-subtle">
                <p className="text-text-muted">No hay partidos cargados aun. Los partidos se actualizaran cuando el calendario sea confirmado.</p>
              </div>
            ) : (
              <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-3">
              {matches.map((match) => {
                const pred = getPred(match.id);
                const draft = drafts[match.id] || { home: pred?.predicted_home?.toString() ?? "", away: pred?.predicted_away?.toString() ?? "" };
                const locked = isLocked(match);

                return (
                  <motion.div key={match.id} variants={fadeUp} className="rounded-2xl overflow-hidden bg-bg-card border border-border-subtle">
                    {/* Status badge */}
                    <div className={`px-4 py-1.5 text-[11px] font-bold text-center ${
                      match.status === "live" ? "bg-green-dim text-green-live" :
                      match.status === "finished" ? "bg-bg-elevated text-text-muted" :
                      "text-text-secondary"
                    }`} style={match.status === "scheduled" ? { backgroundColor: "var(--bg-card-elevated)" } : undefined}>
                      {match.status === "live" ? (
                        <span className="flex items-center justify-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-green-live animate-pulse-live" />
                          EN VIVO
                        </span>
                      ) : match.status === "finished" ? "FINALIZADO" : fmtDate(match.scheduled_at)}
                    </div>

                    <div className="p-4">
                      <div className="flex items-center gap-3">
                        {/* Home */}
                        <div className="flex-1 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <p className="font-semibold text-sm text-text-primary truncate">{match.home_team}</p>
                            <TeamCrest flagUrl={match.home_team_flag} teamName={match.home_team} />
                          </div>
                        </div>

                        {/* Score / Input */}
                        <div className="flex items-center gap-2">
                          {match.status === "finished" || match.status === "live" ? (
                            <div className="flex items-center gap-2 px-3">
                              <span className={`score-font ${match.status === "live" ? "text-gold text-[48px]" : "text-text-primary text-[40px]"}`}>
                                {match.home_score ?? "—"}
                              </span>
                              <span className="text-text-muted text-lg">—</span>
                              <span className={`score-font ${match.status === "live" ? "text-gold text-[48px]" : "text-text-primary text-[40px]"}`}>
                                {match.away_score ?? "—"}
                              </span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <input type="number" min={0} max={20} disabled={locked} value={draft.home}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setDrafts((prev) => ({ ...prev, [match.id]: { ...draft, home: val } }));
                                  setTouchedMatches((prev) => new Set(prev).add(match.id));
                                  if (val.length >= 1) awayInputRefs.current[match.id]?.focus();
                                }}
                                className={`w-[52px] h-[52px] text-center score-font text-[28px] rounded-xl outline-none transition-all ${
                                  locked ? "bg-bg-elevated border-border-subtle text-text-muted cursor-not-allowed"
                                  : "bg-bg-elevated border-border-medium text-text-primary focus:border-gold focus:shadow-[0_0_0_2px_rgba(255,215,0,0.3)]"
                                }`}
                                style={{ border: "2px solid" }}
                                placeholder="0"
                              />
                              <span className="text-text-muted font-bold">—</span>
                              <input type="number" min={0} max={20} disabled={locked} value={draft.away}
                                ref={(el) => { awayInputRefs.current[match.id] = el; }}
                                onChange={(e) => {
                                  setDrafts((prev) => ({ ...prev, [match.id]: { ...draft, away: e.target.value } }));
                                  setTouchedMatches((prev) => new Set(prev).add(match.id));
                                }}
                                className={`w-[52px] h-[52px] text-center score-font text-[28px] rounded-xl outline-none transition-all ${
                                  locked ? "bg-bg-elevated border-border-subtle text-text-muted cursor-not-allowed"
                                  : "bg-bg-elevated border-border-medium text-text-primary focus:border-gold focus:shadow-[0_0_0_2px_rgba(255,215,0,0.3)]"
                                }`}
                                style={{ border: "2px solid" }}
                                placeholder="0"
                              />
                            </div>
                          )}
                        </div>

                        {/* Away */}
                        <div className="flex-1 text-left">
                          <div className="flex items-center gap-2">
                            <TeamCrest flagUrl={match.away_team_flag} teamName={match.away_team} />
                            <p className="font-semibold text-sm text-text-primary truncate">{match.away_team}</p>
                          </div>
                        </div>
                      </div>

                      {/* Previous prediction + points */}
                      {match.status === "finished" && pred && pred.visible && (
                        <div className="mt-2 flex items-center justify-between text-xs">
                          <span className="text-text-muted">Tu pronóstico: {pred.predicted_home} - {pred.predicted_away}</span>
                          <span className={`font-bold ${pred.points_earned > 0 ? "text-gold" : "text-text-muted"}`}>
                            {pred.points_earned > 0 ? `+${pred.points_earned} pts` : "0 pts"}
                          </span>
                        </div>
                      )}

                      {locked && match.status === "scheduled" && (
                        <p className="mt-2 text-xs text-center text-text-muted flex items-center justify-center gap-1"><Lock className="w-3 h-3" /> CERRADO</p>
                      )}
                    </div>
                  </motion.div>
                );
              })}
              </motion.div>
            )}

            {/* Sticky bulk save button */}
            {pendingSaveIds.length > 0 && (
              <div className="fixed bottom-20 left-0 right-0 px-4 z-30">
                <div className="max-w-lg mx-auto">
                  <button
                    onClick={saveAllPreds}
                    disabled={savingAll}
                    className="w-full bg-gold text-bg-base font-display text-lg tracking-wide py-3.5 rounded-xl hover:brightness-110 transition-all disabled:opacity-50 shadow-[0_0_24px_rgba(255,215,0,0.25)] cursor-pointer"
                  >
                    {savingAll ? "Guardando..." : `GUARDAR ${pendingSaveIds.length} PRONÓSTICO${pendingSaveIds.length > 1 ? "S" : ""}`}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── TAB RANKING ── */}
        {activeTab === "ranking" && (
          <div className="rounded-2xl overflow-hidden bg-bg-card border border-border-subtle">
            {participants.length === 0 ? (
              <div className="p-6 text-center text-text-muted">No hay participantes aún.</div>
            ) : (
              <>
                {matches.every((m) => m.status === "scheduled") && (
                  <div className="px-4 py-3 text-xs text-text-secondary text-center" style={{ backgroundColor: "var(--bg-card-elevated)" }}>
                    El ranking se actualiza cuando terminen los partidos
                  </div>
                )}
                {participants.map((p, i) => {
                  const isMe = p.user_id === currentUserId;
                  const medalColor = i === 0 ? "#FFD700" : i === 1 ? "#C0C0C0" : i === 2 ? "#CD7F32" : null;

                  return (
                    <div key={p.id}
                      className={`flex items-center gap-3 px-4 py-3 border-b border-border-subtle last:border-0 ${isMe ? "bg-gold-dim" : ""}`}
                      style={isMe ? { borderLeft: "2px solid var(--gold)" } : undefined}
                    >
                      <div className="w-8 text-center">
                        {medalColor ? (
                          <Trophy className="w-5 h-5 mx-auto" style={{ color: medalColor }} />
                        ) : (
                          <span className={`score-font text-[20px] ${i < 3 ? "text-gold" : "text-text-muted"}`}>
                            {p.rank || i + 1}
                          </span>
                        )}
                      </div>
                      <UserAvatar avatarUrl={p.users?.avatar_url} displayName={p.users?.display_name} size="sm" />
                      <div className="flex-1 min-w-0">
                        <p className={`font-medium text-sm truncate ${isMe ? "text-gold font-bold" : "text-text-primary"}`}>
                          {p.users?.display_name || "Usuario"}
                          {isMe && <span className="ml-1 text-xs text-gold">(tú)</span>}
                        </p>
                        <p className="text-xs text-text-muted">{p.paid ? "Pagado" : "Pendiente"}</p>
                      </div>
                      <span className="score-font text-[18px] text-text-primary">{p.total_points}</span>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}

        {/* ── TAB PAGOS ── */}
        {activeTab === "pagos" && (
          polla.payment_mode === "admin_collects" ? (
            <ParticipantPayment pollaSlug={polla.slug} currentUserId={currentUserId} currentUserRole={currentUserRole} />
          ) : (
            <div className="rounded-2xl p-6 text-center bg-bg-card border border-border-subtle">
              <Handshake className="w-8 h-8 text-text-muted mx-auto" />
              <p className="text-text-secondary mt-2">No hay pagos para esta polla</p>
            </div>
          )
        )}

        {/* ── TAB INFO ── */}
        {activeTab === "info" && (
          <div className="space-y-4">
            <div className="rounded-2xl p-5 space-y-3 bg-bg-card border border-border-subtle">
              <h3 className="font-bold text-text-primary">{polla.name}</h3>
              {polla.description && <p className="text-sm text-text-secondary">{polla.description}</p>}
              <div className="grid grid-cols-2 gap-2 text-sm">
                {[
                  { label: "Torneo", value: getTournamentBySlug(polla.tournament)?.name || polla.tournament },
                  { label: "Tipo", value: polla.type === "closed" ? "Privada" : "Abierta" },
                  { label: "Participantes", value: String(participants.length) },
                  { label: "Pago", value: polla.payment_mode === "admin_collects" ? "Admin" : "Digital" },
                ].map((item) => (
                  <div key={item.label} className="rounded-xl p-2 bg-bg-elevated">
                    <p className="text-[10px] text-text-muted">{item.label}</p>
                    <p className="font-medium text-text-primary text-sm">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl p-5 bg-bg-card border border-border-subtle">
              <h4 className="font-bold text-text-primary mb-2">Sistema de puntos</h4>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-text-secondary">Marcador exacto</span><span className="font-bold text-gold">{polla.points_exact} pts</span></div>
                <div className="flex justify-between"><span className="text-text-secondary">Resultado correcto</span><span className="font-bold text-blue-info">{polla.points_winner} pts</span></div>
                <div className="flex justify-between"><span className="text-text-secondary">Un equipo exacto</span><span className="font-bold text-text-secondary">{polla.points_one_team} pt</span></div>
              </div>
            </div>

            <button onClick={() => setShowInviteModal(true)} className="w-full bg-gold text-bg-base font-semibold py-3 rounded-xl hover:brightness-110 transition-all">
              <Share2 className="w-4 h-4 inline-block mr-1" /> Invitar amigos
            </button>
          </div>
        )}
      </main>

      {showInviteModal && (
        <InviteModal pollaSlug={polla.slug} pollaName={polla.name} isOpen={showInviteModal} onClose={() => setShowInviteModal(false)} />
      )}
    </div>
  );
}
