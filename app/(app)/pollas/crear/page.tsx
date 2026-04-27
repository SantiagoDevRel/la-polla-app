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
import { ArrowLeft, Check, ChevronRight, Info, Trophy, Banknote, Handshake, Lock } from "lucide-react";
import { TOURNAMENTS } from "@/lib/tournaments";
import FootballLoader from "@/components/ui/FootballLoader";
import PrizeDistributionForm, {
  type PrizeDistribution,
} from "@/components/polla/PrizeDistributionForm";

// ─── Tipos ───

type PaymentMode = "admin_collects" | "pay_winner";
type Step = 1 | 2 | 3;

interface FormState {
  name: string;
  tournament: string;
  type: "closed";
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
    title: "Pago al principio",
    icon: "banknote",
    description: "Cada participante le paga al organizador (tú) antes de entrar a la polla.",
    tag: "",
  },
  {
    value: "pay_winner" as PaymentMode,
    title: "Pago al final",
    icon: "handshake",
    description: "Al terminar la polla, cada participante le paga directamente al ganador.",
    tag: "",
  },
];

const PAYMENT_MODE_HINTS: Record<PaymentMode, string> = {
  admin_collects: "Cada participante le paga al organizador (tú) antes de entrar. Cada vez que alguien te pague, lo marcas como pagado para que pueda participar.",
  pay_winner: "Al final, todos le pagan directamente al ganador.",
};

type GroupBy = "date" | "jornada" | "phase";

// ─── Componente principal ───

