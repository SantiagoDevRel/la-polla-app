// app/(app)/perfil/page.tsx — Perfil del usuario "estadio de noche"
// Avatar, nombre editable, stats, actividad reciente, puntuación, logout
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { motion } from "framer-motion";
import { staggerContainer, fadeUp } from "@/lib/animations";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import UserAvatar from "@/components/ui/UserAvatar";
import FootballLoader from "@/components/ui/FootballLoader";
import { POLLITO_TYPES, getPollitoBase } from "@/lib/pollitos";

interface UserProfile {
  display_name: string;
  whatsapp_number: string;
  avatar_url: string | null;
  is_admin?: boolean;
}

interface UserStats {
  pollasCount: number;
  predictionsCount: number;
  bestRank: number | null;
}

interface ActivityItem {
  matchName: string;
  pollaName: string;
  pointsEarned: number;
}

export default function PerfilPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [stats, setStats] = useState<UserStats>({ pollasCount: 0, predictionsCount: 0, bestRank: null });
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [editName, setEditName] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data } = await axios.get("/api/users/me");

        if (data.profile) {
          // eslint-disable-next-line no-console
          console.log("[perfil] /api/users/me profile payload:", data.profile);
          setProfile(data.profile);
          setEditName(data.profile.display_name);
        }
        if (data.stats) setStats(data.stats);
        if (data.recentActivity) setActivity(data.recentActivity);
      } catch { /* silently fail */ } finally { setLoading(false); }
    }
    load();
  }, []);

  async function handleSaveName() {
    if (editName.trim().length < 2) { showToast("Mínimo 2 caracteres", "error"); return; }
    setSaving(true);
    try {
      await axios.patch("/api/users/me", { display_name: editName.trim() });
      setProfile((prev) => prev ? { ...prev, display_name: editName.trim() } : prev);
      setIsEditing(false);
      showToast("Nombre actualizado", "success");
    } catch { showToast("Error actualizando nombre", "error"); } finally { setSaving(false); }
  }

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  async function handleAvatarChange(pollitoId: string) {
    setSavingAvatar(true);
    try {
      await axios.patch("/api/users/me", { avatar_url: pollitoId });
      setProfile((prev) => prev ? { ...prev, avatar_url: pollitoId } : prev);
      setShowAvatarPicker(false);
      showToast("Pollito actualizado", "success");
    } catch { showToast("Error actualizando pollito", "error"); } finally { setSavingAvatar(false); }
  }

  function pointsColor(pts: number): string {
    if (pts >= 5) return "#00e676";
    if (pts >= 2) return "#FFD700";
    return "#4a5568";
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="flex flex-col items-center gap-2"><FootballLoader /><p className="text-text-muted">Cargando perfil...</p></div></div>;
  if (!profile) return <div className="min-h-screen flex items-center justify-center"><p className="text-text-muted">Error cargando perfil</p></div>;

  const SCORING_ROWS = [
    { label: "Resultado exacto", pts: "5 pts", color: "#FFD700" },
    { label: "Ganador + diferencia", pts: "3 pts", color: "#f0f4ff" },
    { label: "Ganador correcto", pts: "2 pts", color: "#f0f4ff" },
    { label: "Goles de un equipo", pts: "1 pt", color: "#f0f4ff" },
    { label: "Sin aciertos", pts: "0 pts", color: "#4a5568" },
  ];

  return (
    <div className="min-h-screen">
      <header className="px-4 pt-4 pb-6" style={{ background: "linear-gradient(180deg, #0a1628 0%, var(--bg-base) 100%)" }}>
        <div className="max-w-lg mx-auto">
          <h1 className="text-xl font-bold text-text-primary text-center">Mi Perfil</h1>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 space-y-6 -mt-1">
        {/* Avatar + name */}
        <div className="rounded-2xl p-6 flex flex-col items-center bg-bg-card/75 backdrop-blur-sm border border-border-subtle">
          <button
            type="button"
            onClick={() => setShowAvatarPicker(!showAvatarPicker)}
            className="relative mb-3 cursor-pointer group"
          >
            <UserAvatar
              avatarUrl={profile.avatar_url}
              displayName={profile.display_name}
              size="xl"
              className="ring-2 ring-gold/30 group-hover:ring-gold/60 transition-all"
            />
            <span className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-gold flex items-center justify-center shadow-lg">
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="#080c10" strokeWidth="2.5">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </span>
          </button>

          {showAvatarPicker && (
            <div className="w-full mb-4 rounded-xl p-3 bg-bg-elevated border border-border-subtle">
              <p className="text-xs text-text-secondary text-center mb-3">Elige tu pollito</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
                {POLLITO_TYPES.map((p) => {
                  const isSelected = profile.avatar_url === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={savingAvatar}
                      onClick={() => handleAvatarChange(p.id)}
                      className="cursor-pointer flex flex-col items-center gap-1 rounded-xl p-2 transition-all"
                      style={{
                        background: isSelected ? "rgba(255,215,0,0.08)" : "#131d2e",
                        border: isSelected ? "2px solid #FFD700" : "2px solid rgba(255,255,255,0.06)",
                        opacity: savingAvatar ? 0.5 : 1,
                      }}
                    >
                      <img src={getPollitoBase(p.id)} alt={p.label} style={{ width: 40, height: 40, objectFit: "contain" }} />
                      <span style={{ fontSize: 8, color: isSelected ? "#FFD700" : "#7a8499", fontWeight: isSelected ? 600 : 400, textAlign: "center", lineHeight: 1.2 }}>
                        {p.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {isEditing ? (
            <div className="flex items-center gap-2 w-full max-w-xs">
              <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus
                className="flex-1 px-3 py-2 rounded-lg text-center outline-none text-text-primary bg-bg-elevated border border-border-medium focus:border-gold" />
              <button onClick={handleSaveName} disabled={saving}
                className="bg-gold text-bg-base font-semibold px-4 py-2 rounded-lg text-sm">
                {saving ? "..." : "OK"}
              </button>
              <button onClick={() => { setIsEditing(false); setEditName(profile.display_name); }}
                className="text-text-muted text-sm">✕</button>
            </div>
          ) : (
            <button onClick={() => setIsEditing(true)} className="text-lg font-bold text-text-primary hover:text-gold transition-colors flex items-center gap-2">
              {profile.display_name}
              <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: 0.5 }}>
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          )}
          <p className="text-text-secondary text-sm mt-1 flex items-center gap-1">
            <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="#7a8499" strokeWidth="2">
              <rect x="5" y="2" width="14" height="20" rx="2" /><circle cx="12" cy="17" r="1" />
            </svg>
            {profile.whatsapp_number}
          </p>
        </div>

        {/* Stats — Bebas Neue numbers */}
        <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="grid grid-cols-3 gap-3">
          {[
            { value: String(stats.pollasCount), label: "Pollas" },
            { value: String(stats.predictionsCount), label: "Pronósticos" },
            { value: stats.bestRank ? `${stats.bestRank}°` : "—", label: "Mejor pos." },
          ].map((s) => (
            <motion.div key={s.label} variants={fadeUp} className="rounded-xl p-3 text-center bg-bg-card/75 backdrop-blur-sm border border-border-subtle">
              <p className="font-display text-gold" style={{ fontSize: 26, lineHeight: 1, letterSpacing: "0.05em" }}>{s.value}</p>
              <p className="text-[10px] text-text-muted mt-1">{s.label}</p>
            </motion.div>
          ))}
        </motion.div>

        {/* Actividad reciente */}
        {activity.length > 0 && (
          <div style={{
            background: "#0e1420",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 14,
            padding: 14,
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#f0f4ff", marginBottom: 10, display: "flex", alignItems: "center", gap: 5 }}>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#FFD700" strokeWidth="2">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
              Actividad reciente
            </div>
            {activity.map((item, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 0",
                  borderBottom: i < activity.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                }}
              >
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#f0f4ff" }}>{item.matchName}</div>
                  <div style={{ fontSize: 10, color: "#7a8499", marginTop: 1 }}>{item.pollaName}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="font-display" style={{ fontSize: 20, color: pointsColor(item.pointsEarned), letterSpacing: "0.05em" }}>
                    +{item.pointsEarned}
                  </div>
                  <div style={{ fontSize: 9, color: "#7a8499" }}>pts</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ¿Cómo se puntúa? */}
        <div style={{
          background: "#0e1420",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 14,
          padding: 14,
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#f0f4ff", marginBottom: 10, display: "flex", alignItems: "center", gap: 5 }}>
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#FFD700" strokeWidth="2">
              <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
            </svg>
            ¿Cómo se puntúa?
          </div>
          {SCORING_ROWS.map((row, i) => (
            <div
              key={row.label}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "7px 0",
                borderBottom: i < SCORING_ROWS.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
              }}
            >
              <span style={{ fontSize: 12, color: "#f0f4ff" }}>{row.label}</span>
              <span className="font-display" style={{ fontSize: 18, color: row.color, letterSpacing: "0.05em" }}>{row.pts}</span>
            </div>
          ))}
        </div>

        {/* Panel de administración — only for admin users */}
        {profile.is_admin && (
          <button
            type="button"
            onClick={() => router.push("/admin")}
            className="w-full py-3 rounded-xl font-medium transition-colors text-gold border border-gold/40 hover:bg-gold/10 flex items-center justify-center gap-2 cursor-pointer"
          >
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33h0a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51h0a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v0a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
            Panel de administración
          </button>
        )}

        {/* Logout */}
        <button onClick={handleLogout}
          className="w-full py-3 rounded-xl font-medium transition-colors text-red-alert border border-red-dim hover:bg-red-dim">
          Cerrar sesión
        </button>

        <div style={{ height: 16 }} />
      </main>
    </div>
  );
}
