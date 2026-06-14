// lib/sentry/admin-health.ts — Salud de la app desde Sentry (REST API) para el
// dashboard /admin. SERVER-ONLY: usa un token de lectura (secreto), nunca toca
// el cliente. Responde "¿hay algo roto en prod ahora?": errores 24h/7d, top
// issues sin resolver, usuarios afectados.
//
// COSTO / FREE-TIER (auditado 2026-06-14): LEER issues/stats NO consume la cuota
// de 5k errores/mes (solo los errores ingestados cuentan). Rate limit por
// (caller, endpoint) holgado; disparamos ~3 reads por refresh, cache 10 min.
// Cero impacto en Supabase. Guardas: cache + stale-on-error + skip-if-no-key.
//
// SERVER-ONLY por construcción: solo lo importa app/api/admin/sentry-health/route.ts
// y SENTRY_READ_TOKEN no tiene prefijo NEXT_PUBLIC.

const API_HOST = process.env.SENTRY_API_HOST || "https://sentry.io";
const ORG = process.env.SENTRY_ORG || "golem-bw";
const PROJECT = process.env.SENTRY_PROJECT || "santi-apps";
const PROJECT_ID = process.env.SENTRY_PROJECT_ID || "4511560489500672"; // santi-apps (numérico, para events-stats)
const TOKEN = process.env.SENTRY_READ_TOKEN || "";
// santi-apps es un proyecto GENÉRICO compartido por varias apps, separadas por
// el tag `app`. Filtramos a la-polla para que la card sea de ESTA app, no de todas.
const APP_TAG = process.env.SENTRY_APP_TAG || "la-polla";
const TAG_FILTER = APP_TAG ? `app:${APP_TAG}` : "";

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

const EMPTY: SentryHealth = {
  configured: false,
  errors24h: 0,
  errors7d: 0,
  unresolvedCount: 0,
  topIssues: [],
};

const TTL_MS = 10 * 60 * 1000;
let cache: { at: number; data: SentryHealth } | null = null;

async function sentry<T>(path: string): Promise<T> {
  const res = await fetch(`${API_HOST}/api/0${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`sentry ${res.status}: ${text.slice(0, 160)}`);
  }
  return (await res.json()) as T;
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export async function getSentryHealth(): Promise<SentryHealth> {
  if (!TOKEN) return { ...EMPTY, error: "missing_credentials" };
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;

  // 1) Serie de errores (events-stats, 7d, 1h) filtrada por app → sumamos 7d/24h.
  const statsPath =
    `/organizations/${ORG}/events-stats/` +
    `?project=${PROJECT_ID}&dataset=errors&yAxis=${encodeURIComponent("count()")}` +
    `&statsPeriod=7d&interval=1h&query=${encodeURIComponent(TAG_FILTER)}`;
  // 2) Top issues sin resolver (14d, por frecuencia), filtrados por app.
  const issuesQuery = TAG_FILTER ? `is:unresolved ${TAG_FILTER}` : "is:unresolved";
  const issuesPath =
    `/projects/${ORG}/${PROJECT}/issues/` +
    `?query=${encodeURIComponent(issuesQuery)}&statsPeriod=14d&sort=freq&limit=6`;

  const [statsR, issuesR] = await Promise.allSettled([
    sentry<{ data: Array<[number, Array<{ count: number }>]> }>(statsPath),
    sentry<
      Array<{
        id: string;
        title: string;
        culprit: string;
        count: string | number;
        userCount: number;
        level: string;
        permalink: string;
        lastSeen: string;
      }>
    >(issuesPath),
  ]);

  // STALE-ON-ERROR: si la llamada base (stats) falla, servimos lo último bueno.
  if (statsR.status === "rejected") {
    if (cache) return { ...cache.data, stale: true };
    return { ...EMPTY, configured: true, error: statsR.reason?.message ?? "sentry_failed" };
  }

  const series = statsR.value?.data || [];
  const bucket = (v: Array<{ count: number }>): number => (v && v[0] ? num(v[0].count) : 0);
  const errors7d = series.reduce((a, [, v]) => a + bucket(v), 0);
  const errors24h = series.slice(-24).reduce((a, [, v]) => a + bucket(v), 0);

  const issues = issuesR.status === "fulfilled" ? issuesR.value : [];
  const data: SentryHealth = {
    configured: true,
    errors24h,
    errors7d,
    unresolvedCount: issues.length,
    topIssues: issues.map((i) => ({
      id: i.id,
      title: i.title,
      culprit: i.culprit,
      count: num(i.count),
      users: num(i.userCount),
      level: i.level || "error",
      permalink: i.permalink,
      lastSeen: i.lastSeen,
    })),
  };

  cache = { at: Date.now(), data };
  return data;
}
