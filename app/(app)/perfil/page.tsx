// app/(app)/perfil/page.tsx — Perfil del usuario "estadio de noche"
// Avatar con gradiente gold, nombre editable, stats, logout
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { motion } from "framer-motion";
import { staggerContainer, fadeUp } from "@/lib/animations";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import UserAvatar from "@/components/ui/UserAvatar";

interface UserProfile {
  display_name: string;
  whatsapp_number: string;
  avatar_url: string | null;
}

interface UserStats {
  pollasCount: number;
  predictionsCount: number;
  bestRank: number | null;
}

export default function PerfilPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [stats, setStats] = useState<UserStats>({ pollasCount: 0, predictionsCount: 0, bestRank: null });
  const [editName, setEditName] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        setUserId(user.id);

        // Fetch profile + stats via API (bypasses RLS issues on polla_participants)
        const { data } = await axios.get("/api/users/me");

        if (data.profile) {
          setProfile(data.profile);
          setEditName(data.profile.display_name);
        }

        if (data.stats) {
          setStats(data.stats);
        }
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

  if (loading) return <div className="min-h-screen flex items-center justify-center"><p className="text-text-muted">Cargando perfil...</p></div>;
  if (!profile) return <div className="min-h-screen flex items-center justify-center"><p className="text-text-muted">Error cargando perfil</p></div>;

  return (
    <div className="min-h-screen">
      <header className="px-4 pt-4 pb-6" style={{ background: "linear-gradient(180deg, #0a1628 0%, var(--bg-base) 100%)" }}>
        <div className="max-w-lg mx-auto">
          <h1 className="text-xl font-bold text-text-primary text-center">Mi Perfil</h1>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 space-y-6 -mt-1">
        {/* Avatar + name */}
        <div className="rounded-2xl p-6 flex flex-col items-center bg-bg-card border border-border-subtle">
          <UserAvatar
            userId={userId}
            avatarUrl={profile.avatar_url}
            displayName={profile.display_name}
            size="xl"
            className="mb-3 ring-2 ring-gold/30"
          />

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
            <button onClick={() => setIsEditing(true)} className="text-lg font-bold text-text-primary hover:text-gold transition-colors">
              {profile.display_name} ✏️
            </button>
          )}
          <p className="text-text-secondary text-sm mt-1">📱 {profile.whatsapp_number}</p>
        </div>

        {/* Stats */}
        <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="grid grid-cols-3 gap-3">
          {[
            { value: String(stats.pollasCount), label: "Pollas" },
            { value: String(stats.predictionsCount), label: "Pronósticos" },
            { value: stats.bestRank ? `#${stats.bestRank}` : "—", label: "Mejor pos" },
          ].map((s) => (
            <motion.div key={s.label} variants={fadeUp} className="rounded-xl p-4 text-center bg-bg-card border border-border-subtle">
              <p className="score-font text-[32px] text-gold">{s.value}</p>
              <p className="text-[11px] text-text-muted">{s.label}</p>
            </motion.div>
          ))}
        </motion.div>

        {/* Logout */}
        <button onClick={handleLogout}
          className="w-full py-3 rounded-xl font-medium transition-colors text-red-alert border border-red-dim hover:bg-red-dim">
          Cerrar sesión
        </button>
      </main>
    </div>
  );
}
