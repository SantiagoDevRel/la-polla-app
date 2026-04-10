// app/(app)/pollas/crear/page.tsx — Wizard de 3 pasos para crear una nueva polla
// Paso 1: Información básica (nombre, descripción, torneo, tipo)
// Paso 2: Alcance de la polla (full, group_stage, knockouts)
// Paso 3: Modo de pago (honor, admin_collects, digital_pool)
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { motion } from "framer-motion";
import { staggerContainer } from "@/lib/animations";
import { ArrowLeft, Check, ChevronRight, Info, AlertTriangle, Construction, Trophy } from "lucide-react";

// ─── Tipos ───

type PaymentMode = "digital_pool" | "admin_collects" | "honor";
type Scope = "full" | "group_stage" | "knockouts" | "custom";
type Step = 1 | 2 | 3;

interface FormState {
  name: string;
  description: string;
  tournament: string;
  type: "open" | "closed";
  scope: Scope;
  buyInAmount: number;
  paymentMode: PaymentMode;
  adminPaymentInstructions: string;
}

// ─── Datos de configuración ───

const TOURNAMENTS = [
  { value: "worldcup_2026", label: "Mundial 2026", icon: "🌍", available: true },
  { value: "champions_2025", label: "Champions League 2024-25", icon: "⭐", available: true },
  { value: "liga_betplay_2025", label: "Liga BetPlay 2025", icon: "🇨🇴", available: true },
  { value: "la_liga", label: "La Liga", icon: "🇪🇸", available: false, tag: "Próximamente" },
  { value: "premier_league", label: "Premier League", icon: "🏴\u200D", available: false, tag: "Próximamente" },
];

const SCOPE_OPTIONS: {
  value: Scope;
  title: string;
  icon: string;
  description: string;
}[] = [
  {
    value: "full",
    title: "Torneo completo",
    icon: "🏆",
    description: "Todos los partidos del torneo. Más emoción, más pronósticos.",
  },
  {
    value: "group_stage",
    title: "Fase de grupos",
    icon: "⚽",
    description: "Solo los partidos de la fase de grupos.",
  },
  {
    value: "knockouts",
    title: "Eliminatorias",
    icon: "🥊",
    description: "Desde octavos hasta la final.",
  },
];

const PAYMENT_MODE_OPTIONS: {
  value: PaymentMode;
  title: string;
  icon: string;
  description: string;
  tag: string;
}[] = [
  {
    value: "digital_pool",
    title: "Plataforma acumula",
    icon: "📲",
    description:
      "Cada participante paga a través de la plataforma. El pozo se libera automáticamente al ganador.",
    tag: "Coming soon",
  },
  {
    value: "admin_collects",
    title: "Admin maneja el pozo",
    icon: "💰",
    description:
      "Cada participante le envía el dinero al admin (Nequi, Bancolombia, efectivo). El admin revisa y aprueba pagos.",
    tag: "Recomendado",
  },
  {
    value: "honor",
    title: "Sin pago adelantado",
    icon: "🤝",
    description:
      "No se cobra antes de jugar. Al final, cada participante le paga directamente al ganador.",
    tag: "Gratis",
  },
];

// ─── Componente principal ───

