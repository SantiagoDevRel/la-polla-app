// app/(app)/perfil/page.tsx — Perfil del usuario "estadio de noche"
// Avatar, nombre editable, stats, actividad reciente, puntuación, logout
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import UserAvatar from "@/components/ui/UserAvatar";
import FootballLoader from "@/components/ui/FootballLoader";
import { POLLITO_TYPES, getPollitoBase } from "@/lib/pollitos";
import { InlineScoringGuide } from "@/components/polla/InlineScoringGuide";
import FontScalePicker from "@/components/perfil/FontScalePicker";
import LanguageToggle from "@/components/perfil/LanguageToggle";
import PayoutDefaultEditor, { type PayoutMethod, type PayoutAccountType } from "@/components/perfil/PayoutDefaultEditor";

interface UserProfile {
  display_name: string;
  whatsapp_number: string;
  avatar_url: string | null;
  is_admin?: boolean;
  default_payout_method: PayoutMethod | null;
  default_payout_account: string | null;
  default_payout_account_name: string | null;
  default_payout_account_type: PayoutAccountType | null;
}

interface ActivityItem {
  matchName: string;
  pollaName: string;
  pointsEarned: number;
}

export default function PerfilPage() {
  const t = useTranslations("Perfil");
  const router = useRouter();
  const { showToast } = useToast();

  const [profile, setProfile] = useState<UserProfile | null>(null);
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
        if (data.recentActivity) setActivity(data.recentActivity);
      } catch { /* silently fail */ } finally { setLoading(false); }
    }
    load();
  }, []);

  async function handleSaveName() {
    if (editName.trim().length < 2) { showToast(t("errMinChars"), "error"); return; }
    setSaving(true);
    try {
      await axios.patch("/api/users/me", { display_name: editName.trim() });
      setProfile((prev) => prev ? { ...prev, display_name: editName.trim() } : prev);
      setIsEditing(false);
      showToast(t("toastNameUpdated"), "success");
    } catch { showToast(t("errUpdateName"), "error"); } finally { setSaving(false); }
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
      showToast(t("toastChickenUpdated"), "success");
    } catch { showToast(t("errUpdateChicken"), "error"); } finally { setSavingAvatar(false); }
  }

  async function handlePayoutSave(
    method: PayoutMethod,
    account: string,
    accountName: string | null,
    accountType: PayoutAccountType | null,
  ) {
    try {
      await axios.patch("/api/users/me", {
        default_payout_method: method,
        default_payout_account: account,
        default_payout_account_name: accountName,
        default_payout_account_type: accountType,
      });
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              default_payout_method: method,
              default_payout_account: account,
              default_payout_account_name: accountName,
              default_payout_account_type: accountType,
            }
          : prev,
      );
      showToast(t("toastPayoutSaved"), "success");
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      showToast(e.response?.data?.error || t("errSavePayout"), "error");
    }
  }

  async function handlePayoutClear() {
    try {
      await axios.patch("/api/users/me", {
        default_payout_method: null,
        default_payout_account: null,
        default_payout_account_name: null,
        default_payout_account_type: null,
      });
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              default_payout_method: null,
              default_payout_account: null,
              default_payout_account_name: null,
              default_payout_account_type: null,
            }
          : prev,
      );
      showToast(t("toastPayoutCleared"), "success");
    } catch {
      showToast(t("errClearPayout"), "error");
    }
  }

  function pointsColorClass(pts: number): string {
    if (pts >= 5) return "text-turf";
    if (pts >= 2) return "text-gold";
    return "text-text-muted";
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="flex flex-col items-center gap-2"><FootballLoader /><p className="text-text-muted">{t("loading")}</p></div></div>;
  if (!profile) return <div className="min-h-screen flex items-center justify-center"><p className="text-text-muted">{t("errLoading")}</p></div>;

  return (
    <div className="min-h-screen">
      <header className="px-4 pt-4 pb-6">
        <div className="max-w-lg mx-auto">
          <h1 className="lp-section-title text-center text-[22px]">{t("header")}</h1>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 space-y-6 -mt-1">
        {/* Avatar + name */}
        <div className="flex flex-col items-center">
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
              <p className="text-xs text-text-secondary text-center mb-3">{t("pickChicken")}</p>
              <div className="grid grid-cols-4 gap-1.5 justify-items-center">
                {POLLITO_TYPES.map((p) => {
                  const isSelected = profile.avatar_url === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={savingAvatar}
                      onClick={() => handleAvatarChange(p.id)}
                      className={`w-full min-h-[60px] cursor-pointer flex flex-col items-center gap-1 rounded-lg p-2 border-2 transition-all ${
                        isSelected
                          ? "bg-gold/10 border-gold"
                          : "bg-bg-elevated border-white/5"
                      } ${savingAvatar ? "opacity-50" : ""}`}
                    >
                      <img src={getPollitoBase(p.id)} alt={p.label} width={40} height={40} className="object-contain" />
                      <span className={`text-[8px] text-center leading-tight ${isSelected ? "text-gold font-semibold" : "text-text-primary"}`}>
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
            <button
              onClick={() => setIsEditing(true)}
              className="flex items-center gap-2 px-3 py-1 rounded-md hover:bg-bg-elevated/50 transition-colors text-text-primary"
            >
              <span className="text-lg font-bold">{profile.display_name}</span>
              <span className="text-[10px] uppercase tracking-wider text-text-muted font-medium">{t("edit")}</span>
            </button>
          )}
          <p className="text-text-secondary text-sm mt-1 flex items-center gap-1">
            <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="5" y="2" width="14" height="20" rx="2" /><circle cx="12" cy="17" r="1" />
            </svg>
            {profile.whatsapp_number}
          </p>
        </div>

        {/* Cuenta de pago — debajo del pollito + nombre. Edit / clear /
            cambiar de banco. Pre-llena el WinnerPayoutModal cuando ganan
            una polla, así no tienen que re-tipear cada vez. */}
        <PayoutDefaultEditor
          initialMethod={profile.default_payout_method ?? undefined}
          initialAccount={profile.default_payout_account ?? undefined}
          initialAccountName={profile.default_payout_account_name ?? undefined}
          initialAccountType={profile.default_payout_account_type ?? undefined}
          onSave={handlePayoutSave}
          onClear={handlePayoutClear}
        />

        {/* Idioma — ES / EN. Setea cookie y, en prod, salta al dominio
            correspondiente (lapollacolombiana.com vs chickenpicks.app). */}
        <LanguageToggle />

        {/* Tamaño del texto — preferencia local por dispositivo. */}
        <FontScalePicker />

        {/* Actividad reciente */}
        {activity.length > 0 && (
          <div className="lp-card p-3.5">
            <div className="text-[13px] font-bold text-text-primary mb-2.5 flex items-center gap-1.5">
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gold">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
              {t("recentActivity")}
            </div>
            {activity.map((item, i) => (
              <div
                key={i}
                className={`flex items-center justify-between py-2 ${
                  i < activity.length - 1 ? "border-b border-white/5" : ""
                }`}
              >
                <div>
                  <div className="text-xs font-semibold text-text-primary">{item.matchName}</div>
                  <div className="text-[10px] text-text-secondary mt-0.5">{item.pollaName}</div>
                </div>
                <div className="text-right">
                  <div className={`font-display text-[20px] ${pointsColorClass(item.pointsEarned)}`}>
                    +{item.pointsEarned}
                  </div>
                  <div className="text-[9px] text-text-muted">{t("pointsLabel")}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ¿Cómo se puntúa? — shared with the polla-detail Info tab */}
        <div className="lp-card p-3.5">
          <div className="text-[13px] font-bold text-text-primary mb-2.5 flex items-center gap-1.5">
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gold">
              <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
            </svg>
            {t("scoringTitle")}
          </div>
          <InlineScoringGuide />
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
            {t("adminPanel")}
          </button>
        )}

        {/* Logout */}
        <button onClick={handleLogout}
          className="w-full py-3 rounded-xl font-medium transition-colors text-red-alert border border-red-dim hover:bg-red-dim">
          {t("logout")}
        </button>

        <div className="h-4" />
      </main>
    </div>
  );
}
