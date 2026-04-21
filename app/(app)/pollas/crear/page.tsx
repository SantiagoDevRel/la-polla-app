// app/(app)/pollas/crear/page.tsx — Wizard de 3 pasos para crear una nueva polla
// Paso 1: Info (nombre, torneo, tipo)
// Paso 2: Partidos (selección de partidos del torneo)
// Paso 3: Configuración (cuota de entrada + modo de pago + instrucciones)
"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import axios from "axios";
import { motion } from "framer-motion";
import { staggerContainer } from "@/lib/animations";
import { ArrowLeft, Check, ChevronRight, Info, Trophy, Banknote, Smartphone, Handshake, Lock } from "lucide-react";
import { formatCOP } from "@/lib/formatCurrency";
import { TOURNAMENTS } from "@/lib/tournaments";
import FootballLoader from "@/components/ui/FootballLoader";

// ─── Tipos ───

type PaymentMode = "digital_pool" | "admin_collects" | "pay_winner";
type Step = 1 | 2 | 3;

interface FormState {
  name: string;
  tournament: string;
  type: "open" | "closed";
  buyInAmount: number;
  paymentMode: PaymentMode;
  adminPaymentInstructions: string;
}

interface MatchRow {
  id: string;
  external_id: string;
  tournament: string;
  home_team: string;
  away_team: string;
  home_team_flag: string | null;
  away_team_flag: string | null;
  scheduled_at: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  match_day: number | null;
  phase: string | null;
  venue: string | null;
}

// ─── Datos de configuración ───

const PAYMENT_MODE_OPTIONS = [
  {
    value: "admin_collects" as PaymentMode,
    title: "Cuota de entrada",
    icon: "banknote",
    description: "Cada participante le paga al organizador (tú) antes de entrar a la polla.",
    tag: "Recomendado",
  },
  {
    value: "digital_pool" as PaymentMode,
    title: "Pago digital",
    icon: "smartphone",
    description: "Los participantes pagan en línea al unirse — el dinero se libera al ganador al final.",
    tag: "Online",
  },
  {
    value: "pay_winner" as PaymentMode,
    title: "Pago al ganador",
    icon: "handshake",
    description: "Al terminar la polla, cada participante le paga directamente al ganador.",
    tag: "Al final",
  },
];

const PAYMENT_MODE_HINTS: Record<PaymentMode, string> = {
  admin_collects: "💡 Cada uno te paga antes de entrar. Tú guardas el pozo.",
  pay_winner: "💡 Al final, todos le pagan directamente al ganador.",
  digital_pool: "El pago es automático. El ganador recibe el pozo menos la comisión de la plataforma (10% del total).",
};

type GroupBy = "date" | "jornada" | "phase";

// ─── Componente principal ───

