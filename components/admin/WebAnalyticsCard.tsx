// components/admin/WebAnalyticsCard.tsx — Card de TRÁFICO & COMPORTAMIENTO del
// admin. Consume /api/admin/web-analytics (PostHog Query API + HogQL, cache 5m).
// Muestra lo que la DB NO ve: visitantes (incl. anónimos), top páginas,
// dispositivo y performance real (web vitals). Complementa EngagementCard
// (juego, DB) y Analytics (logins, DB).
"use client";

export interface WebAnalytics {
  configured: boolean;
  live30m: number;
  traffic: {
    pageviews7d: number;
    visitors7d: number;
    sessions7d: number;
    pageviewsPrev7d: number;
    visitorsPrev7d: number;
  };
  daily: Array<{ day: string; pageviews: number; visitors: number }>;
  topPages: Array<{ path: string; views: number; visitors: number }>;
  devices: Array<{ device: string; views: number }>;
  webVitals: { lcpP75: number | null; inpP75: number | null; clsP75: number | null };
  error?: string;
}

const CARD_STYLE = { background: "#0e1420", border: "1px solid rgba(255,255,255,0.06)" } as const;
const TILE_STYLE = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" } as const;

const GOOD = "#1FD87F";
const NI = "#FF9F1C";
const POOR = "#FF3D57";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">{children}</p>;
}

function Tile({ label, value, sub, trend }: { label: string; value: React.ReactNode; sub?: string; trend?: number | null }) {
  return (
    <div className="rounded-xl px-3 py-2.5" style={TILE_STYLE}>
      <p className="text-[10px] uppercase tracking-wide text-text-muted leading-tight [overflow-wrap:anywhere]">{label}</p>
      <p className="font-display mt-1 leading-none flex items-baseline gap-1.5" style={{ fontSize: 24, color: "#FFD700" }}>
        {value}
        {typeof trend === "number" ? (
          <span className="text-[11px] font-body font-semibold tabular-nums" style={{ color: trend >= 0 ? GOOD : POOR }}>
            {trend >= 0 ? "▲" : "▼"} {Math.abs(trend)}%
          </span>
        ) : null}
      </p>
      {sub ? <p className="text-[10px] text-text-muted mt-1 leading-tight">{sub}</p> : null}
    </div>
  );
}

function trendPct(now: number, prev: number): number | null {
  if (!prev) return null;
  return Math.round(((now - prev) / prev) * 1000) / 10;
}

/** Acorta una URL completa a su path para mostrar (cae al string crudo si ya es path). */
function shortPath(p: string): string {
  try {
    const u = new URL(p);
    return (u.pathname + u.search) || "/";
  } catch {
    return p || "/";
  }
}

function Vital({
  label,
  value,
  unit,
  fmt,
  thresholds,
}: {
  label: string;
  value: number | null;
  unit: string;
  fmt: (v: number) => string;
  thresholds: [number, number]; // [good ≤, ni ≤]
}) {
  const color =
    value === null ? "#6B7689" : value <= thresholds[0] ? GOOD : value <= thresholds[1] ? NI : POOR;
  const rating =
    value === null ? "sin datos" : value <= thresholds[0] ? "bueno" : value <= thresholds[1] ? "mejorable" : "malo";
  return (
    <div className="rounded-xl px-3 py-2.5" style={TILE_STYLE}>
      <p className="text-[10px] uppercase tracking-wide text-text-muted leading-tight">{label}</p>
      <p className="font-display mt-1 leading-none" style={{ fontSize: 22, color }}>
        {value === null ? "—" : fmt(value)}
        <span className="text-[11px] font-body text-text-muted ml-0.5">{value === null ? "" : unit}</span>
      </p>
      <p className="text-[10px] mt-1 leading-tight" style={{ color }}>{rating}</p>
    </div>
  );
}

