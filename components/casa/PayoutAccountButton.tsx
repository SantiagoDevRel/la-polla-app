"use client";

import { useEffect, useId, useRef, useState, type MutableRefObject } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import PayoutDefaultEditor, { type PayoutAccountType, type PayoutMethod } from "@/components/perfil/PayoutDefaultEditor";
import { retryProfilePatch, loadProfile, saveProfilePatch, type PersistedProfile, type ProfilePatch, type PendingProfileMutation } from "@/lib/users/profile-client";

type AccountDraft = { ownerId: string | null; mutation: PendingProfileMutation | null };

function AccountDialog({ onClose, note, onSaved, draft }: { onClose: () => void; note: string; onSaved?: () => void; draft: MutableRefObject<AccountDraft> }) {
  const tCommon = useTranslations("Common");
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [profile, setProfile] = useState<PersistedProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [saved, setSaved] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [sessionChanged, setSessionChanged] = useState(false);
  const [pending, setPending] = useState(!!draft.current.mutation);
  const [saving, setSaving] = useState(false);
  const [editorRevision, setEditorRevision] = useState(0);
  const [latestSaved, setLatestSaved] = useState<string | null>(null);
  const saveLock = useRef(false);

  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    let active = true;
    async function load() {
      setError(null);
      const result = await loadProfile(draft.current.ownerId ?? undefined);
      if (!active) return;
      if (!result.ok) { setError(result.error); setSessionExpired(result.kind === "auth"); setSessionChanged(result.code === "SESSION_CHANGED"); return; }
      draft.current.ownerId ??= result.data.id;
      setProfile(result.data);
      if (draft.current.mutation) setError("No pudimos confirmar el guardado. Conservamos tu cuenta; reintenta para comprobarla.");
    }
    void load();
    return () => { active = false; };
  }, [revision, draft]);

  async function save(method: PayoutMethod, account: string, name: string | null, type: PayoutAccountType | null) {
    if (saveLock.current || !draft.current.ownerId) throw new Error("Espera a que termine la comprobación de tu cuenta.");
    saveLock.current = true;
    setSaving(true);
    setSaved(false);
    setError(null);
    setLatestSaved(null);
    setSessionExpired(false);
    setSessionChanged(false);
    const updated: ProfilePatch = draft.current.mutation?.patch ?? {
      default_payout_method: method,
      default_payout_account: account,
      default_payout_account_name: name,
      default_payout_account_type: type,
    };
    try {
      const result = draft.current.mutation
        ? await retryProfilePatch(draft.current.mutation)
        : await saveProfilePatch(updated, draft.current.ownerId);
      if (!result.ok) {
        if (result.pending) { draft.current.mutation = result.pending; setPending(true); }
        else { draft.current.mutation = null; setPending(false); }
        setError(result.error);
        setSessionExpired(result.kind === "auth");
        setSessionChanged(result.code === "SESSION_CHANGED");
        if (result.code === "PROFILE_CHANGED" && result.latestProfile) {
          setProfile(result.latestProfile);
          setLatestSaved(result.latestProfile.default_payout_account ?? "Sin cuenta de pago");
        }
        throw new Error(result.error);
      }
      draft.current.mutation = null;
      setPending(false);
      setProfile(result.data);
      setSaved(true);
      onSaved?.();
    } finally { saveLock.current = false; setSaving(false); }
  }

  async function retryPending() {
    const patch = draft.current.mutation?.patch;
    if (!patch) { setRevision(value => value + 1); return; }
    try {
      await save(patch.default_payout_method ?? "nequi", patch.default_payout_account ?? "", patch.default_payout_account_name ?? null, patch.default_payout_account_type ?? null);
      setEditorRevision(value => value + 1);
    } catch { /* Preserve the draft; an explicit retry keeps the original revision fence. */ }
  }
  const editorProfile = profile && draft.current.mutation ? { ...profile, ...draft.current.mutation.patch } : profile;

  return createPortal(
    <dialog ref={dialog} aria-labelledby={`${id}-title`} onClose={onClose}
      onCancel={(event) => { if (saving) event.preventDefault(); }}
      onClick={(event) => { if (!saving && event.target === event.currentTarget) dialog.current?.close(); }}
      className="m-auto max-h-[85dvh] w-[calc(100%_-_2rem)] max-w-md overflow-y-auto rounded-xl border border-border-default bg-bg-card p-0 text-text-primary backdrop:bg-bg-base/80 backdrop:backdrop-blur-sm">
      <div className="p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id={`${id}-title`} className="font-display text-[24px] leading-tight tracking-[0.04em]">Tu cuenta de pago</h2>
          <button type="button" disabled={saving} onClick={() => dialog.current?.close()} aria-label="Cerrar cuenta de pago"
            className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary">
            <X size={20} aria-hidden />
          </button>
        </div>
        <p className="mb-4 text-[15px] leading-relaxed text-text-secondary">{note}</p>
        {error && <div role="alert" className="mb-3 space-y-3 text-[15px]">
          <p>{error}</p>{latestSaved && <p className="text-text-secondary [overflow-wrap:anywhere]">Cuenta guardada: {latestSaved}</p>}{(!profile || pending) && <button type="button" disabled={saving} className="lp-btn lp-btn-ghost" onClick={retryPending}>{tCommon("retry")}</button>}
          {(sessionExpired || sessionChanged) && <Link href={sessionChanged ? "/perfil" : `/login?returnTo=${encodeURIComponent(typeof window === "undefined" ? "/inicio" : window.location.pathname)}`} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center justify-center rounded-xl border border-border-subtle px-4 py-2">{tCommon(sessionChanged ? "reviewAccount" : "loginAgain")}</Link>}
        </div>}
        {!profile && !error ? <div role="status" className="space-y-3"><span className="sr-only">Cargando tu cuenta de pago</span><div className="h-12 animate-pulse rounded-md bg-bg-elevated" /><div className="h-28 animate-pulse rounded-md bg-bg-elevated" /></div> : editorProfile && (
          <PayoutDefaultEditor key={editorRevision} errorsHandledExternally forceEdit={pending} disabled={saving || pending}
            initialMethod={editorProfile.default_payout_method} initialAccount={editorProfile.default_payout_account}
            initialAccountName={editorProfile.default_payout_account_name} initialAccountType={editorProfile.default_payout_account_type}
            onSave={save} />
        )}
        {saved && <p role="status" className="mt-3 text-[15px] text-turf">Tu cuenta de pago quedó guardada.</p>}
      </div>
    </dialog>, document.body,
  );
}

const CASA_NOTE = "Si ganas, enviaremos el dinero a esta cuenta. También queda guardada en tu perfil.";

/**
 * `note` cambia quién paga: en Casa paga La Polla; en las rifas de creadores
 * (migración 157) paga quien creó la rifa. `onSaved` avisa para refrescar.
 */
export function PayoutAccountButton({ note = CASA_NOTE, label = "Llenar o revisar mi cuenta de pago", onSaved, className = "lp-btn lp-btn-ghost mt-3 w-full" }: {
  note?: string; label?: string; onSaved?: () => void; className?: string;
} = {}) {
  const [open, setOpen] = useState(false);
  const draft = useRef<AccountDraft>({ ownerId: null, mutation: null });
  return <>
    <button type="button" onClick={() => setOpen(true)} className={`${className} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary`}>{label}</button>
    {open && <AccountDialog note={note} onSaved={onSaved} draft={draft} onClose={() => setOpen(false)} />}
  </>;
}
