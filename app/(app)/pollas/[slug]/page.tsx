// app/(app)/pollas/[slug]/page.tsx — Vista completa de una polla: partidos, pronósticos y ranking
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import axios from "axios";

// Tipos basados en el schema de Supabase
interface Polla {
  id: string;
  slug: string;
  name: string;
  description: string;
  tournament: string;
  status: string;
  buy_in_amount: number;
  currency: string;
  payment_mode: string;
  points_exact: number;
  points_winner: number;
  points_one_team: number;
  created_by: string;
}

interface Participant {
  id: string;
  user_id: string;
  role: string;
  total_points: number;
  rank: number;
  paid: boolean;
  users: {
    id: string;
    display_name: string;
    whatsapp_number: string;
    avatar_url: string | null;
  };
}

interface Match {
  id: string;
  home_team: string;
  away_team: string;
  home_team_flag: string;
  away_team_flag: string;
  scheduled_at: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  phase: string;
}

interface Prediction {
  id: string;
  match_id: string;
  predicted_home: number;
  predicted_away: number;
  locked: boolean;
  visible: boolean;
  points_earned: number;
}

type TabType = "partidos" | "ranking";

export default function PollaSlugPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<TabType>("partidos");

  const [polla, setPolla] = useState<Polla | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [currentUserRole, setCurrentUserRole] = useState("");

  // Estado local de pronósticos pendientes de guardar
  const [draftPredictions, setDraftPredictions] = useState<
    Record<string, { home: string; away: string }>
  >({});
  const [savingMatchId, setSavingMatchId] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  useEffect(() => {
    loadPollaData();
  }, [slug]);

  async function loadPollaData() {
    try {
      setLoading(true);
      const { data } = await axios.get(`/api/pollas/${slug}`);
      setPolla(data.polla);
      setParticipants(data.participants);
      setMatches(data.matches);
      setPredictions(data.predictions);
      setCurrentUserId(data.currentUserId);
      setCurrentUserRole(data.currentUserRole);

      // Inicializar drafts con predicciones existentes
      const drafts: Record<string, { home: string; away: string }> = {};
      data.predictions.forEach((pred: Prediction) => {
        drafts[pred.match_id] = {
          home: pred.predicted_home.toString(),
          away: pred.predicted_away.toString(),
        };
      });
      setDraftPredictions(drafts);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error || "Error cargando la polla");
    } finally {
      setLoading(false);
    }
  }

  // Guardar o actualizar un pronóstico individual
  async function savePrediction(matchId: string) {
    const draft = draftPredictions[matchId];
    if (!draft || draft.home === "" || draft.away === "") return;

    setSavingMatchId(matchId);
    try {
      await axios.post(`/api/pollas/${slug}/predictions`, {
        matchId,
        predictedHome: parseInt(draft.home),
        predictedAway: parseInt(draft.away),
      });
      setSaveSuccess(matchId);
      setTimeout(() => setSaveSuccess(null), 2000);
      // Recargar predicciones actualizadas
      const { data } = await axios.get(`/api/pollas/${slug}`);
      setPredictions(data.predictions);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      alert(e.response?.data?.error || "Error guardando pronóstico");
    } finally {
      setSavingMatchId(null);
    }
  }

  function getPredictionForMatch(matchId: string): Prediction | undefined {
    return predictions.find((p) => p.match_id === matchId);
  }

  function formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleDateString("es-CO", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function isMatchLocked(match: Match): boolean {
    if (match.status === "live" || match.status === "finished") return true;
    const fiveMinBefore = new Date(match.scheduled_at).getTime() - 5 * 60 * 1000;
    return Date.now() >= fiveMinBefore;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-3">⚽</div>
          <p className="text-colombia-blue font-medium">Cargando polla...</p>
        </div>
      </div>
    );
  }

  if (error || !polla) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl p-6 text-center shadow-sm max-w-sm w-full">
          <div className="text-4xl mb-3">😕</div>
          <p className="text-gray-700 font-medium mb-4">{error || "Polla no encontrada"}</p>
          <button
            onClick={() => router.push("/dashboard")}
            className="bg-colombia-blue text-white px-6 py-2 rounded-xl font-medium"
          >
            Volver al inicio
          </button>
        </div>
      </div>
    );
  }

  const myParticipant = participants.find((p) => p.user_id === currentUserId);
  const paymentModeLabel: Record<string, string> = {
    honor: "Honor 🤝",
    admin_collects: "Admin recoge 💰",
    digital_pool: "Pozo digital 📲",
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-colombia-blue text-white p-4 shadow-lg">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center gap-3 mb-2">
            <button
              onClick={() => router.push("/dashboard")}
              className="text-colombia-yellow text-xl"
            >
              ←
            </button>
            <h1 className="text-lg font-bold truncate">{polla.name}</h1>
          </div>
          {/* Stats rápidos */}
          <div className="flex gap-4 text-sm text-blue-200">
            <span>{participants.length} participantes</span>
            <span>·</span>
            <span>{paymentModeLabel[polla.payment_mode]}</span>
            {polla.buy_in_amount > 0 && (
              <>
                <span>·</span>
                <span>
                  {new Intl.NumberFormat("es-CO", {
                    style: "currency",
                    currency: polla.currency,
                    maximumFractionDigits: 0,
                  }).format(polla.buy_in_amount)}
                </span>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Mi posición actual */}
      {myParticipant && (
        <div className="bg-colombia-yellow px-4 py-2">
          <div className="max-w-lg mx-auto flex items-center justify-between text-colombia-blue text-sm font-medium">
            <span>Mi posición: #{myParticipant.rank || "—"}</span>
            <span>{myParticipant.total_points} pts</span>
            {polla.payment_mode !== "honor" && (
              <span>{myParticipant.paid ? "✅ Pagado" : "⏳ Pendiente"}</span>
            )}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="max-w-lg mx-auto px-4 pt-4">
        <div className="flex bg-white rounded-xl shadow-sm overflow-hidden border border-gray-200">
          <button
            onClick={() => setActiveTab("partidos")}
            className={`flex-1 py-3 text-sm font-bold transition-colors ${
              activeTab === "partidos"
                ? "bg-colombia-blue text-white"
                : "text-gray-500 hover:text-colombia-blue"
            }`}
          >
            ⚽ Partidos
          </button>
          <button
            onClick={() => setActiveTab("ranking")}
            className={`flex-1 py-3 text-sm font-bold transition-colors ${
              activeTab === "ranking"
                ? "bg-colombia-blue text-white"
                : "text-gray-500 hover:text-colombia-blue"
            }`}
          >
            🏆 Ranking
          </button>
        </div>
      </div>

      <main className="max-w-lg mx-auto p-4 space-y-3">
        {/* TAB: PARTIDOS Y PRONÓSTICOS */}
        {activeTab === "partidos" && (
          <>
            {matches.length === 0 ? (
              <div className="bg-white rounded-xl p-6 text-center shadow-sm">
                <p className="text-gray-500">
                  No hay partidos cargados aún para este torneo.
                </p>
              </div>
            ) : (
              matches.map((match) => {
                const pred = getPredictionForMatch(match.id);
                const draft = draftPredictions[match.id] || {
                  home: pred?.predicted_home?.toString() ?? "",
                  away: pred?.predicted_away?.toString() ?? "",
                };
                const locked = isMatchLocked(match);
                const isSaving = savingMatchId === match.id;
                const justSaved = saveSuccess === match.id;

                return (
                  <div
                    key={match.id}
                    className="bg-white rounded-xl shadow-sm overflow-hidden"
                  >
                    {/* Status badge */}
                    <div
                      className={`px-4 py-1 text-xs font-bold text-center ${
                        match.status === "live"
                          ? "bg-green-500 text-white"
                          : match.status === "finished"
                          ? "bg-gray-400 text-white"
                          : "bg-blue-50 text-colombia-blue"
                      }`}
                    >
                      {match.status === "live"
                        ? "🔴 EN VIVO"
                        : match.status === "finished"
                        ? "✅ FINALIZADO"
                        : formatDate(match.scheduled_at)}
                    </div>

                    <div className="p-4">
                      {/* Equipos y resultado/pronóstico */}
                      <div className="flex items-center gap-3">
                        {/* Equipo local */}
                        <div className="flex-1 text-right">
                          <p className="font-bold text-sm text-gray-800 truncate">
                            {match.home_team_flag && (
                              <span className="mr-1">{match.home_team_flag}</span>
                            )}
                            {match.home_team}
                          </p>
                        </div>

                        {/* Marcador o inputs de pronóstico */}
                        <div className="flex items-center gap-2">
                          {match.status === "finished" || match.status === "live" ? (
                            // Mostrar resultado real
                            <div className="flex items-center gap-1 bg-gray-100 px-3 py-1 rounded-lg">
                              <span className="font-bold text-lg text-gray-800">
                                {match.home_score ?? "—"}
                              </span>
                              <span className="text-gray-400">-</span>
                              <span className="font-bold text-lg text-gray-800">
                                {match.away_score ?? "—"}
                              </span>
                            </div>
                          ) : (
                            // Input de pronóstico
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min={0}
                                max={20}
                                disabled={locked}
                                value={draft.home}
                                onChange={(e) =>
                                  setDraftPredictions((prev) => ({
                                    ...prev,
                                    [match.id]: { ...draft, home: e.target.value },
                                  }))
                                }
                                className={`w-10 h-10 text-center font-bold text-lg border-2 rounded-lg outline-none ${
                                  locked
                                    ? "bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed"
                                    : "border-colombia-yellow focus:border-colombia-blue"
                                }`}
                                placeholder="0"
                              />
                              <span className="text-gray-400 font-bold">-</span>
                              <input
                                type="number"
                                min={0}
                                max={20}
                                disabled={locked}
                                value={draft.away}
                                onChange={(e) =>
                                  setDraftPredictions((prev) => ({
                                    ...prev,
                                    [match.id]: { ...draft, away: e.target.value },
                                  }))
                                }
                                className={`w-10 h-10 text-center font-bold text-lg border-2 rounded-lg outline-none ${
                                  locked
                                    ? "bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed"
                                    : "border-colombia-yellow focus:border-colombia-blue"
                                }`}
                                placeholder="0"
                              />
                            </div>
                          )}
                        </div>

                        {/* Equipo visitante */}
                        <div className="flex-1 text-left">
                          <p className="font-bold text-sm text-gray-800 truncate">
                            {match.away_team_flag && (
                              <span className="mr-1">{match.away_team_flag}</span>
                            )}
                            {match.away_team}
                          </p>
                        </div>
                      </div>

                      {/* Pronóstico guardado y puntos ganados */}
                      {match.status === "finished" && pred && pred.visible && (
                        <div className="mt-2 flex items-center justify-between text-xs">
                          <span className="text-gray-400">
                            Tu pronóstico: {pred.predicted_home} - {pred.predicted_away}
                          </span>
                          <span
                            className={`font-bold ${
                              pred.points_earned > 0 ? "text-green-600" : "text-gray-400"
                            }`}
                          >
                            {pred.points_earned > 0
                              ? `+${pred.points_earned} pts`
                              : "0 pts"}
                          </span>
                        </div>
                      )}

                      {/* Botón guardar pronóstico */}
                      {!locked && match.status === "scheduled" && (
                        <button
                          onClick={() => savePrediction(match.id)}
                          disabled={
                            isSaving ||
                            draft.home === "" ||
                            draft.away === ""
                          }
                          className={`mt-3 w-full py-2 rounded-lg text-sm font-bold transition-colors ${
                            justSaved
                              ? "bg-green-500 text-white"
                              : "bg-colombia-blue text-white hover:bg-blue-800 disabled:opacity-40"
                          }`}
                        >
                          {isSaving
                            ? "Guardando..."
                            : justSaved
                            ? "✅ Guardado"
                            : pred
                            ? "Actualizar pronóstico"
                            : "Guardar pronóstico"}
                        </button>
                      )}

                      {locked && match.status === "scheduled" && (
                        <p className="mt-2 text-xs text-center text-gray-400">
                          🔒 Pronóstico cerrado (menos de 5 minutos para el partido)
                        </p>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </>
        )}

        {/* TAB: RANKING */}
        {activeTab === "ranking" && (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            {participants.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
                No hay participantes aún.
              </div>
            ) : (
              participants.map((participant, index) => {
                const isMe = participant.user_id === currentUserId;
                const medal =
                  index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : null;

                return (
                  <div
                    key={participant.id}
                    className={`flex items-center gap-3 px-4 py-3 border-b border-gray-100 last:border-0 ${
                      isMe ? "bg-yellow-50" : ""
                    }`}
                  >
                    {/* Posición */}
                    <div className="w-8 text-center">
                      {medal ? (
                        <span className="text-xl">{medal}</span>
                      ) : (
                        <span className="text-sm font-bold text-gray-400">
                          #{participant.rank || index + 1}
                        </span>
                      )}
                    </div>

                    {/* Nombre */}
                    <div className="flex-1 min-w-0">
                      <p
                        className={`font-medium text-sm truncate ${
                          isMe ? "text-colombia-blue font-bold" : "text-gray-800"
                        }`}
                      >
                        {participant.users?.display_name || "Usuario"}
                        {isMe && (
                          <span className="ml-1 text-xs text-colombia-blue">(tú)</span>
                        )}
                      </p>
                      {polla.payment_mode !== "honor" && (
                        <p className="text-xs text-gray-400">
                          {participant.paid ? "✅ Pagado" : "⏳ Pendiente"}
                        </p>
                      )}
                    </div>

                    {/* Puntos */}
                    <div className="text-right">
                      <p className="font-bold text-colombia-blue">
                        {participant.total_points} pts
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Botón compartir / invitar (solo admin) */}
        {currentUserRole === "admin" && (
          <div className="pt-2">
            <button
              onClick={() => {
                const url = `${window.location.origin}/unirse/${polla.slug}`;
                navigator.clipboard.writeText(url);
                alert("¡Link copiado! Compártelo con tus amigos por WhatsApp");
              }}
              className="w-full bg-green-500 text-white font-bold py-3 rounded-xl hover:bg-green-600 transition-colors"
            >
              📤 Copiar link de invitación
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
