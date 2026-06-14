// lib/posthog/admin-insights.ts — Trae métricas de tráfico/comportamiento desde
// PostHog (Query API + HogQL) para el dashboard /admin. SERVER-ONLY: usa la
// Personal API key (secreto), nunca toca el cliente.
//
// PostHog ve lo que la DB NO: visitantes anónimos, páginas más usadas,
// dispositivo, performance real (web vitals). Complementa /api/admin/analytics
// (logins) y /api/admin/engagement (juego), que son DB-only.
//
// Free-tier safe: cache en memoria de 5 min — el admin no le pega a la Query
// API de PostHog en cada refresh (esa API tiene rate limit por personal key).
//
// SERVER-ONLY por construcción: solo lo importa app/api/admin/web-analytics/route.ts
// (route handler), y POSTHOG_PERSONAL_API_KEY no tiene prefijo NEXT_PUBLIC, así
// que jamás entra al bundle del cliente.

const POSTHOG_HOST =
  process.env.POSTHOG_API_HOST || "https://us.posthog.com";
const PROJECT_ID = process.env.POSTHOG_PROJECT_ID || "";
const PERSONAL_KEY = process.env.POSTHOG_PERSONAL_API_KEY || "";

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

const EMPTY: WebAnalytics = {
  configured: false,
  live30m: 0,
  traffic: { pageviews7d: 0, visitors7d: 0, sessions7d: 0, pageviewsPrev7d: 0, visitorsPrev7d: 0 },
  daily: [],
  topPages: [],
  devices: [],
  webVitals: { lcpP75: null, inpP75: null, clsP75: null },
};

// --- in-memory TTL cache (per server instance) ---
const TTL_MS = 5 * 60 * 1000;
let cache: { at: number; data: WebAnalytics } | null = null;

async function hogql(query: string): Promise<unknown[]> {
  const res = await fetch(
    `${POSTHOG_HOST}/api/projects/${PROJECT_ID}/query/`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PERSONAL_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
      // No cachear a nivel fetch — el cache lo maneja este módulo (TTL 5m).
      cache: "no-store",
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`posthog ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { results?: unknown[] };
  return json.results ?? [];
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function getWebAnalytics(): Promise<WebAnalytics> {
  if (!PROJECT_ID || !PERSONAL_KEY) {
    return { ...EMPTY, error: "missing_credentials" };
  }
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;

  // 1) Resumen 7d + 7d previos + live (30 min), en UNA query con agregación condicional.
  const qSummary = `
    SELECT
      countIf(timestamp > now() - INTERVAL 7 DAY) AS pv7,
      uniqIf(person_id, timestamp > now() - INTERVAL 7 DAY) AS vis7,
      uniqIf(properties.$session_id, timestamp > now() - INTERVAL 7 DAY) AS ses7,
      countIf(timestamp > now() - INTERVAL 14 DAY AND timestamp <= now() - INTERVAL 7 DAY) AS pvPrev,
      uniqIf(person_id, timestamp > now() - INTERVAL 14 DAY AND timestamp <= now() - INTERVAL 7 DAY) AS visPrev,
      uniqIf(person_id, timestamp > now() - INTERVAL 30 MINUTE) AS live30
    FROM events
    WHERE event = '$pageview' AND timestamp > now() - INTERVAL 14 DAY`;

  // 2) Serie diaria (14 días).
  const qDaily = `
    SELECT toDate(timestamp) AS day, count() AS pv, uniq(person_id) AS vis
    FROM events
    WHERE event = '$pageview' AND timestamp > now() - INTERVAL 14 DAY
    GROUP BY day ORDER BY day`;

  // 3) Top páginas (7d) — pathname, cae a current_url si falta.
  const qTopPages = `
    SELECT coalesce(nullIf(properties.$pathname, ''), properties.$current_url) AS path,
           count() AS views, uniq(person_id) AS vis
    FROM events
    WHERE event = '$pageview' AND timestamp > now() - INTERVAL 7 DAY
    GROUP BY path ORDER BY views DESC LIMIT 12`;

  // 4) Dispositivo (7d).
  const qDevices = `
    SELECT coalesce(nullIf(properties.$device_type, ''), 'desconocido') AS device, count() AS views
    FROM events
    WHERE event = '$pageview' AND timestamp > now() - INTERVAL 7 DAY
    GROUP BY device ORDER BY views DESC`;

  // 5) Web Vitals p75 (7d).
  const qVitals = `
    SELECT
      quantile(0.75)(toFloat(properties.$web_vitals_LCP_value)) AS lcp,
      quantile(0.75)(toFloat(properties.$web_vitals_INP_value)) AS inp,
      quantile(0.75)(toFloat(properties.$web_vitals_CLS_value)) AS cls
    FROM events
    WHERE event = '$web_vitals' AND timestamp > now() - INTERVAL 7 DAY`;

  const [summary, daily, topPages, devices, vitals] = await Promise.allSettled([
    hogql(qSummary),
    hogql(qDaily),
    hogql(qTopPages),
    hogql(qDevices),
    hogql(qVitals),
  ]);

  // Si la query base falla (key inválida, etc.), reportamos el error sin cachear.
  if (summary.status === "rejected") {
    return { ...EMPTY, configured: true, error: summary.reason?.message ?? "query_failed" };
  }

  const s = (summary.value[0] as unknown[]) || [];
  const data: WebAnalytics = {
    configured: true,
    live30m: num(s[5]),
    traffic: {
      pageviews7d: num(s[0]),
      visitors7d: num(s[1]),
      sessions7d: num(s[2]),
      pageviewsPrev7d: num(s[3]),
      visitorsPrev7d: num(s[4]),
    },
    daily:
      daily.status === "fulfilled"
        ? daily.value.map((r) => {
            const row = r as unknown[];
            return { day: String(row[0]), pageviews: num(row[1]), visitors: num(row[2]) };
          })
        : [],
    topPages:
      topPages.status === "fulfilled"
        ? topPages.value.map((r) => {
            const row = r as unknown[];
            return { path: String(row[0] ?? "/"), views: num(row[1]), visitors: num(row[2]) };
          })
        : [],
    devices:
      devices.status === "fulfilled"
        ? devices.value.map((r) => {
            const row = r as unknown[];
            return { device: String(row[0] ?? "desconocido"), views: num(row[1]) };
          })
        : [],
    webVitals:
      vitals.status === "fulfilled" && vitals.value[0]
        ? {
            lcpP75: numOrNull((vitals.value[0] as unknown[])[0]),
            inpP75: numOrNull((vitals.value[0] as unknown[])[1]),
            clsP75: numOrNull((vitals.value[0] as unknown[])[2]),
          }
        : EMPTY.webVitals,
  };

  cache = { at: Date.now(), data };
  return data;
}
