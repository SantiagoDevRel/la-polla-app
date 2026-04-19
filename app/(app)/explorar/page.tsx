// app/(app)/explorar/page.tsx — Explorar pollas abiertas
// Uses shared PollaCard, tournament filter chips from ui-reference.html
"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import PollaCard from "@/components/polla/PollaCard";
import { TOURNAMENT_ICONS } from "@/lib/tournaments";
import { AnimatedList, AnimatedItem } from "@/components/ui/AnimatedList";
import FootballLoader from "@/components/ui/FootballLoader";

interface PublicPolla {
  id: string; name: string; slug: string; description?: string;
  tournament: string; buy_in_amount: number; currency: string;
  payment_mode: string; type: string; status: string; participant_count: number;
}

import { getTournamentName } from "@/lib/tournaments";

function adaptPolla(raw: PublicPolla): React.ComponentProps<typeof PollaCard>["polla"] {
  return {
    id: raw.id,
    slug: raw.slug,
    name: raw.name,
    competitionName: getTournamentName(raw.tournament) ?? "Desconocido",
    competitionLogoUrl: TOURNAMENT_ICONS[raw.tournament],
    participantCount: raw.participant_count ?? 0,
    buyInAmount: raw.buy_in_amount ?? 0,
    totalMatches: 0, // API does not return yet — Phase 3b scope
    finishedMatches: 0,
  };
}

export default function ExplorarPage() {
  const router = useRouter();
  const [pollas, setPollas] = useState<PublicPolla[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedTournament, setSelectedTournament] = useState<string>("todos");

  useEffect(() => {
    async function load() {
      try {
        const { data } = await axios.get("/api/pollas/public");
        setPollas((data.pollas || []).map((p: PublicPolla) => ({ ...p, status: "active" })));
      } catch { /* silently fail */ }
      finally { setLoading(false); }
    }
    load();
  }, []);

  // Derive unique tournaments from fetched pollas
  const tournaments = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of pollas) {
      if (!seen.has(p.tournament)) {
        seen.set(p.tournament, getTournamentName(p.tournament));
      }
    }
    return Array.from(seen.entries()).map(([value, label]) => ({ value, label }));
  }, [pollas]);

  // Client-side filtering
  const filtered = pollas.filter((p) => {
    const matchesSearch = !search || p.name.toLowerCase().includes(search.toLowerCase());
    const matchesTournament = selectedTournament === "todos" || p.tournament === selectedTournament;
    return matchesSearch && matchesTournament;
  });

  return (
    <div className="min-h-screen">
      <header className="px-4 pt-4 pb-4" style={{ background: "linear-gradient(180deg, #0a1628 0%, var(--bg-base) 100%)" }}>
        <div className="max-w-lg mx-auto">
          <h1 className="text-xl font-bold text-text-primary mb-3 flex items-center gap-2">
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#FFD700" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            Explorar pollas
          </h1>
          {/* Search bar */}
          <div
            style={{
              background: "#0e1420",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 10,
              padding: "9px 12px",
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 12,
            }}
          >
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#4a5568" strokeWidth="2" style={{ flexShrink: 0 }}>
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre..."
              style={{
                background: "transparent",
                border: "none",
                outline: "none",
                color: "#f0f4ff",
                fontSize: 13,
                fontFamily: "'Outfit', sans-serif",
                width: "100%",
              }}
            />
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 space-y-3">
        {/* Tournament filter chips */}
        {tournaments.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: 6,
              marginBottom: 12,
              overflowX: "auto",
              WebkitOverflowScrolling: "touch",
              paddingBottom: 2,
              scrollbarWidth: "none",
            }}
            className="hide-scrollbar"
          >
            {/* "Todos" chip — always first */}
            <button
              onClick={() => setSelectedTournament("todos")}
              style={{
                borderRadius: 20,
                padding: "4px 10px",
                fontSize: 11,
                fontWeight: selectedTournament === "todos" ? 600 : 500,
                cursor: "pointer",
                whiteSpace: "nowrap",
                background: selectedTournament === "todos" ? "rgba(255,215,0,0.1)" : "#0e1420",
                color: selectedTournament === "todos" ? "#FFD700" : "#4a5568",
                border: selectedTournament === "todos"
                  ? "1px solid rgba(255,215,0,0.22)"
                  : "1px solid rgba(255,255,255,0.06)",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontFamily: "'Outfit', sans-serif",
              }}
            >
              Todos
            </button>
            {tournaments.map((t) => (
              <button
                key={t.value}
                onClick={() => setSelectedTournament(t.value)}
                style={{
                  borderRadius: 20,
                  padding: "4px 10px",
                  fontSize: 11,
                  fontWeight: selectedTournament === t.value ? 600 : 500,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  background: selectedTournament === t.value ? "rgba(255,215,0,0.1)" : "#0e1420",
                  color: selectedTournament === t.value ? "#FFD700" : "#4a5568",
                  border: selectedTournament === t.value
                    ? "1px solid rgba(255,215,0,0.22)"
                    : "1px solid rgba(255,255,255,0.06)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontFamily: "'Outfit', sans-serif",
                }}
              >
                {TOURNAMENT_ICONS[t.value] && (
                  <img
                    src={TOURNAMENT_ICONS[t.value]}
                    alt=""
                    width={13}
                    height={13}
                    style={{ width: 13, height: 13, objectFit: "contain" }}
                  />
                )}
                {t.label}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="flex flex-col items-center gap-2 py-8">
            <FootballLoader />
            <p className="text-text-muted text-sm">Buscando pollas...</p>
          </div>
        ) : filtered.length > 0 ? (
          <AnimatedList className="space-y-0">
            {filtered.map((polla) => (
              <AnimatedItem key={polla.id}>
                <PollaCard
                  polla={adaptPolla(polla)}
                  onTap={() => router.push(`/pollas/${polla.slug}`)}
                />
              </AnimatedItem>
            ))}
          </AnimatedList>
        ) : (
          <div className="rounded-2xl p-8 text-center bg-bg-card border border-border-subtle">
            <p className="text-text-muted text-sm mb-4">
              {search ? "No hay pollas que coincidan" : "No hay pollas abiertas"}
            </p>
            <a href="/pollas/crear" className="inline-block bg-gold text-bg-base font-semibold py-2 px-4 rounded-xl text-sm cursor-pointer">
              ¡Creá una!
            </a>
          </div>
        )}
      </main>
    </div>
  );
}
