// app/(app)/pollas/crear/page.tsx — Wizard de 3 pasos para crear una nueva polla
// Paso 1: Info (nombre, torneo, tipo)
// Paso 2: Partidos (selección de partidos del torneo)
// Paso 3: Configuración (cuota de entrada + modo de pago)
"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import axios from "axios";
import { motion } from "framer-motion";
import { useLocale, useTranslations } from "next-intl";
import { useIsIOSApp } from "@/components/platform/PlatformProvider";
import { getIOSTournamentName } from "@/lib/platform/tournament-name-ios";
import { staggerContainer } from "@/lib/animations";
import { ArrowLeft, Check, ChevronRight, Info, Trophy, Banknote, Handshake, Lock } from "lucide-react";
import { TOURNAMENTS, getTournamentName } from "@/lib/tournaments";
import FootballLoader from "@/components/ui/FootballLoader";
import PrizeDistributionForm, {
  type PrizeDistribution,
} from "@/components/polla/PrizeDistributionForm";

// ─── Tipos ───

type PaymentMode = "admin_collects" | "pay_winner";
type Step = 1 | 2 | 3;

interface FormState {
  name: string;
  /** Lista de torneos. Single-tournament = array de 1. Combinada = 2+.
   *  El primer elemento es el primary (display badge en header). */
  tournaments: string[];
  type: "closed";
  buyInAmount: number;
  /** Moneda de la polla. Default COP para usuarios CO; USD para resto. */
  currency: "COP" | "USD" | "EUR" | "MXN" | "ARS";
  paymentMode: PaymentMode;
  // Cuenta estructurada del admin para AI-assist screenshot (solo
  // aplica cuando paymentMode === 'admin_collects'). Pre-llenado de
  // users.default_payout_* si el admin ya lo seteó en /perfil.
  adminPayoutMethod: "nequi" | "bancolombia" | "otro" | null;
  adminPayoutAccount: string;
  adminPayoutAccountName: string;
  adminPayoutAccountType: "ahorros" | "corriente" | null;
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

type GroupBy = "date" | "phase";

// ─── Componente principal ───

export default function CrearPollaPage() {
  const t = useTranslations("Crear");
  const locale = useLocale();
  const isIOSApp = useIsIOSApp();
  const PAYMENT_MODE_OPTIONS = useMemo(
    () => [
      {
        value: "admin_collects" as PaymentMode,
        title: t("paymentModeUpfrontTitle"),
        icon: "banknote",
        description: t("paymentModeUpfrontDesc"),
        tag: "",
      },
      {
        value: "pay_winner" as PaymentMode,
        title: t("paymentModeWinnerTitle"),
        icon: "handshake",
        description: t("paymentModeWinnerDesc"),
        tag: "",
      },
    ],
    [t],
  );
  const PAYMENT_MODE_HINTS: Record<PaymentMode, string> = useMemo(
    () => ({
      admin_collects: t("paymentHintUpfront"),
      pay_winner: t("paymentHintWinner"),
    }),
    [t],
  );
  const router = useRouter();

  // App Store 5.1.1(ix): la app iOS no permite a usuarios crear pollas
  // (solo unirse via código de invitación). Defense-in-depth: si alguien
  // navega directo a /pollas/crear desde iOS (bookmark, deep-link viejo,
  // etc.) lo redirigimos a /pollas. La UI de crear está oculta en iOS,
  // pero el guard sigue acá por si la ruta llega de algún lado.
  useEffect(() => {
    if (isIOSApp) {
      router.replace("/pollas");
    }
  }, [isIOSApp, router]);

  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [prizeDistribution, setPrizeDistribution] = useState<PrizeDistribution | null>(null);
  const [form, setForm] = useState<FormState>({
    name: "",
    tournaments: [],
    type: "closed",
    // 0 = vacío. El input formatea "" cuando es 0 y muestra el placeholder
    // "10000" en gris para sugerir el mínimo sin pre-llenarlo.
    buyInAmount: 0,
    // Default por locale: usuarios EN (afuera de CO) van a USD, ES → COP.
    // Cuando agreguemos detección por geo header del middleware, se puede
    // refinar (ej. usuarios EN en CA → CAD si lo soportamos).
    currency: locale === "en" ? "USD" : "COP",
    paymentMode: "pay_winner",
    adminPayoutMethod: null,
    adminPayoutAccount: "",
    adminPayoutAccountName: "",
    adminPayoutAccountType: null,
  });

  // payoutLocked = true cuando hay default cargado y el user todavía
  // no apretó "cambiar". En ese estado mostramos solo una card resumen
  // con la cuenta default + botón "cambiar". Si apreta, locked=false
  // y aparece el picker completo. Si no había default, locked=false
  // de entrada (fallback al picker tradicional).
  const [payoutLocked, setPayoutLocked] = useState(false);

  // Pre-fill admin payout fields desde users.default_payout_* — si
  // el admin ya configuró su cuenta en /perfil, no le re-preguntamos.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.get<{
          profile?: {
            default_payout_method?: "nequi" | "bancolombia" | "otro" | null;
            default_payout_account?: string | null;
            default_payout_account_name?: string | null;
            default_payout_account_type?: "ahorros" | "corriente" | null;
          };
        }>("/api/users/me");
        if (cancelled) return;
        if (data.profile?.default_payout_method && data.profile?.default_payout_account) {
          setForm((prev) => ({
            ...prev,
            adminPayoutMethod: data.profile!.default_payout_method ?? null,
            adminPayoutAccount: data.profile!.default_payout_account ?? "",
            adminPayoutAccountName: data.profile!.default_payout_account_name ?? "",
            adminPayoutAccountType: data.profile!.default_payout_account_type ?? null,
          }));
          setPayoutLocked(true);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // El creador siempre elige partidos específicos. Los placeholders
  // de fases futuras (cuartos/semis/final) aparecen como rows en el
  // picker — el organizador chequea cuáles incluir. Cuando ESPN
  // publica el matchup real, el placeholder se promueve in-place
  // (mismo UUID, predicciones intactas).

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
  // Group toggle: solo se muestra para el Mundial single-tournament
  // (worldcup_2026). Resto de torneos siempre agrupa por fecha — el
  // toggle por fase agrega ruido en ligas regulares con 1 fase unica.
  // Pedido user 2026-05-12: en pollas del Mundial el organizador y
  // el pronosticador necesitan ver "fase de grupos / 16avos / octavos /
  // ..." porque la estructura de fases del bracket es relevante.
  const [groupBy, setGroupBy] = useState<GroupBy>("date");
  // Collapsed state por torneo en el picker — para que el organizador
  // pueda esconder un torneo después de elegir matches y no tenga que
  // scrollear todo. Solo aplica en pollas combinadas.
  const [collapsedTournaments, setCollapsedTournaments] = useState<Set<string>>(
    new Set(),
  );

  function toggleTournamentCollapse(slug: string) {
    setCollapsedTournaments((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // Fetch matches de TODOS los torneos seleccionados en paralelo
  // cuando entramos al paso 2. Para pollas combinadas esto trae N
  // listas que después se agrupan por torneo > fecha.
  useEffect(() => {
    if (step !== 2) return;
    if (form.tournaments.length === 0) return;
    async function loadMatches() {
      setMatchesLoading(true);
      try {
        const responses = await Promise.all(
          form.tournaments.map((t) =>
            axios.get<{ matches: MatchRow[] }>(`/api/matches?tournament=${t}&status=scheduled`),
          ),
        );
        const merged: MatchRow[] = responses.flatMap((r) => r.data.matches ?? []);
        const bufferMs = 5 * 60 * 1000;
        const cutoff = Date.now() + bufferMs;
        const upcoming = merged.filter(
          (m: MatchRow) => new Date(m.scheduled_at).getTime() > cutoff,
        );
        setMatches(upcoming);
      } catch {
        setMatches([]);
      } finally {
        setMatchesLoading(false);
      }
    }
    loadMatches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, form.tournaments.join(",")]);

  // Group matches.
  //   - Single-tournament: groups planos (por fecha o fase).
  //   - Combinada (2+ torneos): primero por torneo, dentro por fecha/fase.
  // Cada `tournamentBlock` es un torneo con sus subgrupos. La UI usa
  // esto para renderizar headers de torneo + subgrupos colapsables.
  interface SubGroup {
    key: string;
    label: string;
    matchIds: string[];
    matches: MatchRow[];
  }
  interface TournamentBlock {
    tournamentSlug: string;
    tournamentName: string;
    tournamentLogo: string | null;
    matchIds: string[]; // para "seleccionar todo del torneo"
    subgroups: SubGroup[];
  }

  const tournamentBlocks = useMemo<TournamentBlock[]>(() => {
    if (matches.length === 0) return [];
    // Buckets por torneo en el orden de form.tournaments para
    // determinismo (primary primero).
    const byTournament = new Map<string, MatchRow[]>();
    for (const t of form.tournaments) byTournament.set(t, []);
    for (const m of matches) {
      const list = byTournament.get(m.tournament) ?? [];
      list.push(m);
      byTournament.set(m.tournament, list);
    }

    const blocks: TournamentBlock[] = [];
    for (const tSlug of form.tournaments) {
      const list = byTournament.get(tSlug) ?? [];
      if (list.length === 0) continue;
      const meta = TOURNAMENTS.find((t) => t.slug === tSlug);

      // Subgroups dentro del torneo
      const subMap = new Map<string, { label: string; matches: MatchRow[] }>();
      for (const m of list) {
        let key: string;
        let label: string;
        const isPlaceholder = m.home_team === "TBD" && m.away_team === "TBD";

        if (groupBy === "date") {
          if (isPlaceholder) {
            key = "_tbd";
            label = t("tbd");
          } else {
            const d = new Date(m.scheduled_at);
            // Bogota TZ para AMBOS key y label. Antes usabamos
            // d.toISOString() (UTC) como key — eso partia en dos secciones
            // los partidos del mismo dia Bogota cuando algunos kickoff-eaban
            // PM (UTC siguiente dia). El label, en cambio, usaba locale del
            // sistema sin timeZone, asi que ambas secciones mostraban "Tue
            // 5 May" pero con keys distintas.
            key = new Intl.DateTimeFormat("en-CA", {
              timeZone: "America/Bogota",
              year: "numeric", month: "2-digit", day: "2-digit",
            }).format(d);
            const intlTag = locale === "en" ? "en-US" : "es-CO";
            label = new Intl.DateTimeFormat(intlTag, {
              timeZone: "America/Bogota",
              weekday: "long", day: "numeric", month: "long",
            }).format(d);
            label = label.charAt(0).toUpperCase() + label.slice(1);
          }
        } else {
          key = m.phase || "unknown";
          label = formatPhase(m.phase);
        }

        if (!subMap.has(key)) subMap.set(key, { label, matches: [] });
        subMap.get(key)!.matches.push(m);
      }

      const subEntries = Array.from(subMap.entries());
      subEntries.sort(([keyA, valA], [keyB, valB]) => {
        if (keyA === "_tbd") return 1;
        if (keyB === "_tbd") return -1;
        const a = valA.matches[0]?.scheduled_at ?? "";
        const b = valB.matches[0]?.scheduled_at ?? "";
        return a.localeCompare(b);
      });
      const subgroups: SubGroup[] = subEntries.map(([key, { label, matches: ms }]) => ({
        key: `${tSlug}|${key}`,
        label,
        matchIds: ms.map((m) => m.id),
        matches: ms,
      }));

      blocks.push({
        tournamentSlug: tSlug,
        tournamentName: getTournamentName(tSlug, locale),
        tournamentLogo: meta?.logoPath ?? null,
        matchIds: list.map((m) => m.id),
        subgroups,
      });
    }
    return blocks;
  }, [matches, groupBy, form.tournaments]);

  function formatPhase(phase: string | null): string {
    const phaseKeys: Record<string, string> = {
      group_stage: "phaseGroupStage",
      league_stage: "phaseLeagueStage",
      regular_season: "phaseRegularSeason",
      round_of_32: "phaseRoundOf32",
      round_of_16: "phaseRoundOf16",
      quarter_finals: "phaseQuarterFinals",
      semi_finals: "phaseSemiFinals",
      final: "phaseFinal",
      third_place: "phaseThirdPlace",
      playoff: "phasePlayoff",
    };
    const key = phaseKeys[phase || ""];
    if (key) return t(key);
    return phase || t("phaseOther");
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
        if (form.name.trim().length < 3) { setError(t("errNameMin")); return; }
        if (form.tournaments.length === 0) { setError(t("errSelectTournament")); return; }
      }
      if (step === 2) {
        if (selectedMatchIds.size === 0) {
          setError(t("errSelectMatches"));
          return;
        }
      }
    }
    setStep(targetStep);
  }

  // Submit
  async function handleSubmit() {
    setError("");
    // Mínimo global: 1 (cualquier currency). Match con el Zod del API.
    if (form.buyInAmount < 1) { setError(t("errMinAmount")); return; }
    if (form.paymentMode === "admin_collects") {
      if (!form.adminPayoutMethod) {
        setError(t("errPickMethod")); return;
      }
      if (!form.adminPayoutAccount.trim()) {
        setError(t("errMissingAccount")); return;
      }
      if (form.adminPayoutMethod !== "nequi" && form.adminPayoutAccountName.trim().length < 2) {
        setError(t("errMissingName", { method: form.adminPayoutMethod })); return;
      }
      if (form.adminPayoutMethod !== "nequi" && !form.adminPayoutAccountType) {
        setError(t("errPickAccountType")); return;
      }
    }

    setLoading(true);
    try {
      const { data } = await axios.post<{
        polla: { slug: string } | null;
      }>("/api/pollas", {
        name: form.name,
        // El primer torneo es el primary (display badge). El array
        // completo va aparte en `tournaments` para que la API pueda
        // persistir polla.tournaments cuando es combinada.
        tournament: form.tournaments[0],
        tournaments: form.tournaments,
        type: form.type,
        buyInAmount: form.buyInAmount,
        currency: form.currency,
        paymentMode: form.paymentMode,
        adminPayoutMethod: form.adminPayoutMethod ?? undefined,
        adminPayoutAccount: form.adminPayoutAccount.trim() || undefined,
        adminPayoutAccountName:
          form.adminPayoutMethod !== "nequi"
            ? form.adminPayoutAccountName.trim() || undefined
            : undefined,
        adminPayoutAccountType:
          form.adminPayoutMethod !== "nequi"
            ? form.adminPayoutAccountType ?? undefined
            : undefined,
        scope: "custom",
        matchIds: Array.from(selectedMatchIds),
        prizeDistribution: prizeDistribution ?? undefined,
      });
      if (data.polla) {
        router.push(`/pollas/${data.polla.slug}`);
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error || t("errCreate"));
    } finally {
      setLoading(false);
    }
  }

  const STEP_LABELS = [t("stepInfo"), t("stepMatches"), t("stepConfig")];

  const primaryTournament = form.tournaments[0] ?? null;
  const tournamentMeta = primaryTournament
    ? TOURNAMENTS.find((t) => t.slug === primaryTournament)
    : null;
  const isCombined = form.tournaments.length > 1;

  // iOS: render nada mientras el effect de arriba redirige a /pollas.
  // Evita un flash de la UI de crear antes del replace.
  if (isIOSApp) return null;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="px-4 pt-4 pb-5">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <button onClick={() => (step === 1 ? router.back() : goToStep((step - 1) as Step))} className="text-text-secondary hover:text-gold transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-lg font-bold text-text-primary">{t("header")}</h1>
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

      <main className="max-w-lg mx-auto p-4 pb-[120px]">
        {/* ═══ PASO 1 — Info ═══ */}
        {step === 1 && (
          <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-5">
            <div className="rounded-2xl p-5 space-y-4 bg-bg-card/80 backdrop-blur-sm border border-border-subtle">
              <h2 className="text-base font-bold text-text-primary">{t("step1Title")}</h2>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">{t("labelName")} <span className="text-red-alert">*</span></label>
                <input type="text" value={form.name} onChange={(e) => updateForm("name", e.target.value)} placeholder={t("namePlaceholder")}
                  className="w-full px-4 py-3 rounded-xl outline-none transition-colors bg-bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted focus:ring-1 focus:ring-gold/40 focus:border-gold/50" />
              </div>
            </div>

            <div className="rounded-2xl p-5 space-y-4 bg-bg-card/80 backdrop-blur-sm border border-border-subtle">
              <h2 className="text-base font-bold text-text-primary">{t("labelTournaments")} <span className="text-red-alert">*</span></h2>
              <div className="space-y-2">
                {(isIOSApp ? TOURNAMENTS.filter((tn) => tn.slug === "worldcup_2026") : TOURNAMENTS).map((t) => {
                  const isSelected = form.tournaments.includes(t.slug);
                  return (
                    <button
                      key={t.slug}
                      type="button"
                      onClick={() => {
                        setForm((prev) => {
                          const set = new Set(prev.tournaments);
                          if (set.has(t.slug)) set.delete(t.slug);
                          else set.add(t.slug);
                          return { ...prev, tournaments: Array.from(set) };
                        });
                        // Cualquier cambio de torneos invalida la
                        // selección de partidos previa — los IDs viejos
                        // pueden no existir en el nuevo set.
                        setSelectedMatchIds(new Set());
                      }}
                      className={`w-full text-left px-4 py-3 rounded-xl border transition-all duration-200 flex items-center gap-3 cursor-pointer ${
                        isSelected
                          ? "border-gold/30 bg-gold/10"
                          : "border-border-subtle hover:border-gold/20 bg-bg-elevated"
                      }`}
                    >
                      {isIOSApp ? null : <img src={t.logoPath} alt={getTournamentName(t.slug, locale)} width={24} height={24} style={{ objectFit: "contain", borderRadius: 4 }} />}
                      <span className="font-medium text-text-primary flex-1">{isIOSApp ? getIOSTournamentName(t.slug, getTournamentName(t.slug, locale)) : getTournamentName(t.slug, locale)}</span>
                      {/* Checkbox cuadrado (rounded-sm = casi recto) para
                          que se lea claro como multi-select, no radio. */}
                      <div
                        className={`w-5 h-5 rounded-sm border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                          isSelected ? "border-gold bg-gold" : "border-border-medium"
                        }`}
                      >
                        {isSelected ? <Check className="w-3.5 h-3.5 text-bg-base" /> : null}
                      </div>
                    </button>
                  );
                })}
              </div>
              {isIOSApp ? (
                <div className="rounded-xl border border-gold/30 bg-gold/5 p-4 mt-1">
                  <p className="text-[14px] text-text-primary leading-relaxed">
                    Para participar en otros torneos (Champions, La Liga, Premier, Serie A, Libertadores, Sudamericana, BetPlay), visitá{" "}
                    <a
                      href="https://lapollacolombiana.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gold underline font-semibold"
                    >
                      lapollacolombiana.com
                    </a>
                    .
                  </p>
                </div>
              ) : form.tournaments.length > 1 ? (
                <p className="text-[11px] text-gold">
                  {t("combinedNote", { count: form.tournaments.length })}
                </p>
              ) : null}
            </div>

            {/* Tipo de polla: privada (closed) es el único modo soportado. */}
            <div className="rounded-2xl p-5 space-y-2 bg-bg-card/80 backdrop-blur-sm border border-border-subtle">
              <h2 className="text-base font-bold text-text-primary">{t("labelType")}</h2>
              <div className="flex items-center gap-2 text-text-secondary text-sm">
                <Lock className="w-4 h-4 text-gold" aria-hidden="true" />
                <span>{t("typeDescription")}</span>
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
                <h2 className="text-base font-bold text-text-primary">{t("step2Title")}</h2>
                <p style={{ fontSize: 12, color: selectedMatchIds.size > 0 ? "#FFD700" : "#F5F7FA", fontWeight: selectedMatchIds.size > 0 ? 600 : 400 }}>
                  {selectedMatchIds.size > 0 ? t("selectedCount", { count: selectedMatchIds.size }) : t("selectedNone")}
                </p>
              </div>
              {tournamentMeta && !isIOSApp && <img src={tournamentMeta.logoPath} alt="" width={28} height={28} style={{ objectFit: "contain", opacity: 0.6 }} />}
            </div>

            {/* Group toggle: solo Mundial single-tournament. */}
            {form.tournaments.length === 1 && form.tournaments[0] === "worldcup_2026" && (
              <div className="flex gap-2" role="tablist" aria-label={t("groupByLabel")}>
                <button
                  role="tab"
                  aria-selected={groupBy === "date"}
                  onClick={() => setGroupBy("date")}
                  className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
                    groupBy === "date"
                      ? "bg-gold/10 text-gold border border-gold/30"
                      : "bg-card border border-subtle text-text-secondary hover:border-gold/20"
                  }`}
                >
                  {t("groupByDate")}
                </button>
                <button
                  role="tab"
                  aria-selected={groupBy === "phase"}
                  onClick={() => setGroupBy("phase")}
                  className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
                    groupBy === "phase"
                      ? "bg-gold/10 text-gold border border-gold/30"
                      : "bg-card border border-subtle text-text-secondary hover:border-gold/20"
                  }`}
                >
                  {t("groupByPhase")}
                </button>
              </div>
            )}

            {/* Quick actions */}
            <div style={{ display: "flex", gap: 12, paddingTop: 4 }}>
              <button onClick={selectAll} style={{ fontSize: 14, fontWeight: 600, color: "#FFFFFF", background: "none", border: "none", cursor: "pointer", fontFamily: "'Outfit', sans-serif", textDecoration: "underline", textUnderlineOffset: 3 }}>
                {t("selectAll")}
              </button>
              <button onClick={deselectAll} style={{ fontSize: 14, fontWeight: 600, color: "#FFFFFF", background: "none", border: "none", cursor: "pointer", fontFamily: "'Outfit', sans-serif", textDecoration: "underline", textUnderlineOffset: 3 }}>
                {t("deselectAll")}
              </button>
            </div>

            {matchesLoading ? (
              <div className="flex flex-col items-center gap-2 py-8"><FootballLoader /><p className="text-text-muted text-sm">{t("loadingMatches")}</p></div>
            ) : matches.length === 0 ? (
              <div className="text-center py-8 lp-card">
                <p className="text-text-muted text-sm">{t("noMatchesAvailable")}</p>
              </div>
            ) : (
              tournamentBlocks.map((block) => {
                const allTournamentSelected = block.matchIds.every((id) => selectedMatchIds.has(id));
                const isCollapsed = collapsedTournaments.has(block.tournamentSlug);
                const selectedInTournament = block.matchIds.filter((id) =>
                  selectedMatchIds.has(id),
                ).length;
                return (
                  <div key={block.tournamentSlug} className="space-y-2 mt-4 first:mt-0">
                    {/* Tournament header — solo lo mostramos cuando hay
                        más de 1 torneo. Click en el header colapsa/
                        expande las subsecciones. Botón "Todo el torneo"
                        está aparte para no chocar con el toggle. */}
                    {isCombined ? (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "10px 12px",
                          borderRadius: 12,
                          background: "rgba(255,215,0,0.06)",
                          border: "1px solid rgba(255,215,0,0.18)",
                          marginTop: 12,
                          gap: 8,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => toggleTournamentCollapse(block.tournamentSlug)}
                          aria-expanded={!isCollapsed}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            padding: 0,
                            flex: 1,
                            minWidth: 0,
                            fontFamily: "'Outfit', sans-serif",
                          }}
                        >
                          <ChevronRight
                            className="w-4 h-4 text-gold flex-shrink-0 transition-transform"
                            style={{
                              transform: isCollapsed ? "rotate(0deg)" : "rotate(90deg)",
                            }}
                            aria-hidden="true"
                          />
                          {block.tournamentLogo ? (
                            <img
                              src={block.tournamentLogo}
                              alt=""
                              width={20}
                              height={20}
                              style={{ objectFit: "contain", borderRadius: 4 }}
                            />
                          ) : null}
                          <span style={{ fontSize: 13, fontWeight: 700, color: "#FFD700" }}>
                            {block.tournamentName}
                          </span>
                          <span style={{ fontSize: 11, color: "#AEB7C7" }}>
                            ·{" "}
                            {selectedInTournament > 0
                              ? t("tournamentSelectionShort", { selected: selectedInTournament, total: block.matchIds.length })
                              : t("tournamentMatchesShort", { n: block.matchIds.length })}
                          </span>
                        </button>
                        <button
                          onClick={() => toggleGroup(block.matchIds)}
                          style={{
                            fontSize: 11,
                            color: allTournamentSelected ? "#ff3d57" : "#FFD700",
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            fontFamily: "'Outfit', sans-serif",
                            fontWeight: 700,
                            flexShrink: 0,
                          }}
                        >
                          {allTournamentSelected ? t("removeAll") : t("all")}
                        </button>
                      </div>
                    ) : null}

                    {!isCollapsed && block.subgroups.map((group) => {
                      const allGroupSelected = group.matchIds.every((id) => selectedMatchIds.has(id));
                      return (
                        <div key={group.key}>
                          {/* Sub-group header — fecha o fase dentro del torneo */}
                          <div style={{
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                            padding: "8px 0 6px", borderBottom: "1px solid rgba(255,255,255,0.06)",
                          }}>
                            <div>
                              <span style={{ fontSize: 12, fontWeight: 600, color: "#f0f4ff" }}>{group.label}</span>
                              <span style={{ fontSize: 11, color: "#4a5568", marginLeft: 6 }}>{t("groupMatchCount", { count: group.matches.length })}</span>
                            </div>
                            <button onClick={() => toggleGroup(group.matchIds)} style={{
                              fontSize: 10, color: allGroupSelected ? "#ff3d57" : "#FFD700", background: "none", border: "none", cursor: "pointer", fontFamily: "'Outfit', sans-serif", fontWeight: 600,
                            }}>
                              {allGroupSelected ? t("deselectGroup") : t("selectGroup")} →
                            </button>
                          </div>

                          {/* Match rows */}
                          {group.matches.map((m) => {
                      const isChecked = selectedMatchIds.has(m.id);
                      const isPlaceholder = m.home_team === "TBD" && m.away_team === "TBD";
                      const intlTag = locale === "en" ? "en-US" : "es-CO";
                      const time = isPlaceholder
                        ? t("tbd")
                        : new Date(m.scheduled_at).toLocaleTimeString(intlTag, { hour: "2-digit", minute: "2-digit" });
                      // Para placeholders mostramos el label de la fase
                      // + slot ("Cuartos · #1") en vez de "TBD vs TBD"
                      // que no le dice nada al user. Cuando ESPN publica
                      // el matchup real, el row se promueve in-place.
                      const placeholderTitle = isPlaceholder
                        ? t("placeholderTitle", { phase: formatPhase(m.phase), day: m.match_day ?? "?" })
                        : null;
                      return (
                        <div key={m.id} onClick={() => toggleMatch(m.id)} style={{
                          display: "flex", alignItems: "center", gap: 10, padding: "10px 4px", cursor: "pointer",
                          borderBottom: "1px solid rgba(255,255,255,0.04)", background: isChecked ? "rgba(255,215,0,0.03)" : "transparent",
                          opacity: isPlaceholder ? 0.85 : 1,
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

                          {isPlaceholder ? (
                            // Render simplificado para placeholder:
                            // "Cuartos · #1 — Por confirmar"
                            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#AEB7C7" strokeWidth="2" style={{ flexShrink: 0 }}>
                                <circle cx="12" cy="12" r="10" />
                                <path d="M12 6v6l4 2" />
                              </svg>
                              <span style={{ fontSize: 12, fontWeight: 600, color: "#AEB7C7" }}>
                                {placeholderTitle}
                              </span>
                            </div>
                          ) : (
                            <>
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

                              <span style={{ fontSize: 10, color: "#4a5568", flexShrink: 0 }}>{t("vs")}</span>

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
                            </>
                          )}

                          {/* Time / "Por confirmar" */}
                          <span style={{ fontSize: 10, color: isPlaceholder ? "#AEB7C7" : "#F5F7FA", flexShrink: 0, minWidth: 36, textAlign: "right", fontStyle: isPlaceholder ? "italic" : "normal" }}>{time}</span>
                        </div>
                      );
                    })}
                  </div>
                  );
                })}
                </div>
                );
              })
            )}

          </div>
        )}

        {/* ═══ PASO 3 — Configuración (cuota + modo de pago) ═══
            iOS: skip step 3 entero. La polla en iOS se crea sin cuota,
            sin pagos, sin distribución de premios. Los defaults del form
            (buy_in_amount=0, payment_mode='honor') quedan en submit. */}
        {!isIOSApp && step === 3 && (
          <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-5">
            {/* Sección 1: Cuota de entrada */}
            <div className="rounded-2xl p-5 space-y-4 bg-bg-card/80 backdrop-blur-sm border border-border-subtle">
              <div>
                <h2 className="text-base font-bold text-text-primary flex items-center gap-2">
                  {t("step3FeeTitle")} <span className="text-red-alert">*</span>
                  <span className="inline-flex items-center justify-center cursor-pointer" title={t("step3FeeTitleHint")} style={{ color: "#4a5568" }}>
                    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
                  </span>
                </h2>
              </div>
              <div className="flex gap-2">
                {/* Currency picker. COP es default para CO; resto del mundo arranca en USD.
                    Cambia el formato del input (separadores) y el mínimo de cuota. */}
                <select
                  value={form.currency}
                  onChange={(e) => updateForm("currency", e.target.value as FormState["currency"])}
                  className="px-3 py-3 rounded-xl outline-none bg-bg-elevated border border-border-subtle text-text-primary text-sm font-semibold focus:ring-1 focus:ring-gold/40 focus:border-gold/50 cursor-pointer"
                  style={{ minWidth: 80 }}
                  aria-label={t("step3CurrencyLabel")}
                >
                  <option value="COP">COP</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="MXN">MXN</option>
                  <option value="ARS">ARS</option>
                </select>
                <div className="relative flex-1">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted font-medium">$</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={form.buyInAmount > 0 ? form.buyInAmount.toLocaleString(locale === "en" ? "en-US" : "es-CO") : ""}
                    onChange={(e) => {
                      // Strip non-digits so the user can paste "10.000" or
                      // "10,000" and we still get a clean number. Limit to
                      // 9 digits so nobody types a billion-peso polla.
                      const digits = e.target.value.replace(/\D/g, "").slice(0, 9);
                      updateForm("buyInAmount", digits ? parseInt(digits, 10) : 0);
                    }}
                    placeholder={t("step3FeePlaceholder")}
                    className="w-full pl-8 pr-4 py-3 rounded-xl outline-none transition-colors bg-bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted/40 focus:ring-1 focus:ring-gold/40 focus:border-gold/50"
                  />
                </div>
              </div>
            </div>

            {/* Sección 2: Modo de pago */}
            <div className="rounded-2xl p-5 space-y-4 bg-bg-card/80 backdrop-blur-sm border border-border-subtle">
              <h2 className="text-base font-bold text-text-primary">{t("step3PaymentMode")}</h2>
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
              <>
                {/* Cuenta estructurada del admin — usada por la AI
                    para verificar screenshots automáticamente. Si el
                    admin tiene un default en /perfil, mostramos solo
                    una card resumen + botón "cambiar". Sin nag para
                    re-tipear lo mismo cada vez que crea polla. */}
                {payoutLocked && form.adminPayoutMethod && form.adminPayoutAccount ? (
                  <div className="rounded-2xl p-5 space-y-3 bg-bg-card/80 backdrop-blur-sm border border-border-subtle">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="text-base font-bold text-text-primary min-w-0">
                        {t("youReceiveAt")}
                      </h2>
                      <button
                        type="button"
                        onClick={() => setPayoutLocked(false)}
                        className="text-[11px] font-semibold px-3 py-1.5 rounded-lg border border-border-subtle text-text-secondary hover:border-gold/40 hover:text-gold transition-colors flex-shrink-0"
                      >
                        {t("change")}
                      </button>
                    </div>
                    <div className="rounded-xl px-4 py-3 bg-bg-elevated border border-border-subtle">
                      <p
                        className="text-[14px] font-semibold text-text-primary tabular-nums"
                        style={{ fontFeatureSettings: '"tnum"' }}
                      >
                        {form.adminPayoutAccount}
                      </p>
                      <p className="text-[11px] text-text-muted truncate">
                        {form.adminPayoutAccountType
                          ? `${form.adminPayoutAccountType === "ahorros" ? t("accountTypeAhorros") : t("accountTypeCorriente")} `
                          : ""}
                        {form.adminPayoutMethod === "nequi"
                          ? t("methodNequi")
                          : form.adminPayoutMethod === "bancolombia"
                            ? t("methodBancolombia")
                            : t("methodOtro")}
                        {form.adminPayoutAccountName ? ` · ${form.adminPayoutAccountName}` : ""}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl p-5 space-y-3 bg-bg-card/80 backdrop-blur-sm border border-border-subtle">
                    <h2 className="text-base font-bold text-text-primary">
                      {t("accountTitle")} <span className="text-red-alert">*</span>
                    </h2>

                    <div className="flex flex-wrap gap-1.5">
                      {(["nequi", "bancolombia", "otro"] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => updateForm("adminPayoutMethod", m)}
                          className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                            form.adminPayoutMethod === m
                              ? "bg-gold text-bg-base border-gold"
                              : "bg-bg-elevated text-text-secondary border-border-subtle hover:border-gold/40"
                          }`}
                        >
                          {m === "nequi" ? t("methodNequi") : m === "bancolombia" ? t("methodBancolombia") : t("methodOtro")}
                        </button>
                      ))}
                    </div>

                    <input
                      type="text"
                      value={form.adminPayoutAccount}
                      onChange={(e) => updateForm("adminPayoutAccount", e.target.value)}
                      placeholder={
                        form.adminPayoutMethod === "nequi"
                          ? t("phNequi")
                          : form.adminPayoutMethod === "bancolombia"
                            ? t("phBancolombia")
                            : t("phOtro")
                      }
                      className="w-full bg-bg-elevated border border-border-subtle rounded-xl px-4 py-3 text-[14px] text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-gold/50 focus:ring-1 focus:ring-gold/30"
                    />

                    {form.adminPayoutMethod && form.adminPayoutMethod !== "nequi" ? (
                      <>
                        <div className="flex flex-wrap gap-1.5">
                          {(["ahorros", "corriente"] as const).map((accType) => (
                            <button
                              key={accType}
                              type="button"
                              onClick={() => updateForm("adminPayoutAccountType", accType)}
                              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                                form.adminPayoutAccountType === accType
                                  ? "bg-gold text-bg-base border-gold"
                                  : "bg-bg-elevated text-text-secondary border-border-subtle hover:border-gold/40"
                              }`}
                            >
                              {accType === "ahorros" ? t("accountTypeAhorros") : t("accountTypeCorriente")}
                            </button>
                          ))}
                        </div>
                        <input
                          type="text"
                          value={form.adminPayoutAccountName}
                          onChange={(e) => updateForm("adminPayoutAccountName", e.target.value)}
                          placeholder={t("phNameOnAccount")}
                          className="w-full bg-bg-elevated border border-border-subtle rounded-xl px-4 py-3 text-[14px] text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-gold/50 focus:ring-1 focus:ring-gold/30"
                        />
                      </>
                    ) : null}
                  </div>
                )}

              </>
            )}

            {/* Sección 3: Premios (opcional) */}
            <div className="rounded-2xl p-5 space-y-3 bg-bg-card/80 backdrop-blur-sm border border-border-subtle">
              <div className="flex items-center gap-2">
                <Trophy className="w-4 h-4 text-gold" />
                <h2 className="text-base font-bold text-text-primary">{t("prizesTitle")}</h2>
                <span className="text-[10px] uppercase tracking-wide text-text-muted ml-auto">
                  {t("optional")}
                </span>
              </div>
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
                {t("summaryMatchesAndTournament", {
                  matches: selectedMatchIds.size,
                  tournament: isCombined
                    ? t("summaryCombinedTournaments", { count: form.tournaments.length })
                    : (tournamentMeta?.name ?? form.tournaments[0] ?? "—"),
                })}
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
          // Padding tighter para que el footer entero quepa cómodo en
          // viewports cortos (DevTools emulation, ventanas pequeñas en
          // laptop). En iOS el max() respeta el home indicator.
          padding: "8px 12px max(env(safe-area-inset-bottom, 0px), 8px)",
          zIndex: 40,
        }}
      >
        {error && (
          <div className="max-w-lg mx-auto mb-1.5">
            <p className="text-red-alert text-xs text-center bg-red-dim rounded-lg py-1 px-3">{error}</p>
          </div>
        )}
        <div className="max-w-lg mx-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => router.push("/pollas")}
            className="px-3 py-2 rounded-xl text-text-muted hover:text-text-primary text-sm font-medium transition-colors"
          >
            {t("footerCancel")}
          </button>
          {step > 1 && (
            <button
              type="button"
              onClick={() => goToStep((step - 1) as Step)}
              className="px-3 py-2 rounded-xl bg-bg-elevated text-text-secondary border border-border-subtle hover:border-gold/30 text-sm font-semibold inline-flex items-center gap-1"
            >
              <ArrowLeft className="w-4 h-4" /> {t("footerBack")}
            </button>
          )}
          <div className="flex-1" />
          {/* iOS: step 2 es el final (no hay step 3). Botón salta a
              "Crear polla" en step 2; el form usa los defaults sin plata. */}
          {(isIOSApp ? step < 2 : step < 3) ? (
            <button
              type="button"
              onClick={() => goToStep((step + 1) as Step)}
              disabled={step === 2 && selectedMatchIds.size === 0}
              className="px-4 py-2 rounded-xl bg-gold text-bg-base font-bold text-sm inline-flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ boxShadow: "0 0 16px rgba(255,215,0,0.18)" }}
            >
              {t("footerContinue")} <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading}
              className="px-4 py-2 rounded-xl bg-gold text-bg-base font-bold text-sm inline-flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ boxShadow: "0 0 20px rgba(255,215,0,0.25)" }}
            >
              {loading ? t("footerCreating") : (
                <>
                  {t("footerCreate")} <Trophy className="w-4 h-4" />
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