export default function CrearPollaPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<FormState>({
    name: "",
    description: "",
    tournament: "worldcup_2026",
    type: "closed",
    scope: "full",
    buyInAmount: 0,
    paymentMode: "admin_collects",
    adminPaymentInstructions: "",
  });

  // Helper para actualizar un campo del form
  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // Validación y navegación entre pasos
  function goToStep(targetStep: Step) {
    setError("");

    // Validación antes de avanzar
    if (targetStep > step) {
      if (step === 1) {
        if (form.name.trim().length < 3) {
          setError("El nombre debe tener al menos 3 caracteres");
          return;
        }
        if (!form.tournament) {
          setError("Selecciona un torneo");
          return;
        }
      }
    }

    setStep(targetStep);
  }

  // Submit final en paso 3
  async function handleSubmit() {
    setError("");

    // Validaciones del paso 3
    if (form.paymentMode !== "honor" && form.buyInAmount <= 0) {
      setError("El valor de entrada debe ser mayor a 0");
      return;
    }

    if (
      form.paymentMode === "admin_collects" &&
      form.adminPaymentInstructions.trim() === ""
    ) {
      setError("Debes indicar instrucciones de pago para los participantes");
      return;
    }

    setLoading(true);

    try {
      const { data } = await axios.post("/api/pollas", form);
      router.push(`/pollas/${data.polla.slug}`);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error || "Error al crear la polla");
    } finally {
      setLoading(false);
    }
  }

  // Determinar si el torneo seleccionado soporta múltiples scopes
  // Solo World Cup tiene fase de grupos y eliminatorias separadas
  const tournamentHasMultipleScopes = form.tournament === "worldcup_2026";

  const STEP_LABELS = ["Info", "Alcance", "Pago"];

  return (
    <div className="min-h-screen">
      {/* Header con indicador de progreso */}
      <header
        className="px-4 pt-4 pb-5"
        style={{ background: "linear-gradient(180deg, #0a1628 0%, var(--bg-base) 100%)" }}
      >
        <div className="max-w-lg mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={() => (step === 1 ? router.back() : goToStep((step - 1) as Step))}
              className="text-text-secondary hover:text-gold transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-lg font-bold text-text-primary">Crear nueva polla</h1>
          </div>

          {/* Indicador de progreso: 3 círculos con líneas */}
          <div className="flex items-center justify-center gap-0">
            {[1, 2, 3].map((s) => (
              <div key={s} className="flex items-center">
                {/* Círculo del paso */}
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center font-display text-base tracking-wide transition-all ${
                    s < step
                      ? "bg-green-live text-bg-base"
                      : s === step
                      ? "bg-gold text-bg-base shadow-[0_0_12px_rgba(255,215,0,0.3)]"
                      : "bg-bg-elevated border border-border-subtle text-text-muted"
                  }`}
                >
                  {s < step ? <Check className="w-4 h-4" /> : s}
                </div>
                {/* Línea entre círculos */}
                {s < 3 && (
                  <div
                    className={`w-10 h-0.5 transition-colors ${
                      s < step ? "bg-green-live" : "bg-border-subtle"
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-center gap-8 mt-1.5">
            {STEP_LABELS.map((label, i) => (
              <span
                key={label}
                className={`text-[10px] font-medium ${
                  i + 1 === step ? "text-gold" : i + 1 < step ? "text-green-live" : "text-text-muted"
                }`}
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto p-4">
        {/* ════════════════════════════════════
            PASO 1 — Información básica
           ════════════════════════════════════ */}
        {step === 1 && (
          <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-5">
            <div className="rounded-2xl p-5 space-y-4 bg-bg-card/80 backdrop-blur-sm border border-border-subtle hover:border-gold/20 transition-all duration-300">
              <h2 className="text-base font-bold text-text-primary">Información básica</h2>

              {/* Nombre */}
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">
                  Nombre de la polla
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => updateForm("name", e.target.value)}
                  placeholder="Ej: Polla Mundial Oficina"
                  className="w-full px-4 py-3 rounded-xl outline-none transition-colors duration-200 bg-bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted focus:ring-1 focus:ring-gold/40 focus:border-gold/50"
                />
              </div>

              {/* Descripción */}
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">
                  Descripción (opcional)
                </label>
                <textarea
                  value={form.description}
                  onChange={(e) => updateForm("description", e.target.value)}
                  placeholder="Descripción de la polla..."
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl outline-none resize-none transition-colors bg-bg-base border border-border-subtle text-text-primary placeholder:text-text-muted focus:border-gold/50"
                />
              </div>
            </div>

            {/* Torneo — tarjetas seleccionables */}
            <div className="rounded-2xl p-5 space-y-4 bg-bg-card/80 backdrop-blur-sm border border-border-subtle hover:border-gold/20 transition-all duration-300">
              <h2 className="text-base font-bold text-text-primary">Torneo</h2>
              <div className="space-y-2">
                {TOURNAMENTS.map((t) => {
                  const isSelected = form.tournament === t.value;
                  return (
                    <button
                      key={t.value}
                      type="button"
                      disabled={!t.available}
                      onClick={() => {
                        if (t.available) updateForm("tournament", t.value);
                      }}
                      className={`w-full text-left px-4 py-3 rounded-xl border transition-all duration-200 flex items-center gap-3 ${
                        !t.available
                          ? "opacity-30 cursor-not-allowed border-border-subtle bg-bg-elevated"
                          : isSelected
                          ? "border-gold/30 bg-gold/10 shadow-[0_0_12px_rgba(255,215,0,0.1)]"
                          : "border-border-subtle hover:border-gold/20 hover:bg-bg-card-hover bg-bg-elevated cursor-pointer"
                      }`}
                    >
                      <span className="text-xl">{t.icon}</span>
                      <span className="font-medium text-text-primary flex-1">{t.label}</span>
                      {!t.available && t.tag && (
                        <span className="text-[10px] bg-bg-elevated text-text-muted px-2 py-0.5 rounded-full">
                          {t.tag}
                        </span>
                      )}
                      {t.available && (
                        <div
                          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                            isSelected
                              ? "border-gold bg-gold"
                              : "border-border-medium"
                          }`}
                        >
                          {isSelected && <div className="w-2 h-2 rounded-full bg-bg-base" />}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Tipo: abierta o cerrada — dos tarjetas */}
            <div className="rounded-2xl p-5 space-y-4 bg-bg-card/80 backdrop-blur-sm border border-border-subtle hover:border-gold/20 transition-all duration-300">
              <h2 className="text-base font-bold text-text-primary">Tipo de polla</h2>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => updateForm("type", "closed")}
                  className={`p-4 rounded-xl border text-center transition-all duration-200 cursor-pointer ${
                    form.type === "closed"
                      ? "border-gold/30 bg-gold/10 shadow-[0_0_12px_rgba(255,215,0,0.1)]"
                      : "border-border-subtle hover:border-gold/20 hover:bg-bg-card-hover bg-bg-elevated"
                  }`}
                >
                  <span className="text-2xl block mb-1">🔒</span>
                  <span className="font-bold text-sm text-text-primary block">Privada</span>
                  <span className="text-xs text-text-muted">Solo por invitación</span>
                </button>
                <button
                  type="button"
                  onClick={() => updateForm("type", "open")}
                  className={`p-4 rounded-xl border text-center transition-all duration-200 cursor-pointer ${
                    form.type === "open"
                      ? "border-gold/30 bg-gold/10 shadow-[0_0_12px_rgba(255,215,0,0.1)]"
                      : "border-border-subtle hover:border-gold/20 hover:bg-bg-card-hover bg-bg-elevated"
                  }`}
                >
                  <span className="text-2xl block mb-1">🌐</span>
                  <span className="font-bold text-sm text-text-primary block">Abierta</span>
                  <span className="text-xs text-text-muted">Cualquiera con el link</span>
                </button>
              </div>
            </div>

            {/* Error y botón siguiente */}
            {error && (
              <p className="text-red-alert text-sm text-center bg-red-dim rounded-xl p-3">
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={() => goToStep(2)}
              className="w-full bg-gold text-bg-base font-bold py-4 rounded-xl hover:scale-[1.02] hover:brightness-110 hover:shadow-[0_0_24px_rgba(255,215,0,0.25)] active:scale-[0.98] transition-all duration-200 text-lg flex items-center justify-center gap-2 cursor-pointer"
              style={{ boxShadow: "0 0 20px rgba(255,215,0,0.15)" }}
            >
              Siguiente <ChevronRight className="w-5 h-5" />
            </button>
          </motion.div>
        )}

        {/* ════════════════════════════════════
            PASO 2 — Alcance de la polla
           ════════════════════════════════════ */}
        {step === 2 && (
          <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-5">
            <div className="rounded-2xl p-5 space-y-4 bg-bg-card/80 backdrop-blur-sm border border-border-subtle hover:border-gold/20 transition-all duration-300">
              <h2 className="text-base font-bold text-text-primary">Alcance de la polla</h2>
              <p className="text-sm text-text-secondary">
                Elige qué partidos se incluirán en los pronósticos
              </p>

              <div className="space-y-3">
                {SCOPE_OPTIONS.map((option) => {
                  const isSelected = form.scope === option.value;
                  // Solo World Cup muestra las 3 opciones, otros solo "full"
                  const isAvailable =
                    tournamentHasMultipleScopes || option.value === "full";

                  if (!isAvailable) return null;

                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => updateForm("scope", option.value)}
                      className={`w-full text-left p-4 rounded-xl border transition-all duration-200 cursor-pointer ${
                        isSelected
                          ? "border-gold/30 bg-gold/10 shadow-[0_0_12px_rgba(255,215,0,0.1)]"
                          : "border-border-subtle hover:border-gold/20 hover:bg-bg-card-hover bg-bg-elevated"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <span className="text-2xl flex-shrink-0">{option.icon}</span>
                        <div className="flex-1">
                          <p className="font-bold text-text-primary">{option.title}</p>
                          <p className="text-sm text-text-secondary leading-snug mt-0.5">
                            {option.description}
                          </p>
                        </div>
                        <div
                          className={`w-5 h-5 rounded-full border-2 flex-shrink-0 mt-1 flex items-center justify-center transition-colors ${
                            isSelected
                              ? "border-gold bg-gold"
                              : "border-border-medium"
                          }`}
                        >
                          {isSelected && <div className="w-2 h-2 rounded-full bg-bg-base" />}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Nota informativa */}
            <div className="rounded-xl p-4 flex items-start gap-2.5 bg-bg-elevated border border-border-subtle">
              <Info className="w-4 h-4 text-blue-info flex-shrink-0 mt-0.5" />
              <p className="text-sm text-text-secondary">
                Los partidos se cargarán automáticamente según el alcance que elijas.
              </p>
            </div>

            {/* Botones de navegación */}
            {error && (
              <p className="text-red-alert text-sm text-center bg-red-dim rounded-xl p-3">
                {error}
              </p>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => goToStep(1)}
                className="flex-1 font-bold py-4 rounded-xl transition-all duration-200 bg-bg-card text-text-secondary border border-border-subtle hover:border-gold/30 hover:bg-bg-card-hover cursor-pointer"
              >
                <span className="flex items-center justify-center gap-1">
                  <ArrowLeft className="w-4 h-4" /> Atrás
                </span>
              </button>
              <button
                type="button"
                onClick={() => goToStep(3)}
                className="flex-1 bg-gold text-bg-base font-bold py-4 rounded-xl hover:scale-[1.02] hover:brightness-110 hover:shadow-[0_0_24px_rgba(255,215,0,0.25)] active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-1 cursor-pointer"
                style={{ boxShadow: "0 0 20px rgba(255,215,0,0.15)" }}
              >
                Siguiente <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}

        {/* ════════════════════════════════════
            PASO 3 — Modo de pago
           ════════════════════════════════════ */}
        {step === 3 && (
          <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-5">
            {/* Selección del modo de pago */}
            <div className="rounded-2xl p-5 space-y-4 bg-bg-card/80 backdrop-blur-sm border border-border-subtle hover:border-gold/20 transition-all duration-300">
              <h2 className="text-base font-bold text-text-primary">Modo de pago</h2>
              <p className="text-sm text-text-secondary">
                Elige cómo se maneja el dinero de la polla
              </p>

              <div className="space-y-3">
                {PAYMENT_MODE_OPTIONS.map((option) => {
                  const isSelected = form.paymentMode === option.value;
                  const isDisabled = option.value === "digital_pool";

                  return (
                    <button
                      key={option.value}
                      type="button"
                      disabled={isDisabled}
                      onClick={() => {
                        if (!isDisabled) updateForm("paymentMode", option.value);
                      }}
                      className={`w-full text-left p-4 rounded-xl border transition-all duration-200 ${
                        isDisabled
                          ? "opacity-35 cursor-not-allowed border-border-subtle bg-bg-elevated"
                          : isSelected
                          ? "border-gold/30 bg-gold/10 shadow-[0_0_12px_rgba(255,215,0,0.1)]"
                          : "border-border-subtle hover:border-gold/20 hover:bg-bg-card-hover bg-bg-elevated cursor-pointer"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <span className="text-2xl flex-shrink-0 mt-0.5">{option.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-bold text-text-primary">{option.title}</span>
                            <span
                              className={`text-[10px] px-3 py-1 rounded-full font-medium ${
                                isDisabled
                                  ? "bg-bg-card-hover text-text-muted border border-border-subtle"
                                  : option.value === "admin_collects"
                                  ? "bg-gold/10 text-gold border border-gold/20"
                                  : "bg-green-live/10 text-green-live"
                              }`}
                            >
                              {option.tag}
                            </span>
                          </div>
                          <p className="text-sm text-text-secondary leading-snug">
                            {option.description}
                          </p>
                        </div>
                        <div
                          className={`w-5 h-5 rounded-full border-2 flex-shrink-0 mt-1 flex items-center justify-center transition-colors ${
                            isSelected
                              ? "border-gold bg-gold"
                              : "border-border-medium"
                          }`}
                        >
                          {isSelected && <div className="w-2 h-2 rounded-full bg-bg-base" />}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Valor de entrada — oculto en honor mode */}
            {form.paymentMode !== "honor" && (
              <div className="rounded-2xl p-5 space-y-4 bg-bg-card/80 backdrop-blur-sm border border-border-subtle hover:border-gold/20 transition-all duration-300">
                <h2 className="text-base font-bold text-text-primary">Valor de entrada</h2>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1.5">
                    Valor por participante (COP)
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted font-medium">
                      $
                    </span>
                    <input
                      type="number"
                      min={0}
                      step={1000}
                      value={form.buyInAmount || ""}
                      onChange={(e) =>
                        updateForm("buyInAmount", parseInt(e.target.value) || 0)
                      }
                      placeholder="20000"
                      className="w-full pl-8 pr-16 py-3 rounded-xl outline-none transition-colors duration-200 bg-bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted focus:ring-1 focus:ring-gold/40 focus:border-gold/50"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-text-muted text-sm">
                      COP
                    </span>
                  </div>
                  {form.buyInAmount > 0 && (
                    <p className="text-xs text-text-muted mt-1.5">
                      {new Intl.NumberFormat("es-CO", {
                        style: "currency",
                        currency: "COP",
                        maximumFractionDigits: 0,
                      }).format(form.buyInAmount)}{" "}
                      por persona
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Campos condicionales según modo de pago */}

            {/* honor: valor del pozo (opcional) */}
            {form.paymentMode === "honor" && (
              <div className="rounded-2xl p-5 space-y-4 bg-bg-card/80 backdrop-blur-sm border border-border-subtle hover:border-gold/20 transition-all duration-300">
                <h2 className="text-base font-bold text-text-primary">Valor del pozo</h2>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1.5">
                    Valor total del pozo (COP)
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted font-medium">
                      $
                    </span>
                    <input
                      type="number"
                      min={0}
                      step={1000}
                      value={form.buyInAmount || ""}
                      onChange={(e) =>
                        updateForm("buyInAmount", parseInt(e.target.value) || 0)
                      }
                      placeholder="Ej: 50000"
                      className="w-full pl-8 pr-16 py-3 rounded-xl outline-none transition-colors duration-200 bg-bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted focus:ring-1 focus:ring-gold/40 focus:border-gold/50"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-text-muted text-sm">
                      COP
                    </span>
                  </div>
                  {form.buyInAmount > 0 && (
                    <p className="text-xs text-text-muted mt-1.5">
                      Referencial — cada participante debe{" "}
                      {new Intl.NumberFormat("es-CO", {
                        style: "currency",
                        currency: "COP",
                        maximumFractionDigits: 0,
                      }).format(form.buyInAmount)}{" "}
                      al ganador al final
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* admin_collects: instrucciones de pago */}
            {form.paymentMode === "admin_collects" && (
              <div className="rounded-2xl p-5 space-y-4 bg-bg-card/80 backdrop-blur-sm border border-border-subtle hover:border-gold/20 transition-all duration-300">
                <h2 className="text-base font-bold text-text-primary">
                  Instrucciones de pago
                </h2>
                <p className="text-sm text-text-secondary">
                  Indica a los participantes cómo enviarte el dinero
                </p>
                <textarea
                  value={form.adminPaymentInstructions}
                  onChange={(e) =>
                    updateForm("adminPaymentInstructions", e.target.value)
                  }
                  placeholder="Ej: Enviar a Nequi 310-123-4567 a nombre de Juan Pérez. Enviar comprobante por la plataforma."
                  rows={4}
                  className="w-full px-4 py-3 rounded-xl outline-none resize-none transition-colors bg-bg-base border border-border-subtle text-text-primary placeholder:text-text-muted focus:border-gold/50"
                />
                <div className="flex items-start gap-2.5 rounded-xl p-3 bg-bg-elevated border border-border-subtle">
                  <Info className="w-4 h-4 text-blue-info flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-text-secondary">
                    Los participantes verán estas instrucciones y podrán subir un comprobante
                    de pago. Tú revisarás y aprobarás cada pago manualmente.
                  </p>
                </div>
              </div>
            )}

            {/* honor: disclaimer */}
            {form.paymentMode === "honor" && (
              <div className="rounded-xl p-4 flex items-start gap-3 bg-gold-dim border border-gold/20">
                <AlertTriangle className="w-5 h-5 text-gold flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-bold text-gold mb-1">
                    Modo sin pago adelantado
                  </h3>
                  <p className="text-sm text-text-secondary leading-snug">
                    En este modo, los participantes <strong className="text-text-primary">no pagan antes</strong> de unirse.
                    Al terminar la polla, la plataforma indicará a cada participante cuánto debe
                    y a quién pagarle. No hay forma de obligar el pago — funciona con confianza.
                  </p>
                </div>
              </div>
            )}

            {/* digital_pool: coming soon */}
            {form.paymentMode === "digital_pool" && (
              <div className="rounded-xl p-4 flex items-start gap-3 bg-bg-elevated border border-border-subtle">
                <Construction className="w-5 h-5 text-text-muted flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-bold text-text-secondary mb-1">Coming soon</h3>
                  <p className="text-sm text-text-muted leading-snug">
                    El pago a través de la plataforma estará disponible pronto.
                    Por ahora, usa el modo &quot;Admin maneja el pozo&quot;.
                  </p>
                </div>
              </div>
            )}

            {/* Error y botones */}
            {error && (
              <p className="text-red-alert text-sm text-center bg-red-dim rounded-xl p-3">
                {error}
              </p>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => goToStep(2)}
                className="flex-1 font-bold py-4 rounded-xl transition-all duration-200 bg-bg-card text-text-secondary border border-border-subtle hover:border-gold/30 hover:bg-bg-card-hover cursor-pointer"
              >
                <span className="flex items-center justify-center gap-1">
                  <ArrowLeft className="w-4 h-4" /> Atrás
                </span>
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={loading || form.paymentMode === "digital_pool"}
                className="flex-1 bg-gold text-bg-base font-bold py-4 rounded-xl hover:scale-[1.02] hover:brightness-110 hover:shadow-[0_0_24px_rgba(255,215,0,0.25)] active:scale-[0.98] transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2"
                style={{ boxShadow: "0 0 20px rgba(255,215,0,0.15)" }}
              >
                {loading ? "Creando..." : <><span>Crear polla</span><Trophy className="w-5 h-5" /></>}
              </button>
            </div>
          </motion.div>
        )}
      </main>
    </div>
  );
}
