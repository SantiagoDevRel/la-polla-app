// app/(app)/admin/matches/page.tsx — Panel de admin para sync manual de partidos
// Protected server-side by app/(app)/admin/layout.tsx — no client-side access check needed
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { fadeUp } from "@/lib/animations";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { purgeMatchesAction } from "./actions";

// Post-Mundial 2026 la plataforma corre SOLO con el Mundial. Las ligas
// que antes vivían en "Principales" (Champions/La Liga via football-data)
// se retiraron del panel: ninguna polla activa las usa y el sync
// automático también quedó limitado a worldcup_2026 (ver
// SYNCABLE_TOURNAMENT_SLUGS en lib/tournaments.ts). Para reactivar una
// liga, además de re-agregar su botón acá hay que sumar su slug a esa lista.

export default function AdminMatchesPage() {
  const router = useRouter();
  const [purging, setPurging] = useState(false);
  const [purgeResult, setPurgeResult] = useState<string | null>(null);
  const [syncingWc, setSyncingWc] = useState(false);
  const [wcResult, setWcResult] = useState<string | null>(null);

  async function handleSyncWorldCup() {
    if (!confirm("¿Seguro que quieres sincronizar Copa del Mundo 2026?")) return;
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

  return (
    <div className="min-h-screen">
      <header
        className="px-4 pt-4 pb-4"

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
          Sincroniza los partidos del Mundial 2026. Cada sync hace upsert —
          no duplica partidos existentes.
        </p>
        <div className="rounded-lg p-3 bg-blue-info/10 border border-blue-info/20 text-xs text-blue-info">
          Fuente única: Mundial 2026 con los 104 partidos (grupos + knockouts).
        </div>

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

        {/* Purgar partidos antiguos */}
        <div className="rounded-xl p-4 lp-card space-y-3">
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
