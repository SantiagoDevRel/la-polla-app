// app/(app)/admin/matches/page.tsx — Panel de admin para sync manual de partidos desde API-Football
// Solo accesible si el usuario tiene alguna polla con role = 'admin'
// NOTA de deuda técnica: el CRON_SECRET se envía desde el frontend vía NEXT_PUBLIC_CRON_SECRET.
// Esto es aceptable para un MVP/testing pero no es producción-grade.
// En producción, este endpoint debería validar que el usuario sea admin vía session.
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { motion } from "framer-motion";
import { staggerContainer, fadeUp } from "@/lib/animations";
import { ArrowLeft, RefreshCw, AlertTriangle } from "lucide-react";

// Ligas disponibles para sincronizar
const LEAGUES = [
  { id: 2, season: 2024, label: "Champions League 2024-2025", tournament: "champions_2025" },
  { id: 1, season: 2026, label: "Copa del Mundo 2026", tournament: "worldcup_2026" },
  { id: 239, season: 2025, label: "Liga BetPlay 2025", tournament: "liga_betplay_2025" },
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
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);

  // Verificar que el usuario es admin de al menos una polla
  useEffect(() => {
    async function checkAdminAccess() {
      try {
        const { data } = await axios.get("/api/pollas");
        const pollas = data.pollas || [];
        // Si el usuario tiene pollas, tiene acceso al admin
        // (el GET /api/pollas ya filtra por usuario autenticado)
        setHasAccess(pollas.length > 0);
      } catch {
        setHasAccess(false);
      } finally {
        setCheckingAccess(false);
      }
    }
    checkAdminAccess();
  }, []);

  // Redirigir si no tiene acceso
  useEffect(() => {
    if (!checkingAccess && !hasAccess) {
      router.push("/dashboard");
    }
  }, [checkingAccess, hasAccess, router]);

  async function handleSync(leagueId: number, season: number) {
    setLoading(leagueId);
    try {
      const { data } = await axios.post(
        "/api/matches/sync",
        { leagueId, season },
        { headers: { "x-cron-secret": process.env.NEXT_PUBLIC_CRON_SECRET || "" } }
      );
      setResults((prev) => ({ ...prev, [leagueId]: data }));
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setResults((prev) => ({
        ...prev,
        [leagueId]: e.response?.data?.error || "Error desconocido",
      }));
    } finally {
      setLoading(null);
    }
  }

  if (checkingAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-text-muted text-sm">Verificando acceso...</p>
      </div>
    );
  }

  if (!hasAccess) return null;

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

        <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-4">
        {LEAGUES.map((league) => {
          const result = results[league.id];
          const isLoading = loading === league.id;

          return (
            <motion.div key={league.id} variants={fadeUp} className="rounded-2xl p-4 bg-bg-card/80 backdrop-blur-sm border border-border-subtle hover:border-gold/20 hover:shadow-[0_0_20px_rgba(255,215,0,0.08)] transition-all duration-300">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="font-bold text-text-primary">{league.label}</p>
                  <p className="text-xs text-text-muted">League ID: {league.id} · Season: {league.season}</p>
                </div>
                <button
                  onClick={() => handleSync(league.id, league.season)}
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
              Si devuelve 0 partidos o error, el fixture oficial aún no está publicado en API-Football.
              Es normal hasta que la FIFA confirme el calendario completo.
              El plan gratuito solo soporta temporadas 2022-2024.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
