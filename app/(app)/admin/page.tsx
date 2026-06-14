// app/(app)/admin/page.tsx — Panel de administración (client component).
// Server-side admin gate is enforced by app/(app)/admin/layout.tsx, which
// redirects non-admins to /dashboard. This page never renders for non-admins.
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { useToast } from "@/components/ui/Toast";
import FootballLoader from "@/components/ui/FootballLoader";
import PayoutsByPolla from "@/components/admin/PayoutsByPolla";
import UserDetailModal from "@/components/admin/UserDetailModal";
import KnockoutStatusCard from "@/components/admin/KnockoutStatusCard";
import EngagementCard, { type EngagementData } from "@/components/admin/EngagementCard";
import WebAnalyticsCard, { type WebAnalytics } from "@/components/admin/WebAnalyticsCard";
import SentryHealthCard, { type SentryHealth } from "@/components/admin/SentryHealthCard";

interface AdminUser {
  id: string;
  display_name: string;
  whatsapp_number: string;
  is_admin: boolean;
  created_at: string;
}

interface AdminPolla {
  id: string;
  slug: string;
  name: string;
  tournament: string;
  status: string;
  created_at: string;
}

interface Summary {
  stats: { users: number; pollas: number; predictions: number; matches: number };
  users: AdminUser[];
  pollas: AdminPolla[];
}

interface TwilioUsage {
  configured: boolean;
  message?: string;
  error?: string;
  currency?: string;
  monthly_budget_usd?: number;
  pct_of_budget?: number;
  this_month?: {
    total_cost: number;
    sms: { count: number; cost: number };
    period: { start: string; end: string };
  };
  all_time?: {
    sms: { count: number; cost: number };
  };
}

