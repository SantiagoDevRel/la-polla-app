// app/(app)/pollas/[slug]/page.tsx — Vista completa de polla "estadio de noche"
// 4 tabs: Partidos, Ranking, Pagos, Info — con marcadores Bebas Neue y inputs gold glow
"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import axios from "axios";
import { motion } from "framer-motion";
import { staggerContainer, fadeUp } from "@/lib/animations";
import { useToast } from "@/components/ui/Toast";
import ParticipantPayment from "@/components/polla/ParticipantPayment";
import InviteModal from "@/components/polla/InviteModal";
import ScoringExplanation from "@/components/polla/ScoringExplanation";
import UserAvatar from "@/components/ui/UserAvatar";

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

const TRN: Record<string, string> = {
  worldcup_2026: "🌍 Mundial 26", champions_2025: "⭐ Champions",
  liga_betplay_2025: "🇨🇴 BetPlay",
};

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
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

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

  async function savePred(matchId: string) {
    const d = drafts[matchId];
    if (!d || d.home === "" || d.away === "") return;
    setSavingId(matchId);
    try {
      await axios.post(`/api/pollas/${slug}/predictions`, {
        matchId, predictedHome: parseInt(d.home), predictedAway: parseInt(d.away),
      });
      setSavedId(matchId);
      showToast("Pronóstico guardado", "success");
      setTimeout(() => setSavedId(null), 2000);
      const { data } = await axios.get(`/api/pollas/${slug}`);
      setPredictions(data.predictions);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      showToast(e.response?.data?.error || "Error guardando", "error");
    } finally {
      setSavingId(null);
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
          <div className="text-4xl mb-3">⚽</div>
          <p className="text-text-secondary font-medium">Cargando polla...</p>
        </div>
      </div>
    );
  }

  if (error || !polla) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="rounded-2xl p-6 text-center max-w-sm w-full bg-bg-card border border-border-subtle">
          <div className="text-4xl mb-3">😕</div>
          <p className="text-text-primary font-medium mb-4">{error || "Polla no encontrada"}</p>
          <button onClick={() => router.push("/dashboard")} className="bg-gold text-bg-base px-6 py-2 rounded-xl font-semibold">
            Volver
          </button>
        </div>
      </div>
    );
  }

  const myP = participants.find((p) => p.user_id === currentUserId);
  const trnLabel = TRN[polla.tournament] || `⚽ ${polla.tournament}`;

  const TABS: { key: TabType; label: string; show: boolean }[] = [
    { key: "partidos", label: "⚽ Partidos", show: true },
    { key: "ranking", label: "🏆 Ranking", show: true },
    { key: "pagos", label: "💰 Pagos", show: polla.payment_mode === "admin_collects" },
    { key: "info", label: "ℹ️ Info", show: true },
  ];

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="px-4 pt-4 pb-3" style={{ background: "linear-gradient(180deg, #0a1628 0%, var(--bg-base) 100%)" }}>
        <div className="max-w-lg mx-auto">
          <div className="flex items-center gap-3 mb-2">
            <button onClick={() => router.push("/pollas")} className="text-text-secondary text-xl">←</button>
            <h1 className="text-lg font-bold text-text-primary truncate flex-1">{polla.name}</h1>
            <span className="text-[11px] bg-bg-elevated text-text-secondary px-2 py-0.5 rounded-full">{trnLabel}</span>
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
              className={`flex-shrink-0 px-4 py-2.5 text-xs font-semibold whitespace-nowrap transition-colors border-b-2 ${
                activeTab === t.key ? "text-gold border-gold" : "text-text-muted border-transparent hover:text-text-secondary"
              }`}
            >
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
                <p className="text-text-muted">No hay partidos cargados aún.</p>
              </div>
            ) : (
              <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-3">
              {matches.map((match) => {
                const pred = getPred(match.id);
                const draft = drafts[match.id] || { home: pred?.predicted_home?.toString() ?? "", away: pred?.predicted_away?.toString() ?? "" };
                const locked = isLocked(match);
                const saving = savingId === match.id;
                const saved = savedId === match.id;

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
                          <p className="font-semibold text-sm text-text-primary truncate">
                            {match.home_team_flag && <span className="mr-1">{match.home_team_flag}</span>}
                            {match.home_team}
                          </p>
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
                                onChange={(e) => setDrafts((prev) => ({ ...prev, [match.id]: { ...draft, home: e.target.value } }))}
                                className={`w-[52px] h-[52px] text-center score-font text-[28px] rounded-xl outline-none transition-all ${
                                  locked ? "bg-bg-elevated border-border-subtle text-text-muted cursor-not-allowed"
                                  : "bg-bg-elevated border-border-medium text-text-primary focus:border-gold focus:shadow-[0_0_0_2px_rgba(255,215,0,0.3)]"
                                }`}
                                style={{ border: "2px solid" }}
                                placeholder="0"
                              />
                              <span className="text-text-muted font-bold">—</span>
                              <input type="number" min={0} max={20} disabled={locked} value={draft.away}
                                onChange={(e) => setDrafts((prev) => ({ ...prev, [match.id]: { ...draft, away: e.target.value } }))}
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
                          <p className="font-semibold text-sm text-text-primary truncate">
                            {match.away_team_flag && <span className="mr-1">{match.away_team_flag}</span>}
                            {match.away_team}
                          </p>
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

                      {/* Save button */}
                      {!locked && match.status === "scheduled" && (
                        <button onClick={() => savePred(match.id)}
                          disabled={saving || draft.home === "" || draft.away === ""}
                          className={`mt-3 w-full py-2.5 rounded-xl text-sm font-semibold uppercase tracking-wide transition-all ${
                            saved ? "bg-green-live text-bg-base" : "bg-gold text-bg-base hover:brightness-110 disabled:opacity-30"
                          }`}
                        >
                          {saving ? "Guardando..." : saved ? "✅ Guardado" : pred ? "Actualizar" : "Guardar"}
                        </button>
                      )}

                      {locked && match.status === "scheduled" && (
                        <p className="mt-2 text-xs text-center text-text-muted">🔒 CERRADO</p>
                      )}
                    </div>
                  </motion.div>
                );
              })}
              </motion.div>
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
                  const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : null;

                  return (
                    <div key={p.id}
                      className={`flex items-center gap-3 px-4 py-3 border-b border-border-subtle last:border-0 ${isMe ? "bg-gold-dim" : ""}`}
                      style={isMe ? { borderLeft: "2px solid var(--gold)" } : undefined}
                    >
                      <div className="w-8 text-center">
                        {medal ? <span className="text-xl">{medal}</span> :
                          <span className={`score-font text-[20px] ${i < 3 ? "text-gold" : "text-text-muted"}`}>
                            {p.rank || i + 1}
                          </span>
                        }
                      </div>
                      <UserAvatar userId={p.user_id} avatarUrl={p.users?.avatar_url} displayName={p.users?.display_name} size="sm" />
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
              <span className="text-3xl">🤝</span>
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
                  { label: "Torneo", value: trnLabel },
                  { label: "Tipo", value: polla.type === "closed" ? "🔒 Privada" : "🌐 Abierta" },
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
              📤 Invitar amigos
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