export default function CrearPollaPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [prizeDistribution, setPrizeDistribution] = useState<PrizeDistribution | null>(null);
  const [form, setForm] = useState<FormState>({
    name: "",
    tournament: "champions_2025",
    type: "closed",
    // 0 = vacío. El input formatea "" cuando es 0 y muestra el placeholder
    // "10000" en gris para sugerir el mínimo sin pre-llenarlo.
    buyInAmount: 0,
    paymentMode: "pay_winner",
    adminPaymentInstructions: "",
  });

  // Scroll-to-top entre pasos. Sin esto el browser preserva la posición
  // del scroll del paso anterior y el usuario aparece a la mitad de la
  // pantalla nueva.
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    }
  }, [step]);

  // Match selection state
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [selectedMatchIds, setSelectedMatchIds] = useState<Set<string>>(new Set());
  const [groupBy, setGroupBy] = useState<GroupBy>("date");

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

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
      }>("/api/pollas", {
        ...form,
        scope: "custom",
        matchIds: Array.from(selectedMatchIds),
        prizeDistribution: prizeDistribution ?? undefined,
      });
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
      <header className="px-4 pt-4 pb-5">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <button onClick={() => (step === 1 ? router.back() : goToStep((step - 1) as Step))} className="text-text-secondary hover:text-gold transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-lg font-bold text-text-primary">Crear nueva polla</h1>
          </div>

          {/* Stepper — 3 steps. Each step is a circle+label column; the
              connector between circles is a flex-1 bar sitting at the
              vertical center of the circle row. This keeps labels directly
              under their circles and the circles spanning the full band. */}
          <div className="flex items-start max-w-xs mx-auto">
            {[1, 2, 3].map((s, i) => (
              <div key={s} className={`flex items-start ${s < 3 ? "flex-1" : ""}`}>
                <div className="flex flex-col items-center gap-1 shrink-0">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                    s < step ? "bg-green-live text-bg-base" : s === step ? "bg-gold text-bg-base shadow-[0_0_12px_rgba(255,215,0,0.3)]" : "bg-bg-elevated border border-border-subtle text-text-muted"
                  }`}>
                    {s < step ? <Check className="w-3.5 h-3.5" /> : s}
                  </div>
                  <span className={`text-[9px] font-medium ${s === step ? "text-gold" : s < step ? "text-green-live" : "text-text-muted"}`}>
                    {STEP_LABELS[i]}
                  </span>
                </div>
                {s < 3 && <div className={`flex-1 h-0.5 mt-[13px] transition-colors ${s < step ? "bg-green-live" : "bg-border-subtle"}`} />}
              </div>
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

            {/* Tipo de polla: privada (closed) es el único modo soportado. */}
            <div className="rounded-2xl p-5 space-y-2 bg-bg-card/80 backdrop-blur-sm border border-border-subtle">
              <h2 className="text-base font-bold text-text-primary">Tipo de polla</h2>
              <div className="flex items-center gap-2 text-text-secondary text-sm">
                <Lock className="w-4 h-4 text-gold" aria-hidden="true" />
                <span>Solo personas con el link o el código de invitación podrán unirse a tu polla.</span>
              </div>
            </div>

          </motion.div>
        )}

        {/* ═══ PASO 2 — Partidos ═══ */}
        {step === 2 && (
          <div className="space-y-3 pb-20">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-text-primary">Selecciona los partidos</h2>
                <p style={{ fontSize: 12, color: selectedMatchIds.size > 0 ? "#FFD700" : "#F5F7FA", fontWeight: selectedMatchIds.size > 0 ? 600 : 400 }}>
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
            <div style={{ display: "flex", gap: 12, paddingTop: 4 }}>
              <button onClick={selectAll} style={{ fontSize: 14, fontWeight: 600, color: "#FFFFFF", background: "none", border: "none", cursor: "pointer", fontFamily: "'Outfit', sans-serif", textDecoration: "underline", textUnderlineOffset: 3 }}>
                Seleccionar todo
              </button>
              <button onClick={deselectAll} style={{ fontSize: 14, fontWeight: 600, color: "#FFFFFF", background: "none", border: "none", cursor: "pointer", fontFamily: "'Outfit', sans-serif", textDecoration: "underline", textUnderlineOffset: 3 }}>
                Deseleccionar todo
              </button>
            </div>

            {matchesLoading ? (
              <div className="flex flex-col items-center gap-2 py-8"><FootballLoader /><p className="text-text-muted text-sm">Cargando partidos...</p></div>
            ) : matches.length === 0 ? (
              <div className="text-center py-8 lp-card">
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
                              <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#131d2e", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 7, color: "#F5F7FA", flexShrink: 0 }}>
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
                              <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#131d2e", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 7, color: "#F5F7FA", flexShrink: 0 }}>
                                {m.away_team.substring(0, 3).toUpperCase()}
                              </div>
                            )}
                            <span style={{ fontSize: 12, fontWeight: 500, color: "#f0f4ff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {m.away_team}
                            </span>
                          </div>

                          {/* Time */}
                          <span style={{ fontSize: 10, color: "#F5F7FA", flexShrink: 0, minWidth: 36, textAlign: "right" }}>{time}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })
            )}

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
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted font-medium">$</span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={form.buyInAmount > 0 ? form.buyInAmount.toLocaleString("es-CO") : ""}
                  onChange={(e) => {
                    // Strip non-digits so the user can paste "10.000" or
                    // "10,000" and we still get a clean number. Limit to
                    // 9 digits so nobody types a billion-peso polla.
                    const digits = e.target.value.replace(/\D/g, "").slice(0, 9);
                    updateForm("buyInAmount", digits ? parseInt(digits, 10) : 0);
                  }}
                  placeholder="10000"
                  className="w-full pl-8 pr-4 py-3 rounded-xl outline-none transition-colors bg-bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted/40 focus:ring-1 focus:ring-gold/40 focus:border-gold/50"
                />
              </div>
            </div>

            {/* Sección 2: Modo de pago */}
            <div className="rounded-2xl p-5 space-y-4 bg-bg-card/80 backdrop-blur-sm border border-border-subtle">
              <h2 className="text-base font-bold text-text-primary">Modo de pago</h2>
              <>
                <div className="space-y-3">
                  {PAYMENT_MODE_OPTIONS.map((option) => {
                      const isSelected = form.paymentMode === option.value;
                      return (
                        <button key={option.value} type="button"
                          onClick={() => updateForm("paymentMode", option.value)}
                          className={`w-full text-left p-4 rounded-xl border transition-all ${isSelected ? "border-gold/30 bg-gold/10" : "border-border-subtle hover:border-gold/20 bg-bg-elevated cursor-pointer"}`}>
                          <div className="flex items-start gap-3">
                            <span className="flex-shrink-0 mt-0.5">
                              {option.icon === "banknote" ? <Banknote className="w-6 h-6" style={{ color: "#F5F7FA" }} />
                                : <Handshake className="w-6 h-6" style={{ color: "#F5F7FA" }} />}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-bold text-text-primary">{option.title}</span>
                                {option.tag && <span className="text-[10px] px-3 py-1 rounded-full font-medium bg-gold/10 text-gold border border-gold/20">{option.tag}</span>}
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
            </div>

            {form.paymentMode === "admin_collects" && (
              <div className="rounded-2xl p-5 space-y-4 bg-bg-card/80 backdrop-blur-sm border border-border-subtle">
                <h2 className="text-base font-bold text-text-primary">Instrucciones de pago</h2>
                <textarea value={form.adminPaymentInstructions} onChange={(e) => updateForm("adminPaymentInstructions", e.target.value)}
                  placeholder="Ej: Enviar a Nequi 310-123-4567" rows={4}
                  className="w-full px-4 py-3 rounded-xl outline-none resize-none transition-colors bg-bg-base border border-border-subtle text-text-primary placeholder:text-text-muted focus:border-gold/50" />
              </div>
            )}

            {/* Sección 3: Premios (opcional) */}
            <div className="rounded-2xl p-5 space-y-3 bg-bg-card/80 backdrop-blur-sm border border-border-subtle">
              <div className="flex items-center gap-2">
                <Trophy className="w-4 h-4 text-gold" />
                <h2 className="text-base font-bold text-text-primary">Premios</h2>
                <span className="text-[10px] uppercase tracking-wide text-text-muted ml-auto">
                  Opcional
                </span>
              </div>
              <p className="text-xs text-text-muted">
                Define cómo se reparten los premios entre los puestos. Puedes modificarlo después
                desde el panel del organizador.
              </p>
              <PrizeDistributionForm
                pot={0}
                initial={prizeDistribution}
                onChange={setPrizeDistribution}
                optional
              />
            </div>

            {/* Summary */}
            <div className="rounded-xl p-4 flex items-start gap-2.5 bg-bg-elevated border border-border-subtle">
              <Info className="w-4 h-4 text-blue-info flex-shrink-0 mt-0.5" />
              <p className="text-sm text-text-secondary">
                {selectedMatchIds.size} partidos seleccionados · {tournamentMeta?.name || form.tournament}
              </p>
            </div>

          </motion.div>
        )}
      </main>

      {/* Sticky wizard footer — visible en los 3 pasos. Reemplaza la
          BottomNav (que se auto-oculta en /pollas/crear). Cancelar
          siempre vuelve a /pollas; Atrás aparece desde el paso 2; el
          botón principal cambia de "Continuar →" a "Crear polla 🏆"
          en el paso final. */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          background: "#080c10",
          borderTop: "1px solid #1a2540",
          padding: "12px 16px env(safe-area-inset-bottom, 12px)",
          zIndex: 40,
        }}
      >
        {error && (
          <div className="max-w-lg mx-auto mb-2">
            <p className="text-red-alert text-xs text-center bg-red-dim rounded-lg py-1.5 px-3">{error}</p>
          </div>
        )}
        <div className="max-w-lg mx-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => router.push("/pollas")}
            className="px-4 py-2.5 rounded-xl text-text-muted hover:text-text-primary text-sm font-medium transition-colors"
          >
            Cancelar
          </button>
          {step > 1 && (
            <button
              type="button"
              onClick={() => goToStep((step - 1) as Step)}
              className="px-4 py-2.5 rounded-xl bg-bg-elevated text-text-secondary border border-border-subtle hover:border-gold/30 text-sm font-semibold inline-flex items-center gap-1"
            >
              <ArrowLeft className="w-4 h-4" /> Atrás
            </button>
          )}
          <div className="flex-1" />
          {step < 3 ? (
            <button
              type="button"
              onClick={() => goToStep((step + 1) as Step)}
              disabled={step === 2 && selectedMatchIds.size === 0}
              className="px-5 py-2.5 rounded-xl bg-gold text-bg-base font-bold text-sm inline-flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ boxShadow: "0 0 16px rgba(255,215,0,0.18)" }}
            >
              Continuar <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading}
              className="px-5 py-2.5 rounded-xl bg-gold text-bg-base font-bold text-sm inline-flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ boxShadow: "0 0 20px rgba(255,215,0,0.25)" }}
            >
              {loading ? "Creando..." : (
                <>
                  Crear polla <Trophy className="w-4 h-4" />
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
