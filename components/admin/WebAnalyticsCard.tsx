// components/admin/WebAnalyticsCard.tsx — Card de TRÁFICO & COMPORTAMIENTO del
// admin. Consume /api/admin/web-analytics (PostHog Query API + HogQL, cache 12m).
// Muestra lo que la DB NO ve: visitantes (incl. anónimos), embudo desde el
// anónimo, fuentes de tráfico, cuándo entra la gente, top páginas, dispositivo
// y performance real (web vitals). Complementa EngagementCard (juego, DB) y
// Analytics (logins, DB).
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
  funnel: { visitantes: number; vioPolla: number; guardo: number };
  newReturning: { nuevos: number; recurrentes: number };
  daily: Array<{ day: string; pageviews: number; visitors: number }>;
  topPages: Array<{ path: string; views: number; visitors: number }>;
  sources: Array<{ source: string; visitors: number; views: number }>;
  devices: Array<{ device: string; views: number }>;
  heatmap: Array<{ dow: number; hour: number; count: number }>;
  webVitals: { lcpP75: number | null; inpP75: number | null; clsP75: number | null };
  stale?: boolean;
  error?: string;
}

const CARD_STYLE = { background: "#0e1420", border: "1px solid rgba(255,255,255,0.06)" } as const;
const TILE_STYLE = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" } as const;

const GOLD = "#FFD700";
const GOOD = "#1FD87F";
const NI = "#FF9F1C";
const POOR = "#FF3D57";
const DOW = ["", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]; // 1=Lun..7=Dom
const OWN_DOMAINS = ["lapollacolombiana.com", "www.lapollacolombiana.com", "chickenpicks.app", "www.chickenpicks.app"];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">{children}</p>;
}