export default function CrearPollaPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [customBuyIn, setCustomBuyIn] = useState(false);
  const [form, setForm] = useState<FormState>({
    name: "",
    tournament: "champions_2025",
    type: "closed",
    buyInAmount: 10000,
    paymentMode: "pay_winner",
    adminPaymentInstructions: "",
  });

  // Match selection state
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [selectedMatchIds, setSelectedMatchIds] = useState<Set<string>>(new Set());
  const [groupBy, setGroupBy] = useState<GroupBy>("date");

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // Public pollas (type='open') must use digital_pool — no admin to collect from
  // the parche of strangers that joins through the link.
  useEffect(() => {
    if (form.type === "open" && form.paymentMode !== "digital_pool") {
      setForm((prev) => ({ ...prev, paymentMode: "digital_pool" }));
    }
  }, [form.type, form.paymentMode]);

  // Fetch matches when tournament changes and we're on step 2
  useEffect(() => {
    if (step !== 2) return;
    async function loadMatches() {
      setMatchesLoading(true);
      try {
        const { data } = await axios.get(`/api/matches?tournament=${form.tournament}&status=scheduled`);
        // Filter out anything already within 5 minutes of kickoff or in the past —
        // those can't be predicted anymore, so they shouldn't be selectable.
        const bufferMs = 5 * 60 * 1000;
        const cutoff = Date.now() + bufferMs;
        const upcoming = (data.matches || []).filter(
          (m: MatchRow) => new Date(m.scheduled_at).getTime() > cutoff
        );
        setMatches(upcoming);
      } catch {
        setMatches([]);
      } finally {
        setMatchesLoading(false);
      }
    }
    loadMatches();
  }, [step, form.tournament]);

  // Group matches
  const groupedMatches = useMemo(() => {
    const groups: { key: string; label: string; matchIds: string[]; matches: MatchRow[] }[] = [];
    const map = new Map<string, { label: string; matches: MatchRow[] }>();

    for (const m of matches) {
      let key: string;
      let label: string;

      if (groupBy === "date") {
        const d = new Date(m.scheduled_at);
        key = d.toISOString().split("T")[0];
        label = d.toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" });
        label = label.charAt(0).toUpperCase() + label.slice(1);
      } else if (groupBy === "jornada") {
        key = `md-${m.match_day ?? "sin"}`;
        label = m.match_day ? `Jornada ${m.match_day}` : "Sin jornada";
      } else {
        key = m.phase || "unknown";
        label = formatPhase(m.phase);
      }

      if (!map.has(key)) map.set(key, { label, matches: [] });
      map.get(key)!.matches.push(m);
    }

    map.forEach(({ label, matches: ms }, key) => {
      groups.push({ key, label, matchIds: ms.map((m: MatchRow) => m.id), matches: ms });
    });

    return groups;
  }, [matches, groupBy]);

  function formatPhase(phase: string | null): string {
    const labels: Record<string, string> = {
      group_stage: "Fase de grupos",
      league_stage: "Fase de liga",
      regular_season: "Temporada regular",
      round_of_32: "Dieciseisavos",
      round_of_16: "Octavos de final",
      quarter_finals: "Cuartos de final",
      semi_finals: "Semifinales",
      final: "Final",
      third_place: "Tercer puesto",
      playoff: "Playoffs",
    };
    return labels[phase || ""] || phase || "Otros";
  }

  function toggleMatch(id: string) {
    setSelectedMatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }

  function toggleGroup(matchIds: string[]) {
    const allSelected = matchIds.every((id) => selectedMatchIds.has(id));
    setSelectedMatchIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        matchIds.forEach((id) => next.delete(id));
      } else {
        matchIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  function selectAll() {
    setSelectedMatchIds(new Set(matches.map((m) => m.id)));
  }

  function deselectAll() {
    setSelectedMatchIds(new Set());
  }

  // Validation and navigation
  function goToStep(targetStep: Step) {
    setError("");
    if (targetStep > step) {
      if (step === 1) {
        if (form.name.trim().length < 3) { setError("El nombre debe tener al menos 3 caracteres"); return; }
        if (!form.tournament) { setError("Selecciona un torneo"); return; }
      }
      if (step === 2) {
        if (selectedMatchIds.size === 0) { setError("Selecciona al menos 1 partido"); return; }
      }
    }
    setStep(targetStep);
  }

  // Submit
  async function handleSubmit() {
    setError("");
    if (form.buyInAmount < 1000) { setError("El valor mínimo es $1.000"); return; }
    if (form.paymentMode === "admin_collects" && form.adminPaymentInstructions.trim() === "") {
      setError("Debes indicar instrucciones de pago"); return;
    }

    setLoading(true);
    try {
      const { data } = await axios.post<{
        polla: { slug: string } | null;
        checkoutUrl: string | null;
        reference: string | null;
      }>("/api/pollas", {
        ...form,
        scope: "custom",
        matchIds: Array.from(selectedMatchIds),
      });
      // Pay-first path (digital_pool + buy_in > 0): polla isn't created yet,
      // webhook will materialize it. Stash the reference and jump to Wompi.
      // Wompi flow hidden from UI as of the MVP cut. Keep for future re-enable;
      // this branch is currently unreachable because digital_pool cannot be
      // selected from the payment picker.
      if (data.checkoutUrl && data.reference) {
        sessionStorage.setItem("pollaDraftReference", data.reference);
        window.location.href = data.checkoutUrl;
        return;
      }
      if (data.polla) {
        router.push(`/pollas/${data.polla.slug}`);
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error || "Error al crear la polla");
    } finally {
      setLoading(false);
    }
  }

  const STEP_LABELS = ["Info", "Partidos", "Configuración"];

  const tournamentMeta = TOURNAMENTS.find((t) => t.slug === form.tournament);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="px-4 pt-4 pb-5" style={{ background: "linear-gradient(180deg, #0a1628 0%, var(--bg-base) 100%)" }}>
        <div className="max-w-lg mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <button onClick={() => (step === 1 ? router.back() : goToStep((step - 1) as Step))} className="text-text-secondary hover:text-gold transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-lg font-bold text-text-primary">Crear nueva polla</h1>
          </div>

          {/* Stepper — 3 steps. Connectors use flex-1 inside a constrained
              max-w band so the circles span edge-to-edge instead of
              clustering in the middle after the 4→3 collapse. */}
          <div className="flex items-center max-w-xs mx-auto">
            {[1, 2, 3].map((s) => (
              <div key={s} className={`flex items-center ${s < 3 ? "flex-1" : ""}`}>
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold transition-all shrink-0 ${
                  s < step ? "bg-green-live text-bg-base" : s === step ? "bg-gold text-bg-base shadow-[0_0_12px_rgba(255,215,0,0.3)]" : "bg-bg-elevated border border-border-subtle text-text-muted"
                }`}>
                  {s < step ? <Check className="w-3.5 h-3.5" /> : s}
                </div>
                {s < 3 && <div className={`flex-1 h-0.5 transition-colors ${s < step ? "bg-green-live" : "bg-border-subtle"}`} />}
              </div>
            ))}
          </div>
          <div className="flex justify-center gap-4 mt-1">
            {STEP_LABELS.map((label, i) => (
              <span key={label} className={`text-[9px] font-medium ${i + 1 === step ? "text-gold" : i + 1 < step ? "text-green-live" : "text-text-muted"}`}>
                {label}
              </span>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto p-4">
        {/* ═══ PASO 1 — Info ═══ */}
        {step === 1 && (
          <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-5">
            <div className="rounded-2xl p-5 space-y-4 bg-bg-card/80 backdrop-blur-sm border border-border-subtle">
              <h2 className="text-base font-bold text-text-primary">Información básica</h2>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">Nombre <span className="text-red-alert">*</span></label>
                <input type="text" value={form.name} onChange={(e) => updateForm("name", e.target.value)} placeholder="Ej: Polla Mundial Oficina"
                  className="w-full px-4 py-3 rounded-xl outline-none transition-colors bg-bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted focus:ring-1 focus:ring-gold/40 focus:border-gold/50" />
              </div>
            </div>

            <div className="rounded-2xl p-5 space-y-4 bg-bg-card/80 backdrop-blur-sm border border-border-subtle">
              <h2 className="text-base font-bold text-text-primary">Torneo <span className="text-red-alert">*</span></h2>
              <div className="space-y-2">
                {TOURNAMENTS.map((t) => {
                  const isSelected = form.tournament === t.slug;
                  return (
                    <button key={t.slug} type="button" onClick={() => { updateForm("tournament", t.slug); setSelectedMatchIds(new Set()); }}
                      className={`w-full text-left px-4 py-3 rounded-xl border transition-all duration-200 flex items-center gap-3 cursor-pointer ${isSelected ? "border-gold/30 bg-gold/10" : "border-border-subtle hover:border-gold/20 bg-bg-elevated"}`}>
                      <img src={t.logoPath} alt={t.name} width={24} height={24} style={{ objectFit: "contain", borderRadius: 4 }} />
                      <span className="font-medium text-text-primary flex-1">{t.name}</span>
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${isSelected ? "border-gold bg-gold" : "border-border-medium"}`}>
                        {isSelected && <div className="w-2 h-2 rounded-full bg-bg-base" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Tipo de polla: "Abierta" oculto del UI durante el MVP. Todas las
                pollas nuevas quedan como "closed" (Privada). El backend aún
                acepta type='open'; re-habilitar añadiendo la segunda opción. */}
            <div className="rounded-2xl p-5 space-y-2 bg-bg-card/80 backdrop-blur-sm border border-border-subtle">
              <h2 className="text-base font-bold text-text-primary">Tipo de polla</h2>
              <div className="flex items-center gap-2 text-text-secondary text-sm">
                <Lock className="w-4 h-4 text-gold" aria-hidden="true" />
                <span>Tu polla será privada, solo por invitación.</span>
              </div>
            </div>

            {error && <p className="text-red-alert text-sm text-center bg-red-dim rounded-xl p-3">{error}</p>}
            <button type="button" onClick={() => goToStep(2)}
              className="w-full bg-gold text-bg-base font-bold py-4 rounded-xl hover:brightness-110 transition-all text-lg flex items-center justify-center gap-2 cursor-pointer"
              style={{ boxShadow: "0 0 20px rgba(255,215,0,0.15)" }}>
              Siguiente <ChevronRight className="w-5 h-5" />
            </button>
          </motion.div>
        )}

        {/* ═══ PASO 2 — Partidos ═══ */}
        {step === 2 && (
          <div className="space-y-3 pb-20">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-text-primary">Selecciona los partidos</h2>
                <p style={{ fontSize: 12, color: selectedMatchIds.size > 0 ? "#FFD700" : "#7a8499", fontWeight: selectedMatchIds.size > 0 ? 600 : 400 }}>
                  {selectedMatchIds.size > 0 ? `${selectedMatchIds.size} partidos seleccionados` : "Ningún partido seleccionado"}
                </p>
              </div>
              {tournamentMeta && <img src={tournamentMeta.logoPath} alt="" width={28} height={28} style={{ objectFit: "contain", opacity: 0.6 }} />}
            </div>

            {/* Group filters */}
            <div className="hide-scrollbar" style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
              {(["date", "jornada", "phase"] as GroupBy[]).map((g) => (
                <button key={g} onClick={() => setGroupBy(g)} style={{
                  borderRadius: 20, padding: "4px 10px", fontSize: 11, fontWeight: groupBy === g ? 600 : 500, cursor: "pointer", whiteSpace: "nowrap",
                  background: groupBy === g ? "rgba(255,215,0,0.1)" : "#0e1420", color: groupBy === g ? "#FFD700" : "#4a5568",
                  border: groupBy === g ? "1px solid rgba(255,215,0,0.22)" : "1px solid rgba(255,255,255,0.06)", fontFamily: "'Outfit', sans-serif",
                }}>
                  {{ date: "Por fecha", jornada: "Por jornada", phase: "Por fase" }[g]}
                </button>
              ))}
            </div>

            {/* Quick actions */}
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={selectAll} style={{ fontSize: 11, color: "#7a8499", background: "none", border: "none", cursor: "pointer", fontFamily: "'Outfit', sans-serif", textDecoration: "underline" }}>
                Seleccionar todo
              </button>
              <button onClick={deselectAll} style={{ fontSize: 11, color: "#7a8499", background: "none", border: "none", cursor: "pointer", fontFamily: "'Outfit', sans-serif", textDecoration: "underline" }}>
                Deseleccionar todo
              </button>
            </div>

            {matchesLoading ? (
              <div className="flex flex-col items-center gap-2 py-8"><FootballLoader /><p className="text-text-muted text-sm">Cargando partidos...</p></div>
            ) : matches.length === 0 ? (
              <div className="text-center py-8 rounded-2xl bg-bg-card border border-border-subtle">
                <p className="text-text-muted text-sm">No hay partidos programados para este torneo</p>
              </div>
            ) : (
              groupedMatches.map((group) => {
                const allGroupSelected = group.matchIds.every((id) => selectedMatchIds.has(id));
                return (
                  <div key={group.key}>
                    {/* Group header */}
                    <div style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "8px 0 6px", borderBottom: "1px solid rgba(255,255,255,0.06)",
                    }}>
                      <div>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "#f0f4ff" }}>{group.label}</span>
                        <span style={{ fontSize: 11, color: "#4a5568", marginLeft: 6 }}>· {group.matches.length} partidos</span>
                      </div>
                      <button onClick={() => toggleGroup(group.matchIds)} style={{
                        fontSize: 10, color: allGroupSelected ? "#ff3d57" : "#FFD700", background: "none", border: "none", cursor: "pointer", fontFamily: "'Outfit', sans-serif", fontWeight: 600,
                      }}>
                        {allGroupSelected ? "Deseleccionar" : "Sel. todos"} →
                      </button>
                    </div>

                    {/* Match rows */}
                    {group.matches.map((m) => {
                      const isChecked = selectedMatchIds.has(m.id);
                      const time = new Date(m.scheduled_at).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
                      return (
                        <div key={m.id} onClick={() => toggleMatch(m.id)} style={{
                          display: "flex", alignItems: "center", gap: 10, padding: "10px 4px", cursor: "pointer",
                          borderBottom: "1px solid rgba(255,255,255,0.04)", background: isChecked ? "rgba(255,215,0,0.03)" : "transparent",
                        }}>
                          {/* Checkbox */}
                          <div style={{
                            width: 20, height: 20, borderRadius: 4, flexShrink: 0,
                            border: isChecked ? "none" : "1px solid rgba(255,255,255,0.15)",
                            background: isChecked ? "#FFD700" : "transparent",
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}>
                            {isChecked && (
                              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="#080c10" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                            )}
                          </div>

                          {/* Home team */}
                          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                            {m.home_team_flag ? (
                              <Image src={m.home_team_flag} alt={m.home_team} width={20} height={20} style={{ width: 20, height: 20, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                            ) : (
                              <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#131d2e", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 7, color: "#7a8499", flexShrink: 0 }}>
                                {m.home_team.substring(0, 3).toUpperCase()}
                              </div>
                            )}
                            <span style={{ fontSize: 12, fontWeight: 500, color: "#f0f4ff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {m.home_team}
                            </span>
                          </div>

                          <span style={{ fontSize: 10, color: "#4a5568", flexShrink: 0 }}>vs</span>

                          {/* Away team */}
                          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                            {m.away_team_flag ? (
                              <Image src={m.away_team_flag} alt={m.away_team} width={20} height={20} style={{ width: 20, height: 20, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                            ) : (
                              <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#131d2e", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 7, color: "#7a8499", flexShrink: 0 }}>
                                {m.away_team.substring(0, 3).toUpperCase()}
                              </div>
                            )}
                            <span style={{ fontSize: 12, fontWeight: 500, color: "#f0f4ff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {m.away_team}
                            </span>
                          </div>

                          {/* Time */}
                          <span style={{ fontSize: 10, color: "#7a8499", flexShrink: 0, minWidth: 36, textAlign: "right" }}>{time}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })
            )}

            {/* Sticky bottom bar */}
            <div style={{
              position: "fixed", bottom: 68, left: 0, right: 0, background: "#080c10", borderTop: "1px solid #1a2540", padding: "12px 16px",
              display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 40,
            }}>
              <span style={{ fontSize: 12, color: selectedMatchIds.size > 0 ? "#f0f4ff" : "#4a5568" }}>
                {selectedMatchIds.size > 0 ? `${selectedMatchIds.size} partidos` : "Ningún partido"}
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => goToStep(1)} style={{
                  padding: "8px 14px", borderRadius: 10, background: "#131d2e", color: "#7a8499", border: "1px solid rgba(255,255,255,0.08)",
                  fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'Outfit', sans-serif",
                }}>
                  Atrás
                </button>
                <button onClick={() => goToStep(3)} disabled={selectedMatchIds.size === 0} style={{
                  padding: "8px 18px", borderRadius: 10, background: selectedMatchIds.size > 0 ? "#FFD700" : "rgba(255,215,0,0.3)", color: "#080c10",
                  fontSize: 13, fontWeight: 700, cursor: selectedMatchIds.size > 0 ? "pointer" : "default", fontFamily: "'Outfit', sans-serif",
                  opacity: selectedMatchIds.size === 0 ? 0.4 : 1, border: "none",
                }}>
                  Continuar →
                </button>
              </div>
            </div>

            {error && <p className="text-red-alert text-sm text-center bg-red-dim rounded-xl p-3">{error}</p>}
          </div>
        )}

        {/* ═══ PASO 3 — Configuración (cuota + modo de pago + instrucciones) ═══ */}
        {step === 3 && (
          <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-5">
            {/* Sección 1: Cuota de entrada */}
            <div className="rounded-2xl p-5 space-y-4 bg-bg-card/80 backdrop-blur-sm border border-border-subtle">
              <div>
                <h2 className="text-base font-bold text-text-primary flex items-center gap-2">
                  Cuota de entrada <span className="text-red-alert">*</span>
                  <span className="inline-flex items-center justify-center cursor-pointer" title="Cuota por persona" style={{ color: "#4a5568" }}>
                    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
                  </span>
                </h2>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[10000, 50000, 100000].map((amount) => {
                  const isSel = form.buyInAmount === amount && !customBuyIn;
                  return (
                    <button key={amount} type="button" onClick={() => { updateForm("buyInAmount", amount); setCustomBuyIn(false); }}
                      style={{ background: isSel ? "rgba(255,215,0,0.1)" : "#131d2e", border: isSel ? "1px solid rgba(255,215,0,0.3)" : "1px solid rgba(255,255,255,0.08)",
                        borderRadius: 8, padding: "6px 10px", color: isSel ? "#FFD700" : "#7a8499", fontSize: 12, fontWeight: isSel ? 700 : 500, cursor: "pointer", fontFamily: "'Outfit', sans-serif" }}>
                      {formatCOP(amount)}
                    </button>
                  );
                })}
                <button type="button" onClick={() => { setCustomBuyIn(true); updateForm("buyInAmount", 0); }}
                  style={{ background: customBuyIn ? "rgba(255,215,0,0.1)" : "#131d2e", border: customBuyIn ? "1px solid rgba(255,215,0,0.3)" : "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 8, padding: "6px 10px", color: customBuyIn ? "#FFD700" : "#7a8499", fontSize: 12, fontWeight: customBuyIn ? 700 : 500, cursor: "pointer", fontFamily: "'Outfit', sans-serif" }}>
                  Otro valor
                </button>
              </div>
              {customBuyIn && (
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted font-medium">$</span>
                  <input type="number" min={1000} step={1000} value={form.buyInAmount || ""} onChange={(e) => updateForm("buyInAmount", parseInt(e.target.value) || 0)} placeholder="10000"
                    className="w-full pl-8 pr-4 py-3 rounded-xl outline-none transition-colors bg-bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted focus:ring-1 focus:ring-gold/40 focus:border-gold/50" />
                </div>
              )}
            </div>

            {/* Sección 2: Modo de pago */}
            <div className="rounded-2xl p-5 space-y-4 bg-bg-card/80 backdrop-blur-sm border border-border-subtle">
              <h2 className="text-base font-bold text-text-primary">Modo de pago</h2>
              {form.type === "open" ? (
                <>
                  {(() => {
                    const opt = PAYMENT_MODE_OPTIONS.find((o) => o.value === "digital_pool")!;
                    return (
                      <div className="w-full text-left p-4 rounded-xl border border-gold/30 bg-gold/10">
                        <div className="flex items-start gap-3">
                          <span className="flex-shrink-0 mt-0.5">
                            <Smartphone className="w-6 h-6" style={{ color: "#7a8499" }} />
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-bold text-text-primary">{opt.title}</span>
                              <span className="text-[10px] px-3 py-1 rounded-full font-medium bg-gold/10 text-gold border border-gold/20">{opt.tag}</span>
                            </div>
                            <p className="text-sm text-text-secondary leading-snug">{opt.description}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                  <div className="rounded-xl p-3 bg-bg-elevated border border-border-subtle">
                    <p className="text-xs text-text-secondary leading-snug">Las pollas públicas requieren pago digital.</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-3">
                    {/* "digital_pool" oculto del UI durante el MVP (Wompi fuera).
                        La opción permanece en PAYMENT_MODE_OPTIONS para que el
                        backend la siga aceptando; re-habilitar quitando el filtro. */}
                    {PAYMENT_MODE_OPTIONS.filter((o) => o.value !== "digital_pool").map((option) => {
                      const isSelected = form.paymentMode === option.value;
                      return (
                        <button key={option.value} type="button"
                          onClick={() => updateForm("paymentMode", option.value)}
                          className={`w-full text-left p-4 rounded-xl border transition-all ${isSelected ? "border-gold/30 bg-gold/10" : "border-border-subtle hover:border-gold/20 bg-bg-elevated cursor-pointer"}`}>
                          <div className="flex items-start gap-3">
                            <span className="flex-shrink-0 mt-0.5">
                              {option.icon === "banknote" ? <Banknote className="w-6 h-6" style={{ color: "#7a8499" }} />
                                : option.icon === "smartphone" ? <Smartphone className="w-6 h-6" style={{ color: "#7a8499" }} />
                                : <Handshake className="w-6 h-6" style={{ color: "#7a8499" }} />}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-bold text-text-primary">{option.title}</span>
                                <span className="text-[10px] px-3 py-1 rounded-full font-medium bg-gold/10 text-gold border border-gold/20">{option.tag}</span>
                              </div>
                              <p className="text-sm text-text-secondary leading-snug">{option.description}</p>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Helper one-liner for selected mode */}
                  <div className="rounded-xl p-3 bg-bg-elevated border border-border-subtle">
                    <p className="text-xs text-text-secondary leading-snug">{PAYMENT_MODE_HINTS[form.paymentMode]}</p>
                  </div>
                </>
              )}
            </div>

            {form.paymentMode === "admin_collects" && (
              <div className="rounded-2xl p-5 space-y-4 bg-bg-card/80 backdrop-blur-sm border border-border-subtle">
                <h2 className="text-base font-bold text-text-primary">Instrucciones de pago</h2>
                <textarea value={form.adminPaymentInstructions} onChange={(e) => updateForm("adminPaymentInstructions", e.target.value)}
                  placeholder="Ej: Enviar a Nequi 310-123-4567" rows={4}
                  className="w-full px-4 py-3 rounded-xl outline-none resize-none transition-colors bg-bg-base border border-border-subtle text-text-primary placeholder:text-text-muted focus:border-gold/50" />
              </div>
            )}

            {/* Summary */}
            <div className="rounded-xl p-4 flex items-start gap-2.5 bg-bg-elevated border border-border-subtle">
              <Info className="w-4 h-4 text-blue-info flex-shrink-0 mt-0.5" />
              <p className="text-sm text-text-secondary">
                {selectedMatchIds.size} partidos seleccionados · {tournamentMeta?.name || form.tournament}
              </p>
            </div>

            {error && <p className="text-red-alert text-sm text-center bg-red-dim rounded-xl p-3">{error}</p>}
            <div className="flex gap-3">
              <button type="button" onClick={() => goToStep(2)} className="flex-1 font-bold py-4 rounded-xl bg-bg-card text-text-secondary border border-border-subtle hover:border-gold/30 cursor-pointer">
                <span className="flex items-center justify-center gap-1"><ArrowLeft className="w-4 h-4" /> Atrás</span>
              </button>
              <button type="button" onClick={handleSubmit} disabled={loading}
                className="flex-1 bg-gold text-bg-base font-bold py-4 rounded-xl hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2"
                style={{ boxShadow: "0 0 20px rgba(255,215,0,0.15)" }}>
                {loading ? "Creando..." : <><span>Crear polla</span><Trophy className="w-5 h-5" /></>}
              </button>
            </div>
          </motion.div>
        )}
      </main>
    </div>
  );
}
