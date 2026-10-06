// app/(app)/perfil/page.tsx — Perfil del usuario "estadio de noche"
// Avatar, nombre editable, cuenta de cobro, invitaciones, ajustes, logout
"use client";

import Link from "next/link";
import { InvitacionesPerfil } from "@/components/casa/InvitacionesPerfil";
import { MisRifasPerfil } from "@/components/rifas/MisRifasPerfil";
import { MisCortesias } from "@/components/casa/MisCortesias";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { useTranslations } from "next-intl";
import { History, LogOut, UserRoundX, X } from "lucide-react";
import { useIsIOSApp } from "@/components/platform/PlatformProvider";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import UserAvatar from "@/components/ui/UserAvatar";
import FootballLoader from "@/components/ui/FootballLoader";
import { POLLITO_TYPES, getPollitoBase } from "@/lib/pollitos";
import FontScalePicker from "@/components/perfil/FontScalePicker";
import WhatsAppPreference from "@/components/perfil/WhatsAppPreference";
import PasswordAccess from "@/components/perfil/PasswordAccess";
import PayoutDefaultEditor, { type PayoutMethod, type PayoutAccountType } from "@/components/perfil/PayoutDefaultEditor";
import { formatPhone } from "@/lib/format-phone";
import { retryProfilePatch, loadProfile, saveProfilePatch, type PersistedProfile, type ProfilePatch, type PendingProfileMutation } from "@/lib/users/profile-client";

type ProfileOperation = "name" | "avatar" | "payout" | "clear";
type ProfileIssue = { error: string; kind: "auth" | "rejected" | "uncertain"; code?: string; latestProfile?: PersistedProfile };

