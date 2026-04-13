// app/(app)/admin/page.tsx — Panel de administración (client component).
// Server-side admin gate is enforced by app/(app)/admin/layout.tsx, which
// redirects non-admins to /dashboard. This page never renders for non-admins.
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { useToast } from "@/components/ui/Toast";

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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CO", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function AdminPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get<Summary>("/api/admin/summary");
      setSummary(data);
    } catch {
      showToast("No se pudo cargar el panel", "error");
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
        style={{ background: "linear-gradient(180deg, #0a1628 0%, #080c10 100%)" }}
      >
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button
            onClick={() => router.push("/dashboard")}
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
          <p className="text-text-muted text-sm text-center py-8">Cargando…</p>
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
