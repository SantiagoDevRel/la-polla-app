// app/(app)/admin/discrepancias/page.tsx
// Panel admin para resolver discrepancias entre ESPN y football-data
// cuando el cron las detecta. Mientras un match esté finished SIN
// final_verified_at, el scoring NO se ejecuta — para evitar puntuar
// con datos mal. El admin elige qué cifra es la real y al confirmar:
//   1. Se marca final_verified_at=NOW(), score correcto.
//   2. El trigger SQL trigger_score_predictions corre solo y puntúa.
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { ArrowLeft, AlertTriangle, Check } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import FootballLoader from "@/components/ui/FootballLoader";

interface Discrepancy {
  id: string;
  tournament: string;
  home_team: string;
  away_team: string;
  home_team_flag: string | null;
  away_team_flag: string | null;
  home_score: number | null;
  away_score: number | null;
  espn_status: string | null;
  espn_home: number | null;
  espn_away: number | null;
  scheduled_at: string;
  final_verification_notes: string | null;
  alerted_at: string | null;
}

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export default function AdminDiscrepanciasPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [items, setItems] = useState<Discrepancy[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [manualDraft, setManualDraft] = useState<Record<string, { home: string; away: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get<{ matches: Discrepancy[] }>("/api/admin/discrepancies");
      setItems(res.data.matches);
    } catch {
      showToast("No se pudieron cargar las discrepancias", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  async function resolve(
    match: Discrepancy,
    source: "espn" | "fd" | "manual",
    home?: number,
    away?: number,
  ) {
    setBusyId(match.id);
    try {
      const body =
        source === "fd"
          ? { source }
          : { source, home, away };
      await axios.post(`/api/admin/discrepancies/${match.id}`, body);
      showToast("Discrepancia resuelta — el scoring va a ejecutarse", "success");
      await load();
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? "Error al resolver";
      showToast(msg, "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="min-h-screen" style={{ background: "#080c10" }}>
      <header className="px-4 pt-4 pb-3">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button
            onClick={() => router.push("/admin")}
            className="text-text-secondary hover:text-gold transition-colors"
            aria-label="Volver"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-bold text-text-primary flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber" /> Discrepancias
          </h1>
        </div>
      </header>

      <main className="max-w-lg mx-auto p-4 space-y-3">
        {loading ? (
          <div className="flex flex-col items-center gap-2 py-8">
            <FootballLoader />
            <p className="text-text-muted text-sm">Cargando…</p>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl p-6 lp-card text-center space-y-2">
            <Check className="w-8 h-8 text-turf mx-auto" />
            <p className="text-sm text-text-primary font-semibold">Sin discrepancias</p>
            <p className="text-[12px] text-text-muted">
              Todos los partidos finalizados están verificados. El scoring corre solo.
            </p>
          </div>
        ) : (
          <>
            <p className="text-[12px] text-text-secondary mb-1">
              {items.length} partido{items.length > 1 ? "s" : ""} esperan tu confirmación.
              Mientras no resuelvas la discrepancia, el scoring no se ejecuta.
            </p>
            {items.map((m) => {
              const fd = { h: m.home_score, a: m.away_score };
              const espn = { h: m.espn_home, a: m.espn_away };
              const matches = fd.h === espn.h && fd.a === espn.a;
              const draft = manualDraft[m.id] ?? { home: "", away: "" };
              return (
                <article
                  key={m.id}
                  className="lp-card p-4 space-y-3 border border-amber/20"
                >
                  <header className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-[0.1em] text-text-muted truncate">
                        {m.tournament}
                      </p>
                      <p className="text-sm font-semibold text-text-primary truncate">
                        {m.home_team} vs {m.away_team}
                      </p>
                    </div>
                    <span className="text-[11px] text-text-muted whitespace-nowrap">
                      {fmtDate(m.scheduled_at)}
                    </span>
                  </header>

                  {/* Score side-by-side */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl p-3 bg-bg-elevated border border-border-subtle">
                      <p className="text-[10px] uppercase tracking-wide text-text-muted">football-data</p>
                      <p className="font-display text-[28px] text-text-primary tabular-nums" style={{ fontFeatureSettings: '"tnum"' }}>
                        {fd.h ?? "—"} - {fd.a ?? "—"}
                      </p>
                      <button
                        type="button"
                        onClick={() => resolve(m, "fd")}
                        disabled={busyId === m.id}
                        className="mt-2 w-full text-[11px] font-semibold py-1.5 rounded-lg bg-turf/15 border border-turf/30 text-turf hover:bg-turf/20 transition-colors disabled:opacity-50"
                      >
                        {busyId === m.id ? "…" : "Confirmar este"}
                      </button>
                    </div>
                    <div className="rounded-xl p-3 bg-bg-elevated border border-border-subtle">
                      <p className="text-[10px] uppercase tracking-wide text-text-muted">ESPN</p>
                      <p className="font-display text-[28px] text-text-primary tabular-nums" style={{ fontFeatureSettings: '"tnum"' }}>
                        {espn.h ?? "—"} - {espn.a ?? "—"}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          if (espn.h === null || espn.a === null) {
                            showToast("ESPN no tiene score disponible", "error");
                            return;
                          }
                          resolve(m, "espn", espn.h, espn.a);
                        }}
                        disabled={busyId === m.id || espn.h === null}
                        className="mt-2 w-full text-[11px] font-semibold py-1.5 rounded-lg bg-turf/15 border border-turf/30 text-turf hover:bg-turf/20 transition-colors disabled:opacity-50"
                      >
                        {busyId === m.id ? "…" : "Confirmar este"}
                      </button>
                    </div>
                  </div>

                  {matches ? (
                    <p className="text-[11px] text-turf">
                      Las dos fuentes coinciden ahora — confirmá cualquiera.
                    </p>
                  ) : null}

                  {/* Manual override */}
                  <div className="rounded-xl p-3 bg-bg-base border border-border-subtle space-y-2">
                    <p className="text-[10px] uppercase tracking-wide text-text-muted">
                      Manual (override)
                    </p>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={draft.home}
                        onChange={(e) =>
                          setManualDraft((p) => ({
                            ...p,
                            [m.id]: { ...draft, home: e.target.value.replace(/\D/g, "") },
                          }))
                        }
                        placeholder={String(fd.h ?? 0)}
                        className="w-14 text-center bg-bg-elevated border border-border-subtle rounded-lg px-2 py-1 text-sm text-text-primary placeholder:text-text-muted/40 focus:outline-none focus:border-gold/50"
                      />
                      <span className="text-text-muted">-</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={draft.away}
                        onChange={(e) =>
                          setManualDraft((p) => ({
                            ...p,
                            [m.id]: { ...draft, away: e.target.value.replace(/\D/g, "") },
                          }))
                        }
                        placeholder={String(fd.a ?? 0)}
                        className="w-14 text-center bg-bg-elevated border border-border-subtle rounded-lg px-2 py-1 text-sm text-text-primary placeholder:text-text-muted/40 focus:outline-none focus:border-gold/50"
                      />
                      <button
                        type="button"
                        disabled={busyId === m.id || !draft.home || !draft.away}
                        onClick={() => {
                          const h = parseInt(draft.home, 10);
                          const a = parseInt(draft.away, 10);
                          if (!Number.isFinite(h) || !Number.isFinite(a)) return;
                          resolve(m, "manual", h, a);
                        }}
                        className="ml-auto text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-amber/15 border border-amber/30 text-amber hover:bg-amber/20 transition-colors disabled:opacity-50"
                      >
                        {busyId === m.id ? "…" : "Aplicar"}
                      </button>
                    </div>
                  </div>

                  {m.alerted_at ? (
                    <p className="text-[10px] text-text-muted">
                      Alertado: {fmtDate(m.alerted_at)}
                    </p>
                  ) : null}
                </article>
              );
            })}
          </>
        )}
      </main>
    </div>
  );
}
