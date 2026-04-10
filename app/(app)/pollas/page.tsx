// app/(app)/pollas/page.tsx — Mis Pollas con tabs Activas/Terminadas
// Uses shared PollaCard, tab styles from ui-reference.html .tabsw/.tbon/.tboff
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import PollaCard, { TOURNAMENT_ICONS } from "@/components/shared/PollaCard";
import { AnimatedList, AnimatedItem } from "@/components/ui/AnimatedList";
import { Plus } from "lucide-react";

interface PollaData {
  id: string; name: string; slug: string; description?: string;
  tournament: string; status: string; buy_in_amount: number;
  currency: string; payment_mode: string; type: string;
  participant_count?: number;
}

import { getTournamentName } from "@/lib/tournaments";

type TabFilter = "active" | "finished";

export default function MisPollasPage() {
  const router = useRouter();
  const [pollas, setPollas] = useState<PollaData[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabFilter>("active");

  useEffect(() => {
    async function load() {
      try { const { data } = await axios.get("/api/pollas"); setPollas(data.pollas || []); }
      catch { /* silently fail */ }
      finally { setLoading(false); }
    }
    load();
  }, []);

  const filtered = pollas.filter((p) => tab === "active" ? p.status === "active" : p.status === "finished");

  return (
    <div className="min-h-screen">
      <header className="px-4 pt-4 pb-3" style={{ background: "linear-gradient(180deg, #0a1628 0%, var(--bg-base) 100%)" }}>
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button onClick={() => router.push("/dashboard")} className="text-text-secondary text-xl">
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#7a8499" strokeWidth="2"><path d="M19 12H5M12 5l-7 7 7 7" /></svg>
          </button>
          <h1 className="text-xl font-bold text-text-primary flex items-center gap-2">
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#FFD700" strokeWidth="2">
              <path d="M6 9H4.5a2.5 2.5 0 010-5H6" /><path d="M18 9h1.5a2.5 2.5 0 000-5H18" />
              <path d="M4 22h16" /><path d="M18 2H6v7a6 6 0 0012 0V2z" />
            </svg>
            Mis Pollas
          </h1>
        </div>
      </header>

      <main className="max-w-lg mx-auto p-4 space-y-4">
        {/* Tabs — .tabsw style */}
        <div
          style={{
            display: "flex",
            background: "#0e1420",
            borderRadius: 10,
            padding: 3,
            border: "1px solid rgba(255,255,255,0.06)",
            gap: 2,
          }}
        >
          <button
            onClick={() => setTab("active")}
            style={{
              flex: 1,
              padding: 7,
              borderRadius: 8,
              background: tab === "active" ? "rgba(255,215,0,0.12)" : "transparent",
              color: tab === "active" ? "#FFD700" : "#4a5568",
              fontSize: 12,
              fontWeight: tab === "active" ? 600 : 500,
              border: "none",
              cursor: "pointer",
              fontFamily: "'Outfit', sans-serif",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
            }}
          >
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /></svg>
            Activas
          </button>
          <button
            onClick={() => setTab("finished")}
            style={{
              flex: 1,
              padding: 7,
              borderRadius: 8,
              background: tab === "finished" ? "rgba(255,215,0,0.12)" : "transparent",
              color: tab === "finished" ? "#FFD700" : "#4a5568",
              fontSize: 12,
              fontWeight: tab === "finished" ? 600 : 500,
              border: "none",
              cursor: "pointer",
              fontFamily: "'Outfit', sans-serif",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
            }}
          >
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
            Terminadas
          </button>
        </div>

        {loading ? (
          <div className="text-center py-8">
            <p className="text-text-muted text-sm">Cargando pollas...</p>
          </div>
        ) : filtered.length > 0 ? (
          <AnimatedList className="space-y-0">
            {filtered.map((polla) => (
              <AnimatedItem key={polla.id}>
                <PollaCard
                  name={polla.name}
                  tournamentName={getTournamentName(polla.tournament)}
                  tournamentIconPath={TOURNAMENT_ICONS[polla.tournament] || ""}
                  entryFee={polla.buy_in_amount}
                  participantCount={polla.participant_count ?? 0}
                  visibility={polla.type === "open" ? "publica" : "privada"}
                  isActive={polla.status === "active"}
                  onPress={() => router.push(`/pollas/${polla.slug}`)}
                />
              </AnimatedItem>
            ))}
          </AnimatedList>
        ) : (
          <div className="rounded-2xl p-8 text-center bg-bg-card border border-border-subtle">
            <p className="text-text-muted text-sm">
              {tab === "active" ? "No tenés pollas activas" : "No tenés pollas terminadas"}
            </p>
          </div>
        )}

        {/* Create button — full width gold */}
        <button
          onClick={() => router.push("/pollas/crear")}
          style={{
            width: "100%",
            background: "#FFD700",
            color: "#080c10",
            fontWeight: 700,
            borderRadius: 11,
            padding: 12,
            border: "none",
            cursor: "pointer",
            fontFamily: "'Outfit', sans-serif",
            fontSize: 13,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
          }}
        >
          <Plus size={14} strokeWidth={2.5} />
          Crear nueva polla
        </button>
      </main>
    </div>
  );
}
