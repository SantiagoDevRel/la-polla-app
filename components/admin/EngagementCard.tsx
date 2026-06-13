// components/admin/EngagementCard.tsx — Card de ENGAGEMENT del admin (Nivel 1).
// Consume /api/admin/engagement (RPC admin_engagement, agregación en SQL).
// Mide si la gente JUEGA (no solo si entra): embudo de activación, jugadores
// que pronosticaron, pronósticos/día, retención de activación, fill-rate de
// la bracket y distribuciones.
//
// Layout en "tiles" espaciados con secciones divididas — preferimos scroll
// largo y legible antes que grids apretados que truncan (pedido user).
"use client";

export interface EngagementData {
  funnel: { registered: number; onboarded: number; joinedPolla: number; predicted: number };
  players: { active7d: number; active30d: number; preds7d: number; preds30d: number; predsPerActive30d: number };
  predsSeries: { day: string; preds: number }[];
  activation: Record<"d1" | "d7" | "d30", { num: number; den: number; pct: number }>;
  bracket: { filled: number; pctOfRegistered: number };
  distribution: { pollasPerUser: { avg: number; max: number }; participantsPerPolla: { avg: number; max: number } };
}

const CARD_STYLE = { background: "#0e1420", border: "1px solid rgba(255,255,255,0.06)" } as const;
const TILE_STYLE = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" } as const;

function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : 0;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">{children}</p>;
}

/** Tile de métrica: label arriba (puede ir en 2 líneas), valor grande abajo. */
function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-xl px-3 py-2.5" style={TILE_STYLE}>
      <p className="text-[10px] uppercase tracking-wide text-text-muted leading-tight [overflow-wrap:anywhere]">{label}</p>
      <p className="font-display mt-1 leading-none" style={{ fontSize: 24, color: "#FFD700" }}>{value}</p>
      {sub ? <p className="text-[10px] text-text-muted mt-1 leading-tight">{sub}</p> : null}
    </div>
  );
}

export default function EngagementCard({ data }: { data: EngagementData | null }) {
  return (
    <section className="rounded-2xl p-4 space-y-5" style={CARD_STYLE}>
      <h2 className="text-sm font-bold text-text-primary">Engagement · juego real</h2>
      {!data ? (
        <p className="text-xs text-text-muted">Cargando…</p>
      ) : (
        <>
          {/* ── Embudo de activación ── */}
          <div className="space-y-2.5">
            <SectionLabel>Embudo de activación</SectionLabel>
            {[
              { label: "Registrados", value: data.funnel.registered },
              { label: "Onboarding completo", value: data.funnel.onboarded },
              { label: "En ≥1 polla", value: data.funnel.joinedPolla },
              { label: "Hicieron ≥1 pronóstico", value: data.funnel.predicted },
            ].map((step) => {
              const p = pct(step.value, data.funnel.registered);
              return (
                <div key={step.label}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[13px] text-text-secondary">{step.label}</span>
                    <span className="flex items-baseline gap-1.5">
                      <span className="font-display text-text-primary" style={{ fontSize: 17 }}>{step.value}</span>
                      <span className="text-[11px] text-text-muted tabular-nums">{p}%</span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-bg-base">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(2, p)}%`, background: "#FFD700" }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Jugadores que pronosticaron ── */}
          <div className="space-y-3 border-t border-white/[0.06] pt-4">
            <SectionLabel>Jugadores que pronostican</SectionLabel>
            <div className="grid grid-cols-2 gap-2.5">
              <Tile label="Jugadores · 7d" value={data.players.active7d} />
              <Tile label="Jugadores · 30d" value={data.players.active30d} />
              <Tile label="Pronósticos · 7d" value={data.players.preds7d} />
              <Tile label="Pronósticos · 30d" value={data.players.preds30d} />
            </div>
            <Tile label="Pronósticos por jugador (30d)" value={data.players.predsPerActive30d} />
          </div>

          {/* ── Pronósticos por día ── */}
          <div className="space-y-2 border-t border-white/[0.06] pt-4">
            <SectionLabel>Pronósticos · últimos 14 días</SectionLabel>
            <div className="flex items-end gap-1 h-24">
              {data.predsSeries.map((d) => {
                const max = Math.max(1, ...data.predsSeries.map((x) => x.preds));
                const h = (d.preds / max) * 100;
                return (
                  <div key={d.day} className="flex-1 flex flex-col-reverse items-center" title={`${d.day} · ${d.preds} pronósticos`}>
                    <div className="w-full rounded-t-sm" style={{ height: `${Math.max(2, h)}%`, background: "#FFD700" }} />
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Retención de activación ── */}
          <div className="space-y-3 border-t border-white/[0.06] pt-4">
            <div className="space-y-0.5">
              <SectionLabel>Retención de activación</SectionLabel>
              <p className="text-[11px] text-text-muted leading-snug">
                % de registrados que hizo su primer pronóstico dentro de sus primeros días de cuenta.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              {([
                { label: "D1", v: data.activation.d1 },
                { label: "D7", v: data.activation.d7 },
                { label: "D30", v: data.activation.d30 },
              ] as const).map((s) => (
                <Tile key={s.label} label={s.label} value={`${s.v.pct}%`} sub={`${s.v.num}/${s.v.den}`} />
              ))}
            </div>
          </div>

          {/* ── Bracket del Mundial ── */}
          <div className="space-y-3 border-t border-white/[0.06] pt-4">
            <SectionLabel>Bracket del Mundial</SectionLabel>
            <Tile
              label="Armaron su camino"
              value={data.bracket.filled}
              sub={`${data.bracket.pctOfRegistered}% de los registrados`}
            />
          </div>

          {/* ── Distribución ── */}
          <div className="space-y-3 border-t border-white/[0.06] pt-4">
            <SectionLabel>Distribución</SectionLabel>
            <div className="grid grid-cols-2 gap-2.5">
              <Tile
                label="Pollas por usuario"
                value={data.distribution.pollasPerUser.avg}
                sub={`prom · máx ${data.distribution.pollasPerUser.max}`}
              />
              <Tile
                label="Gente por polla"
                value={data.distribution.participantsPerPolla.avg}
                sub={`prom · máx ${data.distribution.participantsPerPolla.max}`}
              />
            </div>
          </div>
        </>
      )}
    </section>
  );
}