export default function PerfilPage() {
  const t = useTranslations("Perfil");
  const tCommon = useTranslations("Common");
  const tOnboarding = useTranslations("Onboarding");
  const isIOSApp = useIsIOSApp();
  const router = useRouter();
  const { showToast } = useToast();

  const [profile, setProfile] = useState<PersistedProfile | null>(null);
  const [editName, setEditName] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadIssue, setLoadIssue] = useState<ProfileIssue | null>(null);
  const [saveIssue, setSaveIssue] = useState<ProfileIssue | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [confirmationPending, setConfirmationPending] = useState(false);
  const [payoutRevision, setPayoutRevision] = useState(0);
  const mutationLock = useRef(false);
  const ownerId = useRef<string | null>(null);
  const pendingMutation = useRef<{ operation: ProfileOperation; mutation: PendingProfileMutation } | null>(null);
  // Account deletion (Apple 5.1.1(v)): confirm modal + delete flow.
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteIssue, setDeleteIssue] = useState<ProfileIssue | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setLoadIssue(null);
      const result = await loadProfile(ownerId.current ?? undefined);
      if (!active) return;
      if (result.ok) {
        ownerId.current ??= result.data.id;
        setProfile(result.data);
        setEditName(result.data.display_name ?? "");
      } else setLoadIssue(result);
      setLoading(false);
    }
    load();
    return () => { active = false; };
  }, [loadAttempt]);

  async function updateProfile(operation: ProfileOperation, patch: ProfilePatch) {
    if (mutationLock.current) throw new Error(tCommon("saving"));
    if (!ownerId.current) throw new Error(t("errLoading"));
    if (pendingMutation.current && pendingMutation.current.operation !== operation) {
      throw new Error(saveIssue?.error ?? "No pudimos confirmar el guardado. Reintenta para comprobarlo.");
    }
    mutationLock.current = true;
    setMutationBusy(true);
    setSaveIssue(null);
    try {
      const result = pendingMutation.current
        ? await retryProfilePatch(pendingMutation.current.mutation)
        : await saveProfilePatch(patch, ownerId.current);
      if (!result.ok) {
        if (result.pending) {
          pendingMutation.current = { operation, mutation: result.pending };
          setConfirmationPending(true);
        } else { pendingMutation.current = null; setConfirmationPending(false); }
        setSaveIssue(result);
        if (result.code === "PROFILE_CHANGED" && result.latestProfile) setProfile(result.latestProfile);
        throw new Error(result.error);
      }
      pendingMutation.current = null;
      setConfirmationPending(false);
      setProfile(result.data);
      return result.data;
    } finally {
      mutationLock.current = false;
      setMutationBusy(false);
    }
  }

  async function retryPendingSave() {
    const pending = pendingMutation.current;
    if (!pending) return;
    try {
      const saved = await updateProfile(pending.operation, pending.mutation.patch);
      if (pending.operation === "name") { setEditName(saved.display_name ?? ""); setIsEditing(false); }
      if (pending.operation === "avatar") setShowAvatarPicker(false);
      if (pending.operation === "payout" || pending.operation === "clear") setPayoutRevision(value => value + 1);
      showToast(t(pending.operation === "name" ? "toastNameUpdated" : pending.operation === "avatar" ? "toastChickenUpdated" : pending.operation === "clear" ? "toastPayoutCleared" : "toastPayoutSaved"), "success");
    } catch { /* The actionable issue remains on screen; the draft stays intact. */ }
  }

  async function handleSaveName() {
    if (editName.trim().length < 2) { showToast(t("errMinChars"), "error"); return; }
    setSaving(true);
    try {
      const saved = await updateProfile("name", { display_name: editName.trim() });
      setEditName(saved.display_name ?? "");
      setIsEditing(false);
      showToast(t("toastNameUpdated"), "success");
    } catch { /* Preserve the name and show the actionable save issue below. */ } finally { setSaving(false); }
  }

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  async function handleDeleteAccount() {
    if (!ownerId.current) return;
    setDeleting(true);
    setDeleteIssue(null);
    try {
      await axios.post("/api/users/me/delete", { expected_user_id: ownerId.current });
      // El endpoint ya cerro la sesion server-side; cerramos tambien el
      // cliente para limpiar cualquier cookie/estado local y mandamos a login.
      const supabase = createClient();
      await supabase.auth.signOut().catch(() => {});
      showToast(t("deleteSuccess"), "success");
      router.push("/login");
    } catch (cause) {
      if (axios.isAxiosError(cause) && cause.response?.data?.code === "SESSION_CHANGED") {
        setDeleteIssue({ kind: "rejected", code: "SESSION_CHANGED", error: cause.response.data.error });
      } else showToast(t("deleteError"), "error");
      setDeleting(false);
    }
  }

  async function handleAvatarChange(pollitoId: string) {
    setSavingAvatar(true);
    try {
      await updateProfile("avatar", { avatar_url: pollitoId });
      setShowAvatarPicker(false);
      showToast(t("toastChickenUpdated"), "success");
    } catch { /* Keep the picker open until the persisted selection is confirmed. */ } finally { setSavingAvatar(false); }
  }

  async function handlePayoutSave(
    method: PayoutMethod,
    account: string,
    accountName: string | null,
    accountType: PayoutAccountType | null,
  ) {
      await updateProfile("payout", {
        default_payout_method: method,
        default_payout_account: account,
        default_payout_account_name: accountName,
        default_payout_account_type: accountType,
      });
      showToast(t("toastPayoutSaved"), "success");
  }

  async function handlePayoutClear() {
      await updateProfile("clear", {
        default_payout_method: null,
        default_payout_account: null,
        default_payout_account_name: null,
        default_payout_account_type: null,
      });
      showToast(t("toastPayoutCleared"), "success");
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="flex flex-col items-center gap-2"><FootballLoader /><p className="text-text-muted">{t("loading")}</p></div></div>;
  if (!profile) return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-sm space-y-4 text-center">
        <p role="alert" className="text-text-secondary">{loadIssue?.error ?? t("errLoading")}</p>
        <button type="button" onClick={() => setLoadAttempt(value => value + 1)} className="min-h-11 rounded-xl border border-border-subtle px-4 py-2 text-text-primary transition-colors hover:bg-bg-elevated">{tCommon("retry")}</button>
        {(loadIssue?.kind === "auth" || loadIssue?.code === "SESSION_CHANGED") && <Link href={loadIssue?.code === "SESSION_CHANGED" ? "/perfil" : "/login?returnTo=%2Fperfil"} target="_blank" rel="noopener noreferrer" className="block min-h-11 rounded-xl border border-border-subtle px-4 py-2 text-text-primary">{tCommon(loadIssue?.code === "SESSION_CHANGED" ? "reviewAccount" : "loginAgain")}</Link>}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen">
      <header className="px-4 pt-4 pb-6">
        <div className="max-w-lg mx-auto">
          <h1 className="lp-section-title text-center text-[22px]">{t("header")}</h1>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 space-y-6 -mt-1">
        {saveIssue && (
          <div role="alert" className="space-y-3 rounded-xl border border-red-alert/30 bg-red-dim p-3">
            <p className="text-[13px] leading-normal text-text-primary">{saveIssue.error}</p>
            {saveIssue.code === "PROFILE_CHANGED" && saveIssue.latestProfile && <p className="text-[13px] leading-normal text-text-secondary [overflow-wrap:anywhere]">Datos guardados: {saveIssue.latestProfile.display_name} · {saveIssue.latestProfile.default_payout_account ?? "Sin cuenta de pago"}</p>}
            {confirmationPending && <button type="button" onClick={retryPendingSave} disabled={mutationBusy} className="min-h-11 rounded-xl border border-border-subtle px-4 py-2 text-text-primary transition-colors hover:bg-bg-elevated disabled:opacity-50">{mutationBusy ? tCommon("loading") : tCommon("retry")}</button>}
            {(saveIssue.kind === "auth" || saveIssue.code === "SESSION_CHANGED") && <Link href={saveIssue.code === "SESSION_CHANGED" ? "/perfil" : "/login?returnTo=%2Fperfil"} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-xl border border-border-subtle px-4 py-2 text-text-primary">{tCommon(saveIssue.code === "SESSION_CHANGED" ? "reviewAccount" : "loginAgain")}</Link>}
          </div>
        )}
        {/* Avatar + name */}
        <div className="flex flex-col items-center">
          <button
            type="button"
            disabled={mutationBusy || confirmationPending}
            onClick={() => setShowAvatarPicker(!showAvatarPicker)}
            className="relative mb-3 cursor-pointer group"
          >
            <UserAvatar
              avatarUrl={profile.avatar_url}
              displayName={profile.display_name ?? ""}
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
                      disabled={savingAvatar || mutationBusy || confirmationPending}
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
            <div className="flex flex-wrap items-center gap-2 w-full max-w-xs">
              <input type="text" aria-label={tOnboarding("namePlaceholder")} value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus disabled={mutationBusy || confirmationPending}
                className="min-h-11 min-w-0 basis-24 flex-1 rounded-lg border border-border-medium bg-bg-elevated px-3 py-2 text-center text-text-primary outline-none focus:border-gold" />
              <button onClick={handleSaveName} disabled={saving || mutationBusy || confirmationPending}
                className="min-h-11 shrink-0 rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-bg-base">
                {saving ? "..." : "OK"}
              </button>
              <button
                type="button"
                disabled={mutationBusy || confirmationPending}
                aria-label={tCommon("cancel")}
                onClick={() => { setIsEditing(false); setEditName(profile.display_name ?? ""); }}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm text-text-muted transition-colors hover:bg-bg-elevated hover:text-text-primary"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <button
              disabled={mutationBusy || confirmationPending}
              onClick={() => setIsEditing(true)}
              className="flex min-h-11 items-center gap-2 rounded-lg px-3 py-1 text-text-primary transition-colors hover:bg-bg-elevated/50"
            >
              <span className="text-lg font-bold">{profile.display_name}</span>
              <span className="text-[10px] uppercase tracking-wider text-text-muted font-medium">{t("edit")}</span>
            </button>
          )}
          <p className="text-text-secondary text-sm mt-1 flex items-center gap-1">
            <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="5" y="2" width="14" height="20" rx="2" /><circle cx="12" cy="17" r="1" />
            </svg>
            {formatPhone(profile.whatsapp_number ?? "")}
          </p>
        </div>

        {/* Cuenta de pago — justo debajo del celular (2026-09-17, pedido del
            dueño: que se encuentre apenas se abre /perfil, sin bajar por
            «Mis pollas»). Edit / clear / cambiar de banco. Es la cuenta a la
            que la casa transfiere los premios.
            iOS: oculto por compliance 5.1.1(ix) — sin recolección de
            data financiera sensible (cuenta bancaria) en el iOS app. */}
        {!isIOSApp && (
          <PayoutDefaultEditor
            key={payoutRevision}
            errorsHandledExternally
            disabled={mutationBusy || confirmationPending}
            initialMethod={profile.default_payout_method ?? undefined}
            initialAccount={profile.default_payout_account ?? undefined}
            initialAccountName={profile.default_payout_account_name ?? undefined}
            initialAccountType={profile.default_payout_account_type ?? undefined}
            onSave={handlePayoutSave}
            onClear={handlePayoutClear}
          />
        )}

        <PasswordAccess />

        {/* (2026-09-19, pedido del dueño) «Mis pollas» y «Terminadas» salieron de
            acá: se repetían tal cual en Pollas (/inicio), que es donde se
            juega. También salió «Actividad reciente»: no ayudaba a decidir
            nada. El perfil queda para la cuenta: datos, cobro, invitaciones
            y ajustes. */}

        {/* Rifas de creadores (migración 157): solo si un administrador habilitó
            esta cuenta como creadora. Sin permiso no se dibuja nada. */}
        <MisRifasPerfil />

        {/* Invitaciones (migración 135). iOS: fuera, como el resto de promociones con premio. */}
        {!isIOSApp && <InvitacionesPerfil />}

        {/* Cortesías para regalar (migración 138). Solo aparece si la casa le dio
            cupos; si no tiene, el componente no dibuja nada. Fuera de iOS por el
            mismo criterio que las invitaciones. */}
        {!isIOSApp && <MisCortesias profileStyle />}

        {/* Tamaño del texto — preferencia local por dispositivo. */}
        <FontScalePicker />
        <WhatsAppPreference />

        {/* La guia global de puntaje SE FUE de acá (2026-08-25).
            Mostraba la escalera del Mundial — marcador exacto / diferencia de
            gol / ganador / un equipo — con 5 puntos por defecto. Nada de eso
            existe en la casa: acá el puntaje es de la POLLA, no de la app, y
            son dos reglas simples (1X2 = 3 pts, o marcador exacto = 3 y goles
            de un equipo = 1). Una guia global no puede ser cierta para todas
            las pollas a la vez, y esta le estaba enseñando a la gente un
            sistema que no se usa.

            Donde vive ahora: dentro de cada polla, junto al reparto, que es
            donde la persona decide si entra. InlineScoringGuide sigue
            existiendo y se sigue usando en /pollas/[slug] — ahí SÍ es cierta,
            porque describe las pollas P2P viejas. */}

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

        {/* Historial del modelo viejo.
            /pollas salió de la navegación con el pivote a la casa, pero ahí
            siguen vivas las 62 pollas y los 15.426 pronósticos de la etapa
            P2P. Sin esta puerta el histórico existiría pero sería
            inalcanzable, que en la práctica es lo mismo que perderlo. */}
        <Link
          href="/pollas"
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-profile-text/20 py-3 font-medium text-profile-text transition-colors hover:border-profile-text hover:bg-profile-text/5"
        >
          <History className="h-5 w-5 shrink-0" aria-hidden="true" />
          {t("oldPollas")}
        </Link>

        {/* Logout */}
        <button onClick={handleLogout}
          className="flex w-full items-center justify-center gap-2 py-3 rounded-xl font-medium transition-colors text-red-alert border border-red-dim hover:bg-red-dim">
          <LogOut className="h-5 w-5 shrink-0" aria-hidden="true" />
          {t("logout")}
        </button>

        {/* Eliminar cuenta — Apple 5.1.1(v). Borrado self-service in-app. */}
        <button
          onClick={() => setShowDeleteConfirm(true)}
          className="flex min-h-11 w-full items-center justify-center gap-2 py-2.5 text-sm font-medium text-text-muted transition-colors hover:text-red-alert"
        >
          <UserRoundX className="h-4 w-4 shrink-0" aria-hidden="true" />
          {t("deleteAccount")}
        </button>

        <div className="h-4" />
      </main>

      {/* Confirmación de borrado de cuenta */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={() => !deleting && setShowDeleteConfirm(false)}
        >
          <div
            className="w-full max-w-sm lp-card p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-text-primary">
              {t("deleteConfirmTitle")}
            </h2>
            <p className="text-sm text-text-secondary leading-relaxed">
              {t("deleteConfirmBody")}
            </p>
            {deleteIssue && <div role="alert" className="space-y-3 text-sm text-text-secondary">
              <p>{deleteIssue.error}</p>
              <Link href="/perfil" target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center justify-center rounded-xl border border-border-subtle px-4 py-2">{tCommon("reviewAccount")}</Link>
            </div>}
            <div className="flex flex-col gap-2 pt-1">
              <button
                onClick={handleDeleteAccount}
                disabled={deleting}
                className="w-full py-3 rounded-xl font-semibold bg-red-alert text-white hover:bg-red-alert/90 disabled:opacity-50 transition-colors"
              >
                {deleting ? t("deleting") : t("deleteConfirmYes")}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="w-full py-3 rounded-xl font-medium text-text-secondary border border-subtle hover:bg-card-hover disabled:opacity-50 transition-colors"
              >
                {t("deleteConfirmCancel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
