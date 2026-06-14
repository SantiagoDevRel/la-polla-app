// components/admin/SentryHealthCard.tsx — Card de SALUD DE LA APP (Sentry).
// Consume /api/admin/sentry-health (REST API de Sentry, read-only, cache 10m).
// Responde "¿hay algo roto en prod?": errores 24h/7d, top issues sin resolver,
// usuarios afectados. La lente de confiabilidad que la DB/PostHog no dan.
"use client";

export interface SentryHealth {
  configured: boolean;
  errors24h: number;
  errors7d: number;
  unresolvedCount: number;
  topIssues: Array<{
    id: string;
    title: string;
    culprit: string;
    count: number;
    users: number;
    level: string;
    permalink: string;
    lastSeen: string;
  }>;
  stale?: boolean;
  error?: string;
}

const CARD_STYLE = { background: "#0e1420", border: "1px solid rgba(255,255,255,0.06)" } as const;
const TILE_STYLE = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" } as const;

const GOOD = "#1FD87F";
const NI = "#FF9F1C";
const POOR = "#FF3D57";

function levelColor(level: string): string {
  if (level === "fatal" || level === "error") return POOR;
  if (level === "warning") return NI;
  return "#6B7689";
}

function Tile({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-xl px-3 py-2.5" style={TILE_STYLE}>
      <p className="text-[10px] uppercase tracking-wide text-text-muted leading-tight">{label}</p>
      <p className="font-display mt-1 leading-none" style={{ fontSize: 24, color: tone ?? "#FFD700" }}>{value}</p>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">{children}</p>;
}

export default function SentryHealthCard({ data }: { data: SentryHealth | null }) {
  // "Salud" verde si no hay errores en 24h; ámbar si hay alguno; rojo si hay muchos.
  const tone24 = !data?.configured
    ? undefined
    : data.errors24h === 0
      ? GOOD
      : data.errors24h < 50
        ? NI
        : POOR;

  return (
    <section className="rounded-2xl p-4 space-y-5" style={CARD_STYLE}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-text-primary">Salud de la app · Sentry</h2>
        {data?.configured && !data.error ? (
          <span className="flex items-center gap-1.5 rounded-full px-2 py-0.5" style={{ background: `${tone24}1a` }}>
            <span className="inline-flex h-2 w-2 rounded-full" style={{ background: tone24 }} />
            <span className="text-[11px] font-semibold" style={{ color: tone24 }}>
              {data.errors24h === 0 ? "sin errores 24h" : `${data.errors24h} errores 24h`}
            </span>
          </span>
        ) : null}
      </div>

      {!data ? (
        <p className="text-xs text-text-muted">Cargando…</p>
      ) : !data.configured ? (
        <p className="text-xs text-text-muted leading-relaxed">
          Sentry no está configurado en el servidor. Falta{" "}
          <code className="text-gold">SENTRY_READ_TOKEN</code> (token de lectura) en el entorno.
        </p>
      ) : data.error ? (
        <p className="text-xs leading-relaxed" style={{ color: POOR }}>No se pudo leer Sentry: {data.error}</p>
      ) : (
        <>
          {data.stale ? (
            <p className="text-[10px]" style={{ color: NI }}>⚠ datos en caché (Sentry no respondió en el último intento)</p>
          ) : null}

          <div className="grid grid-cols-3 gap-2.5">
            <Tile label="Errores 24h" value={data.errors24h} tone={tone24} />
            <Tile label="Errores 7d" value={data.errors7d} />
            <Tile label="Issues abiertos" value={data.unresolvedCount} />
          </div>

          {data.topIssues.length > 0 ? (
            <div className="space-y-2.5 border-t border-white/[0.06] pt-4">
              <SectionLabel>Top issues sin resolver · 14d</SectionLabel>
              {data.topIssues.map((i) => (
                <a
                  key={i.id}
                  href={i.permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-xl px-3 py-2.5 transition-colors hover:border-gold/20"
                  style={TILE_STYLE}
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: levelColor(i.level) }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-text-primary leading-snug [overflow-wrap:anywhere]">{i.title}</p>
                      {i.culprit ? <p className="text-[10px] text-text-muted truncate mt-0.5">{i.culprit}</p> : null}
                      <p className="text-[10px] text-text-muted mt-1 tabular-nums">
                        {i.count} eventos · {i.users} {i.users === 1 ? "usuario" : "usuarios"}
                      </p>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <p className="text-xs" style={{ color: GOOD }}>Sin issues abiertos en los últimos 14 días. 🟢</p>
          )}
        </>
      )}
    </section>
  );
}