interface Analytics {
  totals: {
    users: number;
    logins_7d: number;
    logins_30d: number;
    active_users_7d: number;
    active_users_30d: number;
    new_users_14d: number;
  };
  series: { day: string; logins: number; signups: number }[];
  top_cities: { key: string; count: number }[];
  top_countries: { key: string; count: number }[];
  top_devices: { key: string; count: number }[];
  methods: { otp: number };
  logins_by_hour: number[];
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CO", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatUSD(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default function AdminPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [twilio, setTwilio] = useState<TwilioUsage | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [engagement, setEngagement] = useState<EngagementData | null>(null);
  const [webAnalytics, setWebAnalytics] = useState<WebAnalytics | null>(null);
  const [sentryHealth, setSentryHealth] = useState<SentryHealth | null>(null);
  const [discrepancyCount, setDiscrepancyCount] = useState<number>(0);
  const [viewingUserId, setViewingUserId] = useState<string | null>(null);
  const [claudeUsage, setClaudeUsage] = useState<{
    mtdTotal: { calls: number; errors: number; tokensIn: number; tokensOut: number; costUSD: number };
    byUser: Array<{ userId: string | null; displayName: string; calls: number; cost: number }>;
    byEndpoint: Array<{ endpoint: string; calls: number; cost: number }>;
    suspicious: Array<{ userId: string; displayName: string; count24h: number }>;
    suspiciousThreshold: number;
    recent?: Array<{
      id: string;
      userId: string | null;
      displayName: string | null;
      endpoint: string;
      tokensIn: number;
      tokensOut: number;
      costUSD: number;
      success: boolean;
      errorMessage: string | null;
      createdAt: string;
      screenshotUrl: string | null;
      proofId: string | null;
    }>;
  } | null>(null);
  const [waTemplateUsage, setWaTemplateUsage] = useState<{
    mtd: { total_sends: number; total_sent: number; total_failed: number; cost_usd: number; period_start: string };
    by_template: Record<string, { sent: number; failed: number; cost_usd: number; category: string }>;
    last_send_at: string | null;
  } | null>(null);
  const [twilioByPhone, setTwilioByPhone] = useState<{
    configured: boolean;
    period?: { start: string; end: string };
    sample_size?: number;
    truncated?: boolean;
    totals?: { cost: number; count: number };
    byPhone?: Array<{
      phone: string;
      displayName: string | null;
      count: number;
      cost: number;
      lastSent: string;
    }>;
    error?: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryRes, twilioRes, twilioPhoneRes, analyticsRes, engagementRes, discRes, claudeRes, waTplRes, webAnalyticsRes, sentryRes] = await Promise.allSettled([
        axios.get<Summary>("/api/admin/summary"),
        axios.get<TwilioUsage>("/api/admin/twilio-usage"),
        axios.get("/api/admin/twilio-by-phone"),
        axios.get<Analytics>("/api/admin/analytics"),
        axios.get<EngagementData>("/api/admin/engagement"),
        axios.get<{ matches: unknown[] }>("/api/admin/discrepancies"),
        axios.get("/api/admin/claude-usage"),
        axios.get("/api/admin/wa-template-usage"),
        axios.get<WebAnalytics>("/api/admin/web-analytics"),
        axios.get<SentryHealth>("/api/admin/sentry-health"),
      ]);
      if (summaryRes.status === "fulfilled") setSummary(summaryRes.value.data);
      else showToast("No se pudo cargar el panel", "error");
      if (twilioRes.status === "fulfilled") {
        setTwilio(twilioRes.value.data);
      } else {
        // Si la request falla (500/network), mostramos error en lugar de
        // dejar el card en "Cargando…" para siempre.
        const reason = twilioRes.reason as { response?: { data?: { error?: string } }; message?: string };
        setTwilio({
          configured: true,
          error: reason?.response?.data?.error ?? reason?.message ?? "No se pudo cargar Twilio",
        });
      }
      if (twilioPhoneRes.status === "fulfilled") setTwilioByPhone(twilioPhoneRes.value.data);
      if (analyticsRes.status === "fulfilled") setAnalytics(analyticsRes.value.data);
      if (engagementRes.status === "fulfilled") setEngagement(engagementRes.value.data);
      if (discRes.status === "fulfilled") {
        setDiscrepancyCount(discRes.value.data.matches?.length ?? 0);
      }
      if (claudeRes.status === "fulfilled") setClaudeUsage(claudeRes.value.data);
      if (waTplRes.status === "fulfilled") setWaTemplateUsage(waTplRes.value.data);
      if (webAnalyticsRes.status === "fulfilled") setWebAnalytics(webAnalyticsRes.value.data);
      if (sentryRes.status === "fulfilled") setSentryHealth(sentryRes.value.data);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDeleteUser(u: AdminUser) {
    if (!window.confirm(`Eliminar a ${u.display_name}? Esta acción es irreversible.`)) return;
    setBusyId(u.id);
    try {
      await axios.delete(`/api/admin/users/${u.id}`);
      showToast("Usuario eliminado", "success");
      await load();
    } catch {
      showToast("Error eliminando usuario", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeleteProof(proofId: string) {
    if (!window.confirm("¿Borrar este screenshot? El user va a quedar como pendiente y podrá subir otro.")) return;
    setBusyId(proofId);
    try {
      await axios.delete(`/api/admin/payment-proofs/${proofId}`);
      showToast("Screenshot eliminado", "success");
      await load();
    } catch {
      showToast("Error eliminando screenshot", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeletePolla(p: AdminPolla) {
    if (
      !window.confirm(
        `Eliminar la polla "${p.name}"? Se borran también participantes y pronósticos.`
      )
    ) {
      return;
    }
    setBusyId(p.id);
    try {
      await axios.delete(`/api/admin/pollas/${p.id}`);
      showToast("Polla eliminada", "success");
      await load();
    } catch {
      showToast("Error eliminando polla", "error");
    } finally {
      setBusyId(null);
    }
  }

  const stats = summary?.stats;

  return (
    <div
      className="min-h-screen"
      style={{ background: "#080c10", fontFamily: "'Outfit', sans-serif" }}
    >
      <header
        className="px-4 pt-4 pb-4"
       
      >
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button
            onClick={() => router.push("/inicio")}
            className="text-text-secondary hover:text-gold transition-colors cursor-pointer"
            aria-label="Volver"
          >
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 5l-7 7 7 7" />
            </svg>
          </button>
          <h1 className="text-lg font-bold text-text-primary">Panel de administración</h1>
        </div>
      </header>

      <main className="max-w-lg mx-auto p-4 space-y-5">
        {loading ? (
          <div className="flex flex-col items-center gap-2 py-8"><FootballLoader /><p className="text-text-muted text-sm">Cargando…</p></div>
        ) : (
          <>
            {/* Discrepancias — siempre lo primero. Si hay 0 mostramos
                un banner sutil verde; si hay > 0 mostramos amber con
                CTA para resolverlas. Ranking máximo en la página. */}
            <section
              className="rounded-2xl p-4 flex items-center gap-3"
              style={
                discrepancyCount > 0
                  ? { background: "rgba(255,159,28,0.10)", border: "1px solid rgba(255,159,28,0.35)" }
                  : { background: "rgba(31,216,127,0.06)", border: "1px solid rgba(31,216,127,0.20)" }
              }
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-text-primary">
                  {discrepancyCount > 0
                    ? `${discrepancyCount} discrepancia${discrepancyCount > 1 ? "s" : ""} pendiente${discrepancyCount > 1 ? "s" : ""}`
                    : "Sin discrepancias"}
                </p>
                <p className="text-[11px] text-text-muted mt-0.5">
                  {discrepancyCount > 0
                    ? "El scoring está pausado en estos partidos. Resolvé para que se ejecute."
                    : "Todos los partidos con pronósticos están verificados."}
                </p>
              </div>
              {discrepancyCount > 0 ? (
                <button
                  onClick={() => router.push("/admin/discrepancias")}
                  className="text-sm font-semibold px-4 py-2 rounded-xl flex-shrink-0 hover:brightness-110 transition-all"
                  style={{ background: "#FF9F1C", color: "#080c10" }}
                >
                  Resolver
                </button>
              ) : (
                <button
                  onClick={() => router.push("/admin/discrepancias")}
                  className="text-[11px] font-semibold px-3 py-1.5 rounded-lg border flex-shrink-0 hover:border-text-secondary/40 transition-colors"
                  style={{ borderColor: "rgba(255,255,255,0.12)", color: "#AEB7C7" }}
                >
                  Ver
                </button>
              )}
            </section>

            {/* Knockouts del Mundial sin resolver + alertas de sync
                (migración 062). Solo renderiza si hay algo que mostrar. */}
            <KnockoutStatusCard />

            {/* Stats */}
            <section className="grid grid-cols-2 gap-3">
              {[
                { label: "Usuarios", value: stats?.users ?? 0 },
                { label: "Pollas", value: stats?.pollas ?? 0 },
                { label: "Pronósticos", value: stats?.predictions ?? 0 },
                { label: "Partidos en DB", value: stats?.matches ?? 0 },
              ].map((s) => (
                <div
                  key={s.label}
                  className="rounded-2xl p-4"
                  style={{ background: "#0e1420", border: "1px solid rgba(255,215,0,0.15)" }}
                >
                  <p className="text-[10px] uppercase tracking-wide text-text-muted">{s.label}</p>
                  <p className="font-display mt-1" style={{ fontSize: 30, color: "#FFD700", letterSpacing: "0.04em" }}>
                    {s.value}
                  </p>
                </div>
              ))}
            </section>

            {/* Twilio usage */}
            <section
              className="rounded-2xl p-4 space-y-3"
              style={{ background: "#0e1420", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-text-primary">Twilio · costo SMS</h2>
                {twilio?.configured && twilio.this_month && (
                  <span className="text-[10px] text-text-muted">
                    {twilio.this_month.period.start} → {twilio.this_month.period.end}
                  </span>
                )}
              </div>

              {!twilio ? (
                <p className="text-xs text-text-muted">Cargando…</p>
              ) : !twilio.configured ? (
                <p className="text-xs text-text-muted">{twilio.message ?? "Twilio no configurado"}</p>
              ) : twilio.error ? (
                <p className="text-xs text-red-alert">Error: {twilio.error}</p>
              ) : twilio.this_month ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-text-muted">Costo mes</p>
                      <p className="font-display mt-0.5" style={{ fontSize: 22, color: "#FFD700" }}>
                        {formatUSD(twilio.this_month.total_cost)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-text-muted">SMS mes</p>
                      <p className="font-display mt-0.5" style={{ fontSize: 22, color: "#FFD700" }}>
                        {twilio.this_month.sms.count}
                      </p>
                    </div>
                  </div>

                  {/* Budget bar */}
                  {twilio.monthly_budget_usd && twilio.monthly_budget_usd > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[10px] text-text-muted">
                        <span>Presupuesto mensual {formatUSD(twilio.monthly_budget_usd)}</span>
                        <span>{twilio.pct_of_budget ?? 0}%</span>
                      </div>
                      <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                        <div
                          className="h-full transition-all"
                          style={{
                            width: `${Math.min(100, twilio.pct_of_budget ?? 0)}%`,
                            background:
                              (twilio.pct_of_budget ?? 0) >= 80
                                ? "#ff3d57"
                                : (twilio.pct_of_budget ?? 0) >= 50
                                  ? "#FFA500"
                                  : "#22c55e",
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {twilio.all_time && (
                    <p className="text-[11px] text-text-muted">
                      All-time:{" "}
                      {twilio.all_time.sms.count} SMS ·{" "}
                      {formatUSD(twilio.all_time.sms.cost)}
                    </p>
                  )}
                </>
              ) : null}
            </section>

            {/* Twilio · top numeros (SMS por destino, ultimos 30d) */}
            <section
              className="rounded-2xl p-4 space-y-3"
              style={{ background: "#0e1420", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-text-primary">Twilio · top números (30d)</h2>
                {twilioByPhone?.totals ? (
                  <span className="text-[10px] text-text-muted tabular-nums" style={{ fontFeatureSettings: '"tnum"' }}>
                    {twilioByPhone.totals.count} SMS · {formatUSD(twilioByPhone.totals.cost)}
                  </span>
                ) : null}
              </div>
              {!twilioByPhone ? (
                <p className="text-xs text-text-muted">Cargando…</p>
              ) : !twilioByPhone.configured ? (
                <p className="text-xs text-text-muted">Twilio no configurado.</p>
              ) : twilioByPhone.error ? (
                <p className="text-xs text-red-alert">Error: {twilioByPhone.error}</p>
              ) : !twilioByPhone.byPhone || twilioByPhone.byPhone.length === 0 ? (
                <p className="text-xs text-text-muted">Sin SMS en los últimos 30 días.</p>
              ) : (
                <>
                  {twilioByPhone.truncated ? (
                    <p className="text-[10px] text-amber">
                      Mostrando primeros 1000 mensajes. Hay más sin contar.
                    </p>
                  ) : null}
                  <div className="space-y-1.5 max-h-[320px] overflow-y-auto pr-1">
                    {twilioByPhone.byPhone.map((row) => (
                      <div
                        key={row.phone}
                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
                        style={{ background: "#131d2e" }}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] text-text-primary truncate">
                            {row.displayName ?? "(sin nombre)"}
                          </p>
                          <p className="text-[10px] text-text-muted tabular-nums truncate" style={{ fontFeatureSettings: '"tnum"' }}>
                            {row.phone}
                          </p>
                        </div>
                        <div className="flex flex-col items-end flex-shrink-0">
                          <span className="text-[12px] text-gold tabular-nums" style={{ fontFeatureSettings: '"tnum"' }}>
                            {formatUSD(row.cost)}
                          </span>
                          <span className="text-[10px] text-text-muted tabular-nums" style={{ fontFeatureSettings: '"tnum"' }}>
                            {row.count} SMS
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>

            {/* WhatsApp templates · MTD spend */}
            <section
              className="rounded-2xl p-4 space-y-3"
              style={{ background: "#0e1420", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-text-primary">WhatsApp templates · MTD</h2>
                <span className="text-[10px] text-text-muted">Reminders, alertas, etc.</span>
              </div>

              {!waTemplateUsage ? (
                <p className="text-xs text-text-muted">Cargando…</p>
              ) : waTemplateUsage.mtd.total_sends === 0 ? (
                <p className="text-xs text-text-muted">Sin envíos este mes.</p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-text-muted">Costo MTD</p>
                      <p className="font-display mt-0.5 tabular-nums" style={{ fontSize: 22, color: "#FFD700", fontFeatureSettings: '"tnum"' }}>
                        ${waTemplateUsage.mtd.cost_usd.toFixed(4)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-text-muted">Enviados</p>
                      <p className="font-display mt-0.5 tabular-nums" style={{ fontSize: 22, color: "#FFD700", fontFeatureSettings: '"tnum"' }}>
                        {waTemplateUsage.mtd.total_sent}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-text-muted">Fallidos</p>
                      <p
                        className="font-display mt-0.5 tabular-nums"
                        style={{
                          fontSize: 22,
                          color: waTemplateUsage.mtd.total_failed > 0 ? "#FF3D57" : "#FFD700",
                          fontFeatureSettings: '"tnum"',
                        }}
                      >
                        {waTemplateUsage.mtd.total_failed}
                      </p>
                    </div>
                  </div>

                  {Object.keys(waTemplateUsage.by_template).length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[10px] uppercase tracking-wide text-text-muted">Por template</p>
                      {Object.entries(waTemplateUsage.by_template).map(([name, stats]) => (
                        <div key={name} className="flex items-center justify-between text-xs">
                          <span className="text-text-primary truncate">{name}</span>
                          <span className="text-text-muted shrink-0 ml-2">
                            {stats.sent} enviados · ${stats.cost_usd.toFixed(4)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {waTemplateUsage.last_send_at && (
                    <p className="text-[11px] text-text-muted">
                      Último envío: {new Date(waTemplateUsage.last_send_at).toLocaleString("es-CO")}
                    </p>
                  )}
                </>
              )}
            </section>

            {/* Activity overview */}
            <section
              className="rounded-2xl p-4 space-y-3"
              style={{ background: "#0e1420", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              <h2 className="text-sm font-bold text-text-primary">Actividad de usuarios</h2>
              {!analytics ? (
                <p className="text-xs text-text-muted">Cargando…</p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "Activos 7d", value: analytics.totals.active_users_7d },
                      { label: "Activos 30d", value: analytics.totals.active_users_30d },
                      { label: "Nuevos 14d", value: analytics.totals.new_users_14d },
                    ].map((s) => (
                      <div key={s.label}>
                        <p className="text-[10px] uppercase tracking-wide text-text-muted">{s.label}</p>
                        <p className="font-display mt-0.5" style={{ fontSize: 22, color: "#FFD700" }}>
                          {s.value}
                        </p>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: "Logins 7d", value: analytics.totals.logins_7d },
                      { label: "Logins 30d", value: analytics.totals.logins_30d },
                    ].map((s) => (
                      <div key={s.label}>
                        <p className="text-[10px] uppercase tracking-wide text-text-muted">{s.label}</p>
                        <p className="font-display mt-0.5" style={{ fontSize: 18, color: "#FFD700" }}>
                          {s.value}
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* 14-day signups + logins bar chart */}
                  <div className="pt-2">
                    <p className="text-[10px] uppercase tracking-wide text-text-muted mb-2">
                      Últimos 14 días — logins (gold) · signups (verde)
                    </p>
                    <div className="flex items-end gap-1 h-20">
                      {analytics.series.map((d) => {
                        const max = Math.max(
                          1,
                          ...analytics.series.map((x) => Math.max(x.logins, x.signups)),
                        );
                        const lh = (d.logins / max) * 100;
                        const sh = (d.signups / max) * 100;
                        return (
                          <div
                            key={d.day}
                            className="flex-1 flex flex-col-reverse items-center gap-0.5"
                            title={`${d.day} · ${d.logins} logins · ${d.signups} signups`}
                          >
                            <div
                              className="w-full rounded-t-sm"
                              style={{ height: `${Math.max(2, lh)}%`, background: "#FFD700" }}
                            />
                            {d.signups > 0 && (
                              <div
                                className="w-full rounded-t-sm"
                                style={{ height: `${Math.max(2, sh)}%`, background: "#22c55e" }}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </section>

            {/* Engagement (juego real) — complementa Actividad (que mide logins) */}
            <EngagementCard data={engagement} />

            {/* Tráfico & comportamiento (PostHog) — lo que la DB no ve:
                visitantes anónimos, embudo, fuentes, heatmap, top páginas, web vitals */}
            <WebAnalyticsCard data={webAnalytics} />

            {/* Salud de la app (Sentry) — ¿hay algo roto en prod? */}
            <SentryHealthCard data={sentryHealth} />

            {/* Geo + device breakdown */}
            {analytics && (analytics.top_cities.length > 0 || analytics.top_countries.length > 0 || analytics.top_devices.length > 0) && (
              <section
                className="rounded-2xl p-4 space-y-4"
                style={{ background: "#0e1420", border: "1px solid rgba(255,255,255,0.06)" }}
              >
                <h2 className="text-sm font-bold text-text-primary">Ubicación y dispositivos (30d, usuarios únicos)</h2>

                <div className="grid grid-cols-1 gap-4">
                  {[
                    { title: "Ciudades", rows: analytics.top_cities },
                    { title: "Países", rows: analytics.top_countries },
                    { title: "Dispositivos", rows: analytics.top_devices },
                  ].map((block) => block.rows.length > 0 && (
                    <div key={block.title}>
                      <p className="text-[10px] uppercase tracking-wide text-text-muted mb-1.5">{block.title}</p>
                      <div className="space-y-1">
                        {block.rows.slice(0, 5).map((r) => {
                          const max = Math.max(...block.rows.map((x) => x.count));
                          const pct = (r.count / max) * 100;
                          return (
                            <div key={r.key} className="flex items-center gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-text-primary truncate">{r.key}</span>
                                  <span className="text-text-muted ml-2">{r.count}</span>
                                </div>
                                <div className="h-1 rounded-full overflow-hidden mt-1" style={{ background: "rgba(255,255,255,0.06)" }}>
                                  <div className="h-full" style={{ width: `${pct}%`, background: "#FFD700" }} />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Login method breakdown — solo SMS/OTP (no usamos password) */}
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-text-muted mb-1.5">Método de login (usuarios únicos)</p>
                  <div className="flex gap-3 text-xs">
                    <span className="text-text-secondary">SMS/OTP: <span className="text-gold font-bold">{analytics.methods.otp}</span></span>
                  </div>
                </div>
              </section>
            )}

            {/* Comprobantes de pago — review queue admin_collects */}
            <section
              className="rounded-2xl p-4"
              style={{ background: "#0e1420", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-text-primary">Comprobantes de pago</p>
                  <p className="text-xs text-text-muted mt-0.5">
                    Screenshots subidos por participantes en pollas con &apos;pago al principio&apos;. Revisá lo que la AI auto-aprobó o lo que dejó pendiente.
                  </p>
                </div>
                <button
                  onClick={() => router.push("/admin/payment-proofs")}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold hover:brightness-110 transition-all cursor-pointer flex-shrink-0"
                  style={{ background: "#FFD700", color: "#080c10" }}
                >
                  Revisar
                </button>
              </div>
            </section>

            {/* Claude API · uso del mes */}
            {claudeUsage ? (
              <section
                className="rounded-2xl p-4 space-y-3"
                style={{ background: "#0e1420", border: "1px solid rgba(255,255,255,0.06)" }}
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold text-text-primary">Claude API · uso del mes</h2>
                  <span className="text-[10px] text-text-muted">Haiku Vision + futuras</span>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-text-muted">Costo MTD</p>
                    <p className="font-display mt-0.5 tabular-nums" style={{ fontSize: 22, color: "#FFD700", fontFeatureSettings: '"tnum"' }}>
                      ${claudeUsage.mtdTotal.costUSD.toFixed(4)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-text-muted">Calls</p>
                    <p className="font-display mt-0.5 tabular-nums" style={{ fontSize: 22, color: "#FFD700", fontFeatureSettings: '"tnum"' }}>
                      {claudeUsage.mtdTotal.calls}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-text-muted">Errores</p>
                    <p
                      className="font-display mt-0.5 tabular-nums"
                      style={{
                        fontSize: 22,
                        color: claudeUsage.mtdTotal.errors > 0 ? "#FF3D57" : "#FFD700",
                        fontFeatureSettings: '"tnum"',
                      }}
                    >
                      {claudeUsage.mtdTotal.errors}
                    </p>
                  </div>
                </div>

                {claudeUsage.suspicious.length > 0 ? (
                  <div className="rounded-xl p-3 bg-amber/10 border border-amber/30 space-y-1">
                    <p className="text-[11px] font-bold text-amber">
                      Users sospechosos (&gt; {claudeUsage.suspiciousThreshold} uploads en 24h)
                    </p>
                    {claudeUsage.suspicious.map((s) => (
                      <p key={s.userId} className="text-[11px] text-text-primary">
                        {s.displayName} —{" "}
                        <span className="tabular-nums" style={{ fontFeatureSettings: '"tnum"' }}>
                          {s.count24h}
                        </span>{" "}
                        uploads
                      </p>
                    ))}
                  </div>
                ) : null}

                {claudeUsage.byUser.length > 0 ? (
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-wide text-text-muted">Top users (mes)</p>
                    <div className="space-y-1 max-h-[240px] overflow-y-auto pr-1">
                      {claudeUsage.byUser.map((u) => (
                        <div
                          key={u.userId ?? "anon"}
                          className="flex items-center justify-between text-[11px] py-1 border-b border-border-subtle/40 last:border-0"
                        >
                          <span className="text-text-primary truncate flex-1 mr-2">{u.displayName}</span>
                          <span
                            className="text-text-muted tabular-nums"
                            style={{ fontFeatureSettings: '"tnum"' }}
                          >
                            {u.calls} calls · ${u.cost.toFixed(4)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] text-text-muted">Sin uso este mes todavía.</p>
                )}

                {/* Lista scrolleable de calls recientes con thumbnail
                    del screenshot cuando aplica (payment-proof endpoints).
                    Hasta 50 calls, max-height 480 con overflow. */}
                {claudeUsage.recent && claudeUsage.recent.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] uppercase tracking-wide text-text-muted">
                      Calls recientes ({claudeUsage.recent.length})
                    </p>
                    <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                      {claudeUsage.recent.map((call) => (
                        <div
                          key={call.id}
                          className="rounded-lg p-2 flex gap-2"
                          style={{ background: "#131d2e", border: "1px solid rgba(255,255,255,0.04)" }}
                        >
                          {call.screenshotUrl ? (
                            <a
                              href={call.screenshotUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="shrink-0 w-14 h-14 rounded overflow-hidden bg-black"
                              title="Ver screenshot completo"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={call.screenshotUrl}
                                alt="proof"
                                className="w-full h-full object-cover"
                              />
                            </a>
                          ) : (
                            <div
                              className="shrink-0 w-14 h-14 rounded flex items-center justify-center text-[10px] text-text-muted"
                              style={{ background: "rgba(255,255,255,0.03)" }}
                            >
                              —
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-[11px] text-text-primary truncate">
                                {call.displayName ?? "(sin user)"}
                              </span>
                              <div className="flex items-center gap-2 shrink-0">
                                <span
                                  className={`text-[10px] tabular-nums ${
                                    call.success ? "text-text-muted" : "text-red-alert"
                                  }`}
                                  style={{ fontFeatureSettings: '"tnum"' }}
                                >
                                  ${call.costUSD.toFixed(4)}
                                </span>
                                {call.proofId && (
                                  <button
                                    onClick={() => handleDeleteProof(call.proofId!)}
                                    disabled={busyId === call.proofId}
                                    className="text-[12px] leading-none px-1.5 py-0.5 rounded cursor-pointer transition-all disabled:opacity-40 hover:bg-red-alert/10"
                                    style={{ color: "#ff3d57" }}
                                    title="Borrar screenshot"
                                  >
                                    ✕
                                  </button>
                                )}
                              </div>
                            </div>
                            <p className="text-[10px] text-text-muted truncate">
                              {call.endpoint} · {call.tokensIn}↓/{call.tokensOut}↑ tokens
                            </p>
                            <p className="text-[10px] text-text-muted">
                              {new Date(call.createdAt).toLocaleString("es-CO", {
                                month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                              })}
                            </p>
                            {call.errorMessage && (
                              <p className="text-[10px] text-red-alert truncate mt-0.5">
                                {call.errorMessage}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            ) : null}

            {/* Sincronización */}
            <section
              className="rounded-2xl p-4"
              style={{ background: "#0e1420", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-text-primary">Sincronización de partidos</p>
                  <p className="text-xs text-text-muted mt-0.5">Traer fixtures de football-data y openfootball.</p>
                </div>
                <button
                  onClick={() => router.push("/admin/matches")}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold hover:brightness-110 transition-all cursor-pointer"
                  style={{ background: "#FFD700", color: "#080c10" }}
                >
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 4 23 10 17 10" />
                    <polyline points="1 20 1 14 7 14" />
                    <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                  </svg>
                  Sincronizar partidos
                </button>
              </div>
            </section>

            {/* Usuarios */}
            <section
              className="rounded-2xl p-4"
              style={{ background: "#0e1420", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-text-primary">Usuarios</h2>
                <span className="text-xs text-text-muted">{summary?.users.length ?? 0}</span>
              </div>
              {/* Scroll interno para no inflar la página global. ~480px
                  cabe ~7-8 user rows, después scroll dentro del card. */}
              <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                {summary?.users.map((u) => (
                  <div
                    key={u.id}
                    className="rounded-xl p-3 flex items-center gap-3"
                    style={{ background: "#131d2e", border: "1px solid rgba(255,255,255,0.04)" }}
                  >
                    <button
                      type="button"
                      onClick={() => setViewingUserId(u.id)}
                      className="flex-1 min-w-0 text-left hover:opacity-80 transition-opacity"
                    >
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium text-text-primary truncate underline decoration-transparent hover:decoration-text-primary/40">
                          {u.display_name || "Sin nombre"}
                        </p>
                        {u.is_admin && (
                          <span
                            className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                            style={{ background: "rgba(255,215,0,0.15)", color: "#FFD700" }}
                          >
                            ADMIN
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-text-muted truncate">
                        {u.whatsapp_number} · {formatDate(u.created_at)}
                      </p>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteUser(u);
                      }}
                      disabled={busyId === u.id}
                      className="text-xs px-3 py-1.5 rounded-lg border cursor-pointer transition-all disabled:opacity-40"
                      style={{ borderColor: "rgba(255,61,87,0.4)", color: "#ff3d57" }}
                    >
                      Eliminar
                    </button>
                  </div>
                ))}
                {summary?.users.length === 0 && (
                  <p className="text-xs text-text-muted text-center py-4">Sin usuarios.</p>
                )}
              </div>
            </section>

            {/* Pollas */}
            <section
              className="rounded-2xl p-4"
              style={{ background: "#0e1420", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-text-primary">Pollas</h2>
                <span className="text-xs text-text-muted">{summary?.pollas.length ?? 0}</span>
              </div>
              {/* Scroll interno para no inflar la página global. */}
              <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                {summary?.pollas.map((p) => (
                  <div
                    key={p.id}
                    className="rounded-xl p-3 flex items-center gap-3"
                    style={{ background: "#131d2e", border: "1px solid rgba(255,255,255,0.04)" }}
                  >
                    <button
                      type="button"
                      onClick={() => router.push(`/pollas/${p.slug}`)}
                      className="flex-1 min-w-0 text-left hover:opacity-80 transition-opacity"
                    >
                      <p className="text-sm font-medium text-text-primary truncate underline decoration-transparent hover:decoration-text-primary/40">
                        {p.name}
                      </p>
                      <p className="text-xs text-text-muted truncate">
                        {p.tournament} · {p.status} · {formatDate(p.created_at)}
                      </p>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeletePolla(p);
                      }}
                      disabled={busyId === p.id}
                      className="text-xs px-3 py-1.5 rounded-lg border cursor-pointer transition-all disabled:opacity-40"
                      style={{ borderColor: "rgba(255,61,87,0.4)", color: "#ff3d57" }}
                    >
                      Eliminar
                    </button>
                  </div>
                ))}
                {summary?.pollas.length === 0 && (
                  <p className="text-xs text-text-muted text-center py-4">Sin pollas.</p>
                )}
              </div>
            </section>

            {/* Pagos por polla — accordion colapsable, scroll interno
                por bloque para no inflar la pagina global. */}
            <PayoutsByPolla />
          </>
        )}
      </main>

      {viewingUserId ? (
        <UserDetailModal
          userId={viewingUserId}
          onClose={() => setViewingUserId(null)}
        />
      ) : null}
    </div>
  );
}
