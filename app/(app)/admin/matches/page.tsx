// app/(app)/admin/matches/page.tsx — Panel de admin para sync manual de partidos
// Protected server-side by app/(app)/admin/layout.tsx — no client-side access check needed
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { staggerContainer, fadeUp } from "@/lib/animations";
import { ArrowLeft, RefreshCw, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { syncMatchesAction, purgeMatchesAction } from "./actions";

// Competiciones disponibles (football-data.org IDs).
// Mundial 2026 (ID 2000) NO aparece en Principales: la fuente principal es
// openfootball (botón "Sync Mundial 2026" más abajo). La variante
// football-data.org vive en el bloque de Respaldo para evitar duplicados.
const LEAGUES = [
  { id: 2001, label: "Champions League", tournament: "champions_2025", active: true },
  { id: 2014, label: "La Liga", tournament: "laliga_2025", active: true },
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
  const [syncingWc, setSyncingWc] = useState(false);
  const [wcResult, setWcResult] = useState<string | null>(null);
  const [expandedBackup, setExpandedBackup] = useState(false);
  const [syncingMundialBackup, setSyncingMundialBackup] = useState(false);
  const [mundialBackupResult, setMundialBackupResult] = useState<string | null>(null);

  async function handleSyncMundialBackup() {
    setSyncingMundialBackup(true);
    setMundialBackupResult(null);
    try {
      const res = await fetch("/api/admin/sync-mundial", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error en sync");
      setMundialBackupResult(
        `${data.matchesSynced} agregados o actualizados · ${data.matchesTotal} total · ${data.errors} errores`
      );
    } catch (err: unknown) {
      const e = err as Error;
      setMundialBackupResult(`Error: ${e.message || "desconocido"}`);
    } finally {
      setSyncingMundialBackup(false);
    }
  }

  async function handleSyncWorldCup() {
    setSyncingWc(true);
    setWcResult(null);
    try {
      const res = await fetch("/api/admin/sync-worldcup", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error en sync");
      setWcResult(
        `${data.synced} sincronizados · ${data.skipped} saltados · ${data.errors} errores`
      );
    } catch (err: unknown) {
      const e = err as Error;
      setWcResult(`Error: ${e.message || "desconocido"}`);
    } finally {
      setSyncingWc(false);
    }
  }

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
          <button onClick={() => router.push("/inicio")} className="text-text-secondary hover:text-gold transition-colors duration-200 cursor-pointer">
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
          Principales: Champions y La Liga (football-data.org) más Mundial 2026 (openfootball). Respaldo vive en la sección colapsada de abajo.
        </div>

        <div>
          <h2 className="text-base font-bold text-text-primary mb-1">Principales</h2>
          <p className="text-xs text-text-muted mb-3">Fuentes activas para los torneos actuales</p>
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
                      {result.synced} actualizados · {result.errors} errores · {result.total} total
                    </p>
                  )}
                </div>
              )}
            </motion.div>
          );
        })}
        </motion.div>

        {/* Mundial 2026 primary sync: openfootball source covers groups + knockouts. */}
        <motion.div variants={fadeUp} initial="hidden" animate="visible" className="rounded-2xl p-4 bg-bg-card/80 backdrop-blur-sm border border-gold/30 hover:shadow-[0_0_20px_rgba(255,215,0,0.12)] transition-all duration-300">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="font-bold text-text-primary">Sync Mundial 2026</p>
              <p className="text-xs text-text-muted">Fuente principal con todos los 104 partidos (grupos + knockouts)</p>
            </div>
            <button
              onClick={handleSyncWorldCup}
              disabled={syncingWc}
              className="flex items-center gap-1.5 bg-gold text-bg-base px-5 py-3 rounded-xl text-sm font-semibold
                         hover:scale-[1.02] hover:brightness-110 hover:shadow-[0_0_24px_rgba(255,215,0,0.25)] active:scale-[0.98] disabled:opacity-40 transition-all duration-200 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncingWc ? "animate-spin" : ""}`} />
              {syncingWc ? "Sync..." : "Sync"}
            </button>
          </div>
          {wcResult && (
            <div className={`rounded-lg p-3 text-sm ${
              wcResult.startsWith("Error") ? "bg-red-dim text-red-alert" : "bg-green-dim text-green-live"
            }`}>
              <p>{wcResult}</p>
            </div>
          )}
        </motion.div>

        {/* Respaldo: fallbacks gated behind a collapse to keep the main grid
            focused. Clearly warns the operator about duplicate risk. */}
        <div className="rounded-2xl border border-border-subtle bg-bg-card/60 backdrop-blur-sm overflow-hidden">
          <button
            type="button"
            onClick={() => setExpandedBackup((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-bg-elevated transition-colors"
            aria-expanded={expandedBackup}
          >
            <div className="text-left">
              <p className="text-sm font-bold text-text-primary">Respaldo (avanzado)</p>
              <p className="text-xs text-text-muted">Fuentes alternativas por si las principales fallan</p>
            </div>
            {expandedBackup ? (
              <ChevronDown className="w-4 h-4 text-text-muted" aria-hidden="true" />
            ) : (
              <ChevronRight className="w-4 h-4 text-text-muted" aria-hidden="true" />
            )}
          </button>
          {expandedBackup ? (
            <div className="px-4 pb-4 space-y-3">
              <div className="rounded-lg p-3 flex items-start gap-2 bg-gold/10 border border-gold/20">
                <AlertTriangle className="w-4 h-4 text-gold flex-shrink-0 mt-0.5" aria-hidden="true" />
                <p className="text-xs text-text-secondary leading-snug">
                  Ejecutar respaldo DESPUÉS de correr el sync principal puede crear duplicados. Solo usar si la sincronización principal falló.
                </p>
              </div>
              <div className="rounded-xl p-4 bg-bg-elevated border border-border-subtle">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-sm font-semibold text-text-primary">Mundial 2026 (football-data.org)</p>
                    <p className="text-xs text-text-muted">Usar solo si openfootball no trae los datos. Puede crear duplicados.</p>
                  </div>
                  <button
                    onClick={handleSyncMundialBackup}
                    disabled={syncingMundialBackup}
                    className="flex items-center gap-1.5 bg-bg-card border border-border-medium text-text-primary px-3 py-2 rounded-lg text-xs font-semibold hover:border-gold/40 hover:text-gold transition-all disabled:opacity-40 cursor-pointer"
                  >
                    <RefreshCw className={`w-3 h-3 ${syncingMundialBackup ? "animate-spin" : ""}`} />
                    {syncingMundialBackup ? "Sync..." : "Sync"}
                  </button>
                </div>
                {mundialBackupResult ? (
                  <div className={`rounded-lg p-2 text-xs ${
                    mundialBackupResult.startsWith("Error") ? "bg-red-dim text-red-alert" : "bg-green-dim text-green-live"
                  }`}>
                    <p>{mundialBackupResult}</p>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
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
