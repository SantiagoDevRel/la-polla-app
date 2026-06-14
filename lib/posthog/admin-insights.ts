// lib/posthog/admin-insights.ts — Trae métricas de tráfico/comportamiento desde
// PostHog (Query API + HogQL) para el dashboard /admin. SERVER-ONLY: usa la
// Personal API key (secreto), nunca toca el cliente.
//
// PostHog ve lo que la DB NO: visitantes anónimos, embudo desde el anónimo,
// fuentes de tráfico, cuándo entra la gente, páginas más usadas, dispositivo,
// performance real (web vitals). Complementa /api/admin/analytics (logins) y
// /api/admin/engagement (juego), que son DB-only.
//
// COSTO / FREE-TIER (auditado por infra-cost-reviewer 2026-06-14):
// - Leer NO cuenta contra ingestion (1M ev/mes); la Query API throttlea (429)
//   pero NO cobra. Límite: 2.400 req/h a nivel ORG. 9 queries/refresh × pocos
//   admins = ~4% del budget. Cero impacto en Supabase.
// - Guardas: cache 12 min (un solo endpoint, cache compartido) + STALE-ON-ERROR
//   (ante fallo/429 servimos lo último bueno en vez de reintentar en loop) +
//   skip-if-no-key. Si algún día se agrega polling a /admin, revisar esto.
//
// SERVER-ONLY por construcción: solo lo importa app/api/admin/web-analytics/route.ts
// (route handler), y POSTHOG_PERSONAL_API_KEY no tiene prefijo NEXT_PUBLIC, así
// que jamás entra al bundle del cliente.

const POSTHOG_HOST = process.env.POSTHOG_API_HOST || "https://us.posthog.com";
const PROJECT_ID = process.env.POSTHOG_PROJECT_ID || "";
const PERSONAL_KEY = process.env.POSTHOG_PERSONAL_API_KEY || "";

// Colombia = UTC-5 fijo (sin horario de verano) → desplazamos para hora local.
const BOGOTA_OFFSET_HOURS = 5;

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
  heatmap: Array<{ dow: number; hour: number; count: number }>; // dow 1=Lun..7=Dom, hour 0-23 Bogotá
  webVitals: { lcpP75: number | null; inpP75: number | null; clsP75: number | null };
  stale?: boolean;
  error?: string;
}

const EMPTY: WebAnalytics = {
  configured: false,
  live30m: 0,
  traffic: { pageviews7d: 0, visitors7d: 0, sessions7d: 0, pageviewsPrev7d: 0, visitorsPrev7d: 0 },
  funnel: { visitantes: 0, vioPolla: 0, guardo: 0 },
  newReturning: { nuevos: 0, recurrentes: 0 },
  daily: [],
  topPages: [],
  sources: [],
  devices: [],
  heatmap: [],
  webVitals: { lcpP75: null, inpP75: null, clsP75: null },
};

// --- in-memory TTL cache (per server instance) ---
const TTL_MS = 12 * 60 * 1000;
let cache: { at: number; data: WebAnalytics } | null = null;

