// app/design/page.tsx
// Internal preview — tokens, typography, and component library verification.
// Not linked from any user-facing screen. Access via /design directly.
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { ScoringRules } from "@/components/ui/ScoringRules";
import { MatchHero } from "@/components/match/MatchHero";
import { MatchBetSlip } from "@/components/match/MatchBetSlip";
import { LiveChip } from "@/components/match/LiveChip";
import { PollaCard } from "@/components/polla/PollaCard";
import { PodiumLeaderboard } from "@/components/leaderboard/PodiumLeaderboard";
import { BottomNav } from "@/components/nav/BottomNav";
import { PollitoMoment } from "@/components/pollito/PollitoMoment";
import type { MomentKey } from "@/lib/pollito/moments";
import { MOMENTS } from "@/lib/pollito/moments";

const NOW = Date.now();
const IN_2H_14M = new Date(NOW + 2 * 60 * 60 * 1000 + 14 * 60 * 1000);
const IN_3H = new Date(NOW + 3 * 60 * 60 * 1000);
const IN_26H = new Date(NOW + 26 * 60 * 60 * 1000);
const IN_TOMORROW_15H = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(15, 0, 0, 0);
  return d;
})();

const ARSENAL = { name: "Arsenal", shortCode: "ARS" };
const BARCA = { name: "Barcelona", shortCode: "BAR" };
const REAL = { name: "Real Madrid", shortCode: "RMA" };
const BAYERN = { name: "Bayern", shortCode: "BAY" };
const JUVE = { name: "Juventus", shortCode: "JUV" };
const MILAN = { name: "Milan", shortCode: "MIL" };

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10" id={id}>
      <h2 className="font-display text-2xl mb-4 text-gold">{title}</h2>
      {children}
    </section>
  );
}

function MomentDemo() {
  const [active, setActive] = useState<MomentKey | null>(null);

  const VARS: Record<MomentKey, Record<string, string | number>> = {
    M1: {},
    M2: {},
    M3: { home: 2, away: 1 },
    M4: { n: 3, rank: 2 },
    M5: { diff: 2, rival: "Andrés" },
    M6: {},
    M7: { nombre: "Champions Pana" },
    M8: {},
  };

  const estadoFor = (key: MomentKey) => MOMENTS[key].estado;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(MOMENTS) as MomentKey[]).map((k) => (
          <Button
            key={k}
            variant={active === k ? "primary" : "secondary"}
            size="sm"
            onClick={() => setActive(active === k ? null : k)}
          >
            {k} · {MOMENTS[k].display}
          </Button>
        ))}
      </div>
      {active && MOMENTS[active].display === "inline" ? (
        <PollitoMoment
          key={`inline-${active}`}
          moment={active}
          estado={estadoFor(active)}
          userPollitoType="goleador"
          vars={VARS[active]}
          forceShow
          onDismiss={() => setActive(null)}
          cta={{ label: "Ver detalles", onClick: () => setActive(null) }}
        />
      ) : null}
      {active && MOMENTS[active].display === "sheet" ? (
        <PollitoMoment
          key={`sheet-${active}`}
          moment={active}
          estado={estadoFor(active)}
          userPollitoType="goleador"
          vars={VARS[active]}
          forceShow
          onDismiss={() => setActive(null)}
          cta={{ label: "Dale", onClick: () => setActive(null) }}
        />
      ) : null}
    </div>
  );
}

function UpcomingBetSlipDemo() {
  const [pred, setPred] = useState<{ home: number; away: number }>({ home: 2, away: 1 });
  return (
    <MatchBetSlip
      match={{
        id: "m1",
        homeTeam: ARSENAL,
        awayTeam: BARCA,
        kickoffAt: IN_3H,
        lockAt: IN_2H_14M,
        jornada: "J3",
      }}
      state="upcoming"
      currentPrediction={pred}
      onPredictionChange={(h, a) => setPred({ home: h, away: a })}
      pollaContext={{ correctWinnerCount: 3, total: 5, avg: { home: 1, away: 1 } }}
      onSave={async () => {
        await new Promise((r) => setTimeout(r, 400));
      }}
    />
  );
}