export default function WebAnalyticsCard({ data }: { data: WebAnalytics | null }) {
  return (
    <section className="rounded-2xl p-4 space-y-5" style={CARD_STYLE}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-text-primary">Tráfico &amp; comportamiento · PostHog</h2>
        {data?.configured && !data.error ? (
          <span className="flex items-center gap-1.5 rounded-full px-2 py-0.5" style={{ background: "rgba(31,216,127,0.1)" }}>
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: GOOD }} />
              <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: GOOD }} />
            </span>
            <span className="text-[11px] font-semibold tabular-nums" style={{ color: GOOD }}>
              {data.live30m} en vivo
            </span>
          </span>
        ) : null}
      </div>

      {!data ? (
        <p className="text-xs text-text-muted">Cargando…</p>
      ) : !data.configured ? (
        <p className="text-xs text-text-muted leading-relaxed">
          PostHog no está configurado en el servidor. Falta la variable{" "}
          <code className="text-gold">POSTHOG_PERSONAL_API_KEY</code> (y{" "}
          <code className="text-gold">POSTHOG_PROJECT_ID</code>) en el entorno.
        </p>
      ) : data.error ? (
        <p className="text-xs leading-relaxed" style={{ color: POOR }}>
          No se pudo leer PostHog: {data.error}
        </p>
      ) : (
        <>
          {/* ── Tráfico (7d vs 7d previos) ── */}
          <div className="space-y-3">
            <SectionLabel>Tráfico · últimos 7 días</SectionLabel>
            <div className="grid grid-cols-3 gap-2.5">
              <Tile
                label="Visitantes"
                value={data.traffic.visitors7d}
                trend={trendPct(data.traffic.visitors7d, data.traffic.visitorsPrev7d)}
                sub={`prev: ${data.traffic.visitorsPrev7d}`}
              />
              <Tile
                label="Pageviews"
                value={data.traffic.pageviews7d}
                trend={trendPct(data.traffic.pageviews7d, data.traffic.pageviewsPrev7d)}
                sub={`prev: ${data.traffic.pageviewsPrev7d}`}
              />
              <Tile label="Sesiones" value={data.traffic.sessions7d} />
            </div>
          </div>

          {/* ── Serie diaria (14d) ── */}
          {data.daily.length > 0 ? (
            <div className="space-y-2 border-t border-white/[0.06] pt-4">
              <SectionLabel>Pageviews · últimos 14 días</SectionLabel>
              <div className="flex items-end gap-1 h-24">
                {data.daily.map((d) => {
                  const max = Math.max(1, ...data.daily.map((x) => x.pageviews));
                  const h = (d.pageviews / max) * 100;
                  return (
                    <div
                      key={d.day}
                      className="flex-1 flex flex-col-reverse items-center"
                      title={`${d.day} · ${d.pageviews} pageviews · ${d.visitors} visitantes`}
                    >
                      <div className="w-full rounded-t-sm" style={{ height: `${Math.max(2, h)}%`, background: "#FFD700" }} />
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* ── Top páginas ── */}
          {data.topPages.length > 0 ? (
            <div className="space-y-2.5 border-t border-white/[0.06] pt-4">
              <SectionLabel>Páginas más vistas · 7d</SectionLabel>
              {data.topPages.map((p) => {
                const max = Math.max(1, ...data.topPages.map((x) => x.views));
                const w = (p.views / max) * 100;
                return (
                  <div key={p.path}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[12px] text-text-secondary truncate" title={p.path}>{shortPath(p.path)}</span>
                      <span className="flex items-baseline gap-1.5 shrink-0">
                        <span className="font-display text-text-primary" style={{ fontSize: 15 }}>{p.views}</span>
                        <span className="text-[10px] text-text-muted tabular-nums">{p.visitors} vis</span>
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-bg-base">
                      <div className="h-full rounded-full" style={{ width: `${Math.max(2, w)}%`, background: "#FFD700" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {/* ── Dispositivo ── */}
          {data.devices.length > 0 ? (
            <div className="space-y-2.5 border-t border-white/[0.06] pt-4">
              <SectionLabel>Dispositivo · 7d</SectionLabel>
              {(() => {
                const total = data.devices.reduce((a, d) => a + d.views, 0) || 1;
                return data.devices.map((d) => {
                  const w = (d.views / total) * 100;
                  return (
                    <div key={d.device}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[12px] text-text-secondary capitalize">{d.device}</span>
                        <span className="text-[11px] text-text-muted tabular-nums">{Math.round(w)}% · {d.views}</span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-bg-base">
                        <div className="h-full rounded-full" style={{ width: `${Math.max(2, w)}%`, background: "#FFD700" }} />
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          ) : null}

          {/* ── Web Vitals p75 ── */}
          <div className="space-y-3 border-t border-white/[0.06] pt-4">
            <div className="space-y-0.5">
              <SectionLabel>Web Vitals · p75 · 7d</SectionLabel>
              <p className="text-[11px] text-text-muted leading-snug">Performance real percibida por tus usuarios (percentil 75).</p>
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              <Vital label="LCP" value={data.webVitals.lcpP75} unit="s" fmt={(v) => (v / 1000).toFixed(2)} thresholds={[2500, 4000]} />
              <Vital label="INP" value={data.webVitals.inpP75} unit="ms" fmt={(v) => String(Math.round(v))} thresholds={[200, 500]} />
              <Vital label="CLS" value={data.webVitals.clsP75} unit="" fmt={(v) => v.toFixed(2)} thresholds={[0.1, 0.25]} />
            </div>
          </div>
        </>
      )}
    </section>
  );
}
