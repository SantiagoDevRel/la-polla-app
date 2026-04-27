// app/(app)/admin/page.tsx — Panel de administración (client component).
// Server-side admin gate is enforced by app/(app)/admin/layout.tsx, which
// redirects non-admins to /dashboard. This page never renders for non-admins.
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { useToast } from "@/components/ui/Toast";
import FootballLoader from "@/components/ui/FootballLoader";

interface AdminUser {
  id: string;
  display_name: string;
  whatsapp_number: string;
  is_admin: boolean;
  created_at: string;
}

interface AdminPolla {
  id: string;
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
    verify: { count: number; cost: number };
    period: { start: string; end: string };
  };
  all_time?: {
    sms: { count: number; cost: number };
    verify: { count: number; cost: number };
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
  methods: { otp: number; password: number };
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
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryRes, twilioRes, analyticsRes] = await Promise.allSettled([
        axios.get<Summary>("/api/admin/summary"),
        axios.get<TwilioUsage>("/api/admin/twilio-usage"),
        axios.get<Analytics>("/api/admin/analytics"),
      ]);
      if (summaryRes.status === "fulfilled") setSummary(summaryRes.value.data);
      else showToast("No se pudo cargar el panel", "error");
      if (twilioRes.status === "fulfilled") setTwilio(twilioRes.value.data);
      if (analyticsRes.status === "fulfilled") setAnalytics(analyticsRes.value.data);
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
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-text-muted">Mes actual</p>
                      <p className="font-display mt-0.5" style={{ fontSize: 22, color: "#FFD700" }}>
                        {formatUSD(twilio.this_month.total_cost)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-text-muted">Verifies mes</p>
                      <p className="font-display mt-0.5" style={{ fontSize: 22, color: "#FFD700" }}>
                        {twilio.this_month.verify.count}
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
                      {twilio.all_time.verify.count + twilio.all_time.sms.count} mensajes ·{" "}
                      {formatUSD(
                        twilio.all_time.verify.cost + twilio.all_time.sms.cost,
                      )}
                    </p>
                  )}
                </>
              ) : null}
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

            {/* Geo + device breakdown */}
            {analytics && (analytics.top_cities.length > 0 || analytics.top_countries.length > 0 || analytics.top_devices.length > 0) && (
              <section
                className="rounded-2xl p-4 space-y-4"
                style={{ background: "#0e1420", border: "1px solid rgba(255,255,255,0.06)" }}
              >
                <h2 className="text-sm font-bold text-text-primary">Ubicación y dispositivos (30d)</h2>

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

                {/* Login method breakdown */}
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-text-muted mb-1.5">Método de login</p>
                  <div className="flex gap-3 text-xs">
                    <span className="text-text-secondary">SMS/OTP: <span className="text-gold font-bold">{analytics.methods.otp}</span></span>
                    <span className="text-text-secondary">Password: <span className="text-gold font-bold">{analytics.methods.password}</span></span>
                  </div>
                </div>
              </section>
            )}

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
              <div className="space-y-2">
                {summary?.users.map((u) => (
                  <div
                    key={u.id}
                    className="rounded-xl p-3 flex items-center gap-3"
                    style={{ background: "#131d2e", border: "1px solid rgba(255,255,255,0.04)" }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium text-text-primary truncate">
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
                    </div>
                    <button
                      onClick={() => handleDeleteUser(u)}
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
              <div className="space-y-2">
                {summary?.pollas.map((p) => (
                  <div
                    key={p.id}
                    className="rounded-xl p-3 flex items-center gap-3"
                    style={{ background: "#131d2e", border: "1px solid rgba(255,255,255,0.04)" }}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text-primary truncate">{p.name}</p>
                      <p className="text-xs text-text-muted truncate">
                        {p.tournament} · {p.status} · {formatDate(p.created_at)}
                      </p>
                    </div>
                    <button
                      onClick={() => handleDeletePolla(p)}
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
          </>
        )}
      </main>
    </div>
  );
}