export default function DesignPage() {
  return (
    <div className="min-h-screen bg-bg-base text-text-primary p-6 max-w-4xl mx-auto pb-[140px]">
      <h1 className="font-display text-5xl tracking-wide mb-6">TRIBUNA CALIENTE</h1>
      <p className="text-text-secondary mb-10">Design tokens + component library · v0.1</p>

      <Section id="01-palette" title="01 — Palette">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            { name: "bg-base", hex: "#080c10", style: { background: "#080c10" } },
            { name: "bg-card", hex: "#0e1420", style: { background: "#0e1420" } },
            { name: "bg-elevated", hex: "#131b2b", style: { background: "#131b2b" } },
            { name: "gold", hex: "#FFD700", style: { background: "#FFD700", color: "#000" } },
            { name: "amber", hex: "#FF9F1C", style: { background: "#FF9F1C", color: "#000" } },
            { name: "turf", hex: "#1FD87F", style: { background: "#1FD87F", color: "#000" } },
            { name: "red-alert", hex: "#FF3D57", style: { background: "#FF3D57", color: "#000" } },
            { name: "text-primary", hex: "#F5F7FA", style: { background: "#F5F7FA", color: "#000" } },
            { name: "text-secondary", hex: "#AEB7C7", style: { background: "#AEB7C7", color: "#000" } },
          ].map((c) => (
            <div key={c.name} className="rounded-lg overflow-hidden border border-white/10">
              <div className="h-20 flex items-end p-3 font-display tracking-wider text-xs" style={c.style}>
                {c.hex}
              </div>
              <div className="p-3 bg-bg-card">
                <p className="text-sm font-semibold">{c.name}</p>
                <p className="text-xs text-text-muted font-mono">{c.hex}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section id="02-typography" title="02 — Typography">
        <div className="space-y-4 bg-bg-card p-6 rounded-lg border border-white/10">
          <div>
            <span className="text-xs text-text-muted uppercase tracking-wider">Bebas 56</span>
            <p className="font-display text-[56px] leading-none">Santiago</p>
          </div>
          <div>
            <span className="text-xs text-text-muted uppercase tracking-wider">Bebas 40 gold</span>
            <p className="font-display text-[40px] leading-none text-gold">2 — 1</p>
          </div>
          <div>
            <span className="text-xs text-text-muted uppercase tracking-wider">Bebas 20 section</span>
            <p className="font-display text-[20px] leading-none tracking-wide">MIS POLLAS</p>
          </div>
          <div>
            <span className="text-xs text-text-muted uppercase tracking-wider">Outfit 15 body</span>
            <p className="font-body text-[15px]">2 partidos te esperan hoy</p>
          </div>
          <div>
            <span className="text-xs text-text-muted uppercase tracking-wider">Outfit 11 label</span>
            <p className="font-body text-[11px] font-semibold tracking-[0.08em] uppercase text-text-muted">
              Próximo partido
            </p>
          </div>
        </div>
      </Section>

      <Section id="03-buttons" title="03 — Buttons">
        <p className="text-text-muted text-xs uppercase tracking-wider mb-2">Variants</p>
        <div className="flex flex-wrap gap-3 mb-4">
          <Button variant="primary">Crear polla</Button>
          <Button variant="secondary">Ver detalles</Button>
          <Button variant="danger-outline">Cerrar sesión</Button>
        </div>
        <p className="text-text-muted text-xs uppercase tracking-wider mb-2">Sizes</p>
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
        </div>
        <p className="text-text-muted text-xs uppercase tracking-wider mb-2">States</p>
        <div className="flex flex-wrap gap-3">
          <Button loading>Loading</Button>
          <Button disabled>Disabled</Button>
        </div>
      </Section>

      <Section id="04-chips" title="04 — Chips">
        <p className="text-text-muted text-xs uppercase tracking-wider mb-2">Variants</p>
        <div className="flex flex-wrap items-center gap-3">
          <Chip variant="live" label="Vivo 67'" />
          <Chip variant="locks" label="Bloquea en 2H 14M" />
          <Chip variant="leader" label="Líder" />
          <Chip variant="final" label="Final" />
          <Chip variant="wrong" label="0 pts" />
        </div>
      </Section>

      <Section id="05-scoring" title="05 — Scoring rules">
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <p className="text-text-muted text-xs uppercase tracking-wider mb-2">Full</p>
            <ScoringRules />
          </div>
          <div>
            <p className="text-text-muted text-xs uppercase tracking-wider mb-2">Compact</p>
            <ScoringRules compact />
          </div>
        </div>
      </Section>

      <Section id="06-matchhero" title="06 — Match hero">
        <MatchHero
          competition={{ name: "Champions" }}
          kickoffAt={IN_3H}
          homeTeam={ARSENAL}
          awayTeam={BARCA}
          myPrediction={{ home: 2, away: 1 }}
          pollaAverage={{ home: 1, away: 1 }}
          lockAt={IN_2H_14M}
        />
      </Section>

      <Section id="07-betslip" title="07 — Match bet slip">
        <div className="space-y-4">
          <div>
            <p className="text-text-muted text-xs uppercase tracking-wider mb-2">Upcoming</p>
            <UpcomingBetSlipDemo />
          </div>
          <div>
            <p className="text-text-muted text-xs uppercase tracking-wider mb-2">Locked</p>
            <MatchBetSlip
              match={{
                id: "m2",
                homeTeam: REAL,
                awayTeam: BAYERN,
                kickoffAt: IN_2H_14M,
                lockAt: new Date(NOW - 10 * 60 * 1000),
              }}
              state="locked"
              currentPrediction={{ home: 1, away: 2 }}
            />
          </div>
          <div>
            <p className="text-text-muted text-xs uppercase tracking-wider mb-2">Final · +5 pts (exact)</p>
            <MatchBetSlip
              match={{
                id: "m3",
                homeTeam: JUVE,
                awayTeam: MILAN,
                kickoffAt: new Date(NOW - 2 * 3600_000),
                lockAt: new Date(NOW - 3 * 3600_000),
              }}
              state="final"
              currentPrediction={{ home: 3, away: 1 }}
              actualScore={{ home: 3, away: 1 }}
              pointsEarned={5}
              socialContext="Solo vos acertaste el exacto"
            />
          </div>
          <div>
            <p className="text-text-muted text-xs uppercase tracking-wider mb-2">Final · 0 pts</p>
            <MatchBetSlip
              match={{
                id: "m4",
                homeTeam: JUVE,
                awayTeam: MILAN,
                kickoffAt: new Date(NOW - 2 * 3600_000),
                lockAt: new Date(NOW - 3 * 3600_000),
              }}
              state="final"
              currentPrediction={{ home: 2, away: 0 }}
              actualScore={{ home: 0, away: 2 }}
              pointsEarned={0}
              socialContext="Nadie acertó este"
            />
          </div>
        </div>
      </Section>

      <Section id="08-livechips" title="08 — Live chips">
        <div className="flex gap-3 overflow-x-auto pb-2 hide-scrollbar">
          <LiveChip
            kind="live"
            homeCode="ARS"
            awayCode="BAR"
            homeScore={2}
            awayScore={1}
            minute={67}
            myPrediction={{ home: 2, away: 1 }}
            predictionStatus="correct"
          />
          <LiveChip
            kind="upcoming"
            homeCode="RMA"
            awayCode="BAY"
            kickoffAt={IN_TOMORROW_15H}
            myPrediction={{ home: 1, away: 2 }}
            predictionStatus="wrong"
          />
          <LiveChip
            kind="upcoming"
            homeCode="JUV"
            awayCode="MIL"
            kickoffAt={IN_26H}
            predictionStatus="pending"
          />
        </div>
      </Section>

      <Section id="09-pollacard" title="09 — Polla card">
        <p className="text-text-muted text-xs uppercase tracking-wider mb-2">Carousel · leader + non-leader</p>
        <div className="flex gap-3 overflow-x-auto pb-2 hide-scrollbar">
          <PollaCard
            polla={{
              id: "p1",
              slug: "champions-pana",
              name: "Champions Pana",
              competitionName: "Champions",
              participantCount: 12,
              buyInAmount: 50000,
              totalMatches: 15,
              finishedMatches: 4,
            }}
            userContext={{ rank: 1, totalPoints: 28, isLeader: true }}
            variant="carousel"
          />
          <PollaCard
            polla={{
              id: "p2",
              slug: "mundial-oficina",
              name: "Mundial Oficina 2026",
              competitionName: "FIFA World Cup",
              participantCount: 22,
              buyInAmount: 0,
              totalMatches: 64,
              finishedMatches: 12,
            }}
            userContext={{ rank: 6, totalPoints: 14, isLeader: false }}
            variant="carousel"
          />
        </div>
        <p className="text-text-muted text-xs uppercase tracking-wider mt-6 mb-2">Grid · leader + non-leader</p>
        <div className="grid md:grid-cols-2 gap-3">
          <PollaCard
            polla={{
              id: "p3",
              slug: "champions-pana-g",
              name: "Champions Pana",
              competitionName: "Champions",
              participantCount: 12,
              buyInAmount: 50000,
              totalMatches: 15,
              finishedMatches: 4,
            }}
            userContext={{ rank: 1, totalPoints: 28, isLeader: true }}
            variant="grid"
          />
          <PollaCard
            polla={{
              id: "p4",
              slug: "mundial-oficina-g",
              name: "Mundial Oficina 2026",
              competitionName: "FIFA World Cup",
              participantCount: 22,
              buyInAmount: 0,
              totalMatches: 64,
              finishedMatches: 12,
            }}
            userContext={{ rank: 6, totalPoints: 14, isLeader: false }}
            variant="grid"
          />
        </div>
      </Section>

      <Section id="10-podium" title="10 — Podium leaderboard">
        <div className="max-w-md">
          <PodiumLeaderboard
            pollaName="Champions Pana"
            currentUserId="u1"
            top3={[
              { userId: "u1", name: "Santiago", points: 28 },
              { userId: "u2", name: "Andrés", points: 24 },
              { userId: "u3", name: "Laura", points: 21 },
            ]}
          />
        </div>
      </Section>

      <Section id="11-bottomnav" title="11 — Bottom nav">
        <div
          className="relative border border-dashed border-border-default rounded-xl"
          style={{ height: 180, background: "rgba(255,255,255,0.02)" }}
        >
          <div className="absolute inset-0 flex items-center justify-center text-text-muted text-xs uppercase tracking-wider">
            simulación — active: inicio
          </div>
          <div className="absolute left-0 right-0 bottom-0 pointer-events-none">
            {/* Scoped preview: render the nav statically inside this frame.
                The real nav is position:fixed — here we want to display it in place. */}
            <div className="relative max-w-[480px] mx-auto" style={{ height: 100 }}>
              <nav
                aria-label="Navegación inferior (preview)"
                className="absolute left-[14px] right-[14px] bottom-[14px] z-10 rounded-full backdrop-blur-md border border-border-subtle h-[76px] pointer-events-auto"
                style={{ background: "rgba(14, 20, 32, 0.92)" }}
              >
                <div className="relative h-full flex items-center px-4">
                  <div className="flex-1 flex">
                    <div className="flex flex-col items-center justify-center flex-1 min-h-[44px] gap-0.5 text-gold">
                      <span className="font-body text-[10px] font-semibold">Inicio</span>
                    </div>
                    <div className="flex flex-col items-center justify-center flex-1 min-h-[44px] gap-0.5 text-text-muted">
                      <span className="font-body text-[10px] font-semibold">Explorar</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label="Crear polla"
                    className="absolute left-1/2 -translate-x-1/2 -top-6 w-[58px] h-[58px] rounded-full bg-gold flex items-center justify-center"
                    style={{
                      boxShadow:
                        "0 0 0 4px var(--bg-base), 0 10px 24px -6px rgba(255,215,0,0.55)",
                    }}
                  >
                    <span className="font-display text-[32px] leading-none text-bg-base">+</span>
                  </button>
                  <div className="flex-1 flex">
                    <div className="flex flex-col items-center justify-center flex-1 min-h-[44px] gap-0.5 text-text-muted">
                      <span className="font-body text-[10px] font-semibold">Pollas</span>
                    </div>
                    <div className="flex flex-col items-center justify-center flex-1 min-h-[44px] gap-0.5 text-text-muted">
                      <span className="font-body text-[10px] font-semibold">Perfil</span>
                    </div>
                  </div>
                </div>
              </nav>
            </div>
          </div>
        </div>
        <p className="text-text-muted text-xs mt-2">
          Real BottomNav is `position: fixed`. A simulated inline copy renders above so /design stays scrollable.
          The actual component lives at `components/nav/BottomNav.tsx`.
        </p>
        <div className="mt-4">
          <BottomNav active="inicio" />
        </div>
      </Section>

      <Section id="12-pollito" title="12 — Pollito moments">
        <p className="text-text-muted text-xs mb-3">
          Click any moment to trigger. Sheet variants (M1/M2/M7/M8) open the vaul drawer.
          Inline variants (M3/M4/M5/M6) render in-flow below the buttons.
          Uses `userPollitoType=&quot;goleador&quot;` for this preview.
        </p>
        <MomentDemo />
      </Section>
    </div>
  );
}
