// app/(app)/admin/matches/page.tsx — Panel de admin para sync manual de partidos
// Protected server-side by app/(app)/admin/layout.tsx — no client-side access check needed
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { staggerContainer, fadeUp } from "@/lib/animations";
import { ArrowLeft, RefreshCw, AlertTriangle } from "lucide-react";
import { syncMatchesAction, purgeMatchesAction } from "./actions";

// Competiciones disponibles (football-data.org IDs)
const LEAGUES = [
  { id: 2001, label: "Champions League", tournament: "champions_2025", active: true },
  { id: 2000, label: "Copa del Mundo 2026", tournament: "worldcup_2026", active: true },
  { id: 2014, label: "La Liga", tournament: "la_liga_2025", active: true },
];

interface SyncResult {
  synced: number;
  errors: number;
  total: number;
}

export default function AdminMatchesPage() {
  const router = useRouter();
  const [results, setResults] = useState<Record<number, SyncResult | string>>({});
  const [loading, setLoading] = useState<number | null>(null);
  const [purging, setPurging] = useState(false);
  const [purgeResult, setPurgeResult] = useState<string | null>(null);

  async function handlePurge() {
    if (!confirm("Eliminar todos los partidos anteriores al 1 enero 2026?")) return;
    setPurging(true);
    setPurgeResult(null);
    try {
      const result = await purgeMatchesAction();
      setPurgeResult(`${result.deleted} partidos eliminados`);
    } catch {
      setPurgeResult("Error al purgar partidos");
    } finally {
      setPurging(false);
    }
  }

  async function handleSync(competitionId: number, tournament: string) {
    setLoading(competitionId);
    try {
      const result = await syncMatchesAction(competitionId, tournament);
      setResults((prev) => ({ ...prev, [competitionId]: result }));
    } catch (err: unknown) {
      const e = err as Error;
      setResults((prev) => ({
        ...prev,
        [competitionId]: e.message || "Error desconocido",
      }));
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="min-h-screen">
      <header
        className="px-4 pt-4 pb-4"
        style={{ background: "linear-gradient(180deg, #0a1628 0%, var(--bg-base) 100%)" }}
      >
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button onClick={() => router.push("/dashboard")} className="text-text-secondary hover:text-gold transition-colors duration-200 cursor-pointer">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-bold text-text-primary">Admin — Partidos</h1>
        </div>
      </header>

      <main className="max-w-lg mx-auto p-4 space-y-4">
        <p className="text-sm text-text-secondary">
          Sincroniza partidos desde API-Football. Cada sync hace upsert —
          no duplica partidos existentes.
        </p>
        <div className="rounded-lg p-3 bg-blue-info/10 border border-blue-info/20 text-xs text-blue-info">
          Solo Champions League (ID 2) y Mundial 2026 (ID 1) estan activos en produccion.
        </div>

        <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-4">
        {LEAGUES.map((league) => {
          const result = results[league.id];
          const isLoading = loading === league.id;

          return (
            <motion.div key={league.id} variants={fadeUp} className="rounded-2xl p-4 bg-bg-card/80 backdrop-blur-sm border border-border-subtle hover:border-gold/20 hover:shadow-[0_0_20px_rgba(255,215,0,0.08)] transition-all duration-300">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="font-bold text-text-primary">{league.label}</p>
                  <p className="text-xs text-text-muted">Competition ID: {league.id} (football-data.org)</p>
                </div>
                <button
                  onClick={() => handleSync(league.id, league.tournament)}
                  disabled={isLoading}
                  className="flex items-center gap-1.5 bg-gold text-bg-base px-5 py-3 rounded-xl text-sm font-semibold
                             hover:scale-[1.02] hover:brightness-110 hover:shadow-[0_0_24px_rgba(255,215,0,0.25)] active:scale-[0.98] disabled:opacity-40 transition-all duration-200 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
                  {isLoading ? "Sync..." : "Sync"}
                </button>
              </div>

              {result && (
                <div className={`rounded-lg p-3 text-sm ${
                  typeof result === "string"
                    ? "bg-red-dim text-red-alert"
                    : "bg-green-dim text-green-live"
                }`}>
                  {typeof result === "string" ? (
                    <p>Error: {result}</p>
                  ) : (
                    <p>
                      {result.synced} insertados · {result.errors} errores · {result.total} total
                    </p>
                  )}
                </div>
              )}
            </motion.div>
          );
        })}
        </motion.div>

        <div className="rounded-xl p-4 flex items-start gap-3 bg-gold/10 border border-gold/20">
          <AlertTriangle className="w-5 h-5 text-gold flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-gold mb-1">Nota sobre Copa del Mundo 2026</p>
            <p className="text-sm text-text-secondary leading-snug">
              Si devuelve 0 partidos, el fixture oficial aun no esta publicado.
              Es normal hasta que la FIFA confirme el calendario completo.
            </p>
          </div>
        </div>

        {/* Purgar partidos antiguos */}
        <div className="rounded-xl p-4 bg-bg-card border border-border-subtle space-y-3">
          <p className="text-sm font-bold text-text-primary">Mantenimiento</p>
          <button
            onClick={handlePurge}
            disabled={purging}
            className="w-full py-2.5 rounded-xl text-sm font-semibold bg-red-alert text-white hover:bg-red-alert/90 transition-all duration-200 disabled:opacity-40 cursor-pointer"
          >
            {purging ? "Purgando..." : "Purgar partidos anteriores a 2026"}
          </button>
          {purgeResult && (
            <p className="text-sm text-center text-text-secondary">{purgeResult}</p>
          )}
        </div>
      </main>
    </div>
  );
}