async function hogql(query: string): Promise<unknown[]> {
  const res = await fetch(`${POSTHOG_HOST}/api/projects/${PROJECT_ID}/query/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${PERSONAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`posthog ${res.status}: ${text.slice(0, 160)}`);
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

  const W7 = "INTERVAL 7 DAY";
  const W14 = "INTERVAL 14 DAY";

  // 1) Resumen 7d + 7d previos + live (30 min), una sola query condicional.
  const qSummary = `
    SELECT
      countIf(timestamp > now() - ${W7}) AS pv7,
      uniqIf(person_id, timestamp > now() - ${W7}) AS vis7,
      uniqIf(properties.$session_id, timestamp > now() - ${W7}) AS ses7,
      countIf(timestamp > now() - ${W14} AND timestamp <= now() - ${W7}) AS pvPrev,
      uniqIf(person_id, timestamp > now() - ${W14} AND timestamp <= now() - ${W7}) AS visPrev,
      uniqIf(person_id, timestamp > now() - INTERVAL 30 MINUTE) AS live30
    FROM events
    WHERE event = '$pageview' AND timestamp > now() - ${W14}`;

  // 2) Embudo (alcance por paso, 7d): visitante → vio polla → guardó pronóstico.
  const qFunnel = `
    SELECT
      uniqIf(person_id, event = '$pageview') AS visitantes,
      uniqIf(person_id, event = '$pageview' AND properties.$pathname LIKE '/pollas%') AS vioPolla,
      uniqIf(person_id, event = '$autocapture' AND properties.$el_text LIKE '%PRON%') AS guardo
    FROM events
    WHERE timestamp > now() - ${W7}`;

  // 3) Nuevos vs recurrentes (7d): por first-seen del person_id.
  const qNewReturning = `
    SELECT countIf(fs > now() - ${W7}) AS nuevos, countIf(fs <= now() - ${W7}) AS recurrentes
    FROM (SELECT person_id, min(timestamp) AS fs FROM events WHERE event = '$pageview' GROUP BY person_id)
    WHERE person_id IN (SELECT person_id FROM events WHERE event = '$pageview' AND timestamp > now() - ${W7})`;

  // 4) Serie diaria (14 días).
  const qDaily = `
    SELECT toDate(timestamp) AS day, count() AS pv, uniq(person_id) AS vis
    FROM events WHERE event = '$pageview' AND timestamp > now() - ${W14}
    GROUP BY day ORDER BY day`;

  // 5) Top páginas (7d).
  const qTopPages = `
    SELECT coalesce(nullIf(properties.$pathname, ''), properties.$current_url) AS path,
           count() AS views, uniq(person_id) AS vis
    FROM events WHERE event = '$pageview' AND timestamp > now() - ${W7}
    GROUP BY path ORDER BY views DESC LIMIT 12`;

  // 6) Fuentes de tráfico (7d) — dominio de referencia.
  const qSources = `
    SELECT coalesce(nullIf(properties.$referring_domain, ''), '$direct') AS source,
           uniq(person_id) AS vis, count() AS views
    FROM events WHERE event = '$pageview' AND timestamp > now() - ${W7}
    GROUP BY source ORDER BY vis DESC LIMIT 10`;

  // 7) Dispositivo (7d).
  const qDevices = `
    SELECT coalesce(nullIf(properties.$device_type, ''), 'desconocido') AS device, count() AS views
    FROM events WHERE event = '$pageview' AND timestamp > now() - ${W7}
    GROUP BY device ORDER BY views DESC`;

  // 8) Heatmap hora×día (14d) — hora local Bogotá (UTC-5, sin DST).
  const qHeatmap = `
    SELECT toDayOfWeek(timestamp - INTERVAL ${BOGOTA_OFFSET_HOURS} HOUR) AS dow,
           toHour(timestamp - INTERVAL ${BOGOTA_OFFSET_HOURS} HOUR) AS hr,
           count() AS c
    FROM events WHERE event = '$pageview' AND timestamp > now() - ${W14}
    GROUP BY dow, hr`;

  // 9) Web Vitals p75 (7d).
  const qVitals = `
    SELECT
      quantile(0.75)(toFloat(properties.$web_vitals_LCP_value)) AS lcp,
      quantile(0.75)(toFloat(properties.$web_vitals_INP_value)) AS inp,
      quantile(0.75)(toFloat(properties.$web_vitals_CLS_value)) AS cls
    FROM events WHERE event = '$web_vitals' AND timestamp > now() - ${W7}`;

  const [summary, funnel, newRet, daily, topPages, sources, devices, heatmap, vitals] =
    await Promise.allSettled([
      hogql(qSummary),
      hogql(qFunnel),
      hogql(qNewReturning),
      hogql(qDaily),
      hogql(qTopPages),
      hogql(qSources),
      hogql(qDevices),
      hogql(qHeatmap),
      hogql(qVitals),
    ]);

  // STALE-ON-ERROR: si la query base falla (429, key, red), NO reintentamos en
  // loop ni cacheamos vacío — servimos el último resultado bueno marcado stale.
  if (summary.status === "rejected") {
    if (cache) return { ...cache.data, stale: true };
    return { ...EMPTY, configured: true, error: summary.reason?.message ?? "query_failed" };
  }

  const s = (summary.value[0] as unknown[]) || [];
  const f = (funnel.status === "fulfilled" ? (funnel.value[0] as unknown[]) : []) || [];
  const nr = (newRet.status === "fulfilled" ? (newRet.value[0] as unknown[]) : []) || [];

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
    funnel: { visitantes: num(f[0]), vioPolla: num(f[1]), guardo: num(f[2]) },
    newReturning: { nuevos: num(nr[0]), recurrentes: num(nr[1]) },
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
    sources:
      sources.status === "fulfilled"
        ? sources.value.map((r) => {
            const row = r as unknown[];
            return { source: String(row[0] ?? "$direct"), visitors: num(row[1]), views: num(row[2]) };
          })
        : [],
    devices:
      devices.status === "fulfilled"
        ? devices.value.map((r) => {
            const row = r as unknown[];
            return { device: String(row[0] ?? "desconocido"), views: num(row[1]) };
          })
        : [],
    heatmap:
      heatmap.status === "fulfilled"
        ? heatmap.value.map((r) => {
            const row = r as unknown[];
            return { dow: num(row[0]), hour: num(row[1]), count: num(row[2]) };
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