function Tile({ label, value, sub, trend }: { label: string; value: React.ReactNode; sub?: string; trend?: number | null }) {
  return (
    <div className="rounded-xl px-3 py-2.5" style={TILE_STYLE}>
      <p className="text-[10px] uppercase tracking-wide text-text-muted leading-tight [overflow-wrap:anywhere]">{label}</p>
      <p className="font-display mt-1 leading-none flex items-baseline gap-1.5" style={{ fontSize: 24, color: GOLD }}>
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

function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : 0;
}

function shortPath(p: string): string {
  try {
    const u = new URL(p);
    return u.pathname + u.search || "/";
  } catch {
    return p || "/";
  }
}

function sourceLabel(s: string): string {
  if (s === "$direct" || s === "") return "Directo / app";
  if (OWN_DOMAINS.includes(s)) return "Interno (navegación)";
  if (s.includes("google")) return "Google";
  if (s.includes("bing")) return "Bing";
  if (s.includes("facebook") || s === "l.facebook.com") return "Facebook";
  if (s.includes("instagram") || s === "l.instagram.com") return "Instagram";
  if (s.includes("whatsapp") || s.includes("wa.me")) return "WhatsApp";
  if (s.includes("t.co") || s.includes("twitter") || s === "x.com") return "X / Twitter";
  return s;
}

function Vital({
  label, value, unit, fmt, thresholds,
}: {
  label: string; value: number | null; unit: string; fmt: (v: number) => string; thresholds: [number, number];
}) {
  const color = value === null ? "#6B7689" : value <= thresholds[0] ? GOOD : value <= thresholds[1] ? NI : POOR;
  const rating = value === null ? "sin datos" : value <= thresholds[0] ? "bueno" : value <= thresholds[1] ? "mejorable" : "malo";
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

/** Heatmap 7×24: filas = días (Lun..Dom), columnas = horas (0..23), opacidad = volumen. */
function Heatmap({ data }: { data: WebAnalytics["heatmap"] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const grid = new Map<string, number>();
  for (const d of data) grid.set(`${d.dow}-${d.hour}`, d.count);
  const hours = Array.from({ length: 24 }, (_, h) => h);
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <div className="inline-block min-w-full">
        {[1, 2, 3, 4, 5, 6, 7].map((dow) => (
          <div key={dow} className="flex items-center gap-[3px] mb-[3px]">
            <span className="text-[9px] text-text-muted w-6 shrink-0">{DOW[dow]}</span>
            {hours.map((h) => {
              const c = grid.get(`${dow}-${h}`) ?? 0;
              const o = c === 0 ? 0.04 : 0.15 + (c / max) * 0.85;
              return (
                <div
                  key={h}
                  className="h-3 flex-1 min-w-[8px] rounded-[2px]"
                  style={{ background: c === 0 ? "rgba(255,255,255,0.04)" : `rgba(255,215,0,${o})` }}
                  title={`${DOW[dow]} ${String(h).padStart(2, "0")}:00 · ${c} pageviews`}
                />
              );
            })}
          </div>
        ))}
        <div className="flex items-center gap-[3px] mt-1">
          <span className="w-6 shrink-0" />
          {hours.map((h) => (
            <span key={h} className="text-[8px] text-text-muted flex-1 min-w-[8px] text-center">
              {h % 6 === 0 ? h : ""}
            </span>
          ))}
        </div>
      </div>
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
            <span className="text-[11px] font-semibold tabular-nums" style={{ color: GOOD }}>{data.live30m} en vivo</span>
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
        <p className="text-xs leading-relaxed" style={{ color: POOR }}>No se pudo leer PostHog: {data.error}</p>
      ) : (
        <>
          {data.stale ? (
            <p className="text-[10px]" style={{ color: NI }}>⚠ datos en caché (PostHog no respondió en el último intento)</p>
          ) : null}

          {/* ── Tráfico (7d vs 7d previos) ── */}
          <div className="space-y-3">
            <SectionLabel>Tráfico · últimos 7 días</SectionLabel>
            <div className="grid grid-cols-3 gap-2.5">
              <Tile label="Visitantes" value={data.traffic.visitors7d} trend={trendPct(data.traffic.visitors7d, data.traffic.visitorsPrev7d)} sub={`prev: ${data.traffic.visitorsPrev7d}`} />
              <Tile label="Pageviews" value={data.traffic.pageviews7d} trend={trendPct(data.traffic.pageviews7d, data.traffic.pageviewsPrev7d)} sub={`prev: ${data.traffic.pageviewsPrev7d}`} />
              <Tile label="Sesiones" value={data.traffic.sessions7d} />
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <Tile label="Visitantes nuevos" value={data.newReturning.nuevos} />
              <Tile label="Recurrentes" value={data.newReturning.recurrentes} />
            </div>
          </div>

          {/* ── Embudo visitante → jugador ── */}
          <div className="space-y-2.5 border-t border-white/[0.06] pt-4">
            <div className="space-y-0.5">
              <SectionLabel>Embudo · visitante → jugador · 7d</SectionLabel>
              <p className="text-[11px] text-text-muted leading-snug">Desde el visitante anónimo (lo que la DB no ve) hasta guardar un pronóstico.</p>
            </div>
            {[
              { label: "Visitantes", value: data.funnel.visitantes },
              { label: "Vieron una polla", value: data.funnel.vioPolla },
              { label: "Guardaron un pronóstico", value: data.funnel.guardo },
            ].map((step) => {
              const p = pct(step.value, data.funnel.visitantes);
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
                    <div className="h-full rounded-full" style={{ width: `${Math.max(2, p)}%`, background: GOLD }} />
                  </div>
                </div>
              );
            })}
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
                    <div key={d.day} className="flex-1 flex flex-col-reverse items-center" title={`${d.day} · ${d.pageviews} pageviews · ${d.visitors} visitantes`}>
                      <div className="w-full rounded-t-sm" style={{ height: `${Math.max(2, h)}%`, background: GOLD }} />
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* ── Cuándo entra la gente (heatmap) ── */}
          {data.heatmap.length > 0 ? (
            <div className="space-y-2 border-t border-white/[0.06] pt-4">
              <div className="space-y-0.5">
                <SectionLabel>Cuándo entra la gente · 14d</SectionLabel>
                <p className="text-[11px] text-text-muted leading-snug">Hora local (Colombia). Más brillante = más actividad. Útil para timing de avisos.</p>
              </div>
              <Heatmap data={data.heatmap} />
            </div>
          ) : null}

          {/* ── Fuentes de tráfico ── */}
          {data.sources.length > 0 ? (
            <div className="space-y-2.5 border-t border-white/[0.06] pt-4">
              <SectionLabel>Fuentes de tráfico · 7d</SectionLabel>
              {(() => {
                const total = data.sources.reduce((a, x) => a + x.visitors, 0) || 1;
                return data.sources.map((s) => {
                  const w = (s.visitors / total) * 100;
                  return (
                    <div key={s.source}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[12px] text-text-secondary truncate" title={s.source}>{sourceLabel(s.source)}</span>
                        <span className="text-[11px] text-text-muted tabular-nums shrink-0">{s.visitors} vis</span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-bg-base">
                        <div className="h-full rounded-full" style={{ width: `${Math.max(2, w)}%`, background: GOLD }} />
                      </div>
                    </div>
                  );
                });
              })()}
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
                      <div className="h-full rounded-full" style={{ width: `${Math.max(2, w)}%`, background: GOLD }} />
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
                        <div className="h-full rounded-full" style={{ width: `${Math.max(2, w)}%`, background: GOLD }} />
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
