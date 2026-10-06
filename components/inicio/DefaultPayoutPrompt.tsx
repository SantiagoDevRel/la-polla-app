// components/inicio/DefaultPayoutPrompt.tsx
//
// Wrapper client-only que mira si el viewer tiene users.default_payout_*
// seteado y, si NO, abre el DefaultPayoutPromptModal una vez por
// sesión. Saltable — al saltar queda una flag de session para no
// nag-ear de nuevo en esta visita; próxima visita vuelve a aparecer
// hasta que lo guarden o lo descarten desde /perfil.
//
// Persiste vía PATCH /api/users/me con {default_payout_method,
// default_payout_account} — ya seteado en route.ts.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { retryProfilePatch, loadProfile, saveProfilePatch, type PendingProfileMutation } from "@/lib/users/profile-client";
import DefaultPayoutPromptModal, {
  type PayoutMethod,
} from "@/components/onboarding/DefaultPayoutPromptModal";

const SESSION_KEY = "default-payout-prompt-skipped";

export default function DefaultPayoutPrompt() {
  const [open, setOpen] = useState(false);
  const [hasDefault, setHasDefault] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [sessionChanged, setSessionChanged] = useState(false);
  const [confirmationPending, setConfirmationPending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [latestSaved, setLatestSaved] = useState<string | null>(null);
  const ownerId = useRef<string | null>(null);
  const pendingPatch = useRef<PendingProfileMutation | null>(null);
  const savingLock = useRef(false);

  const load = useCallback(async () => {
    try {
      const result = await loadProfile(ownerId.current ?? undefined);
      if (!result.ok) return; // An optional prompt must not imply a missing account after a failed read.
      ownerId.current ??= result.data.id;
      const has =
        !!result.data.default_payout_method && !!result.data.default_payout_account;
      setHasDefault(has);
      if (!has && typeof window !== "undefined") {
        const skipped = window.sessionStorage.getItem(SESSION_KEY) === "1";
        if (!skipped) setOpen(true);
      }
    } catch {
      setHasDefault(true); // si falla el fetch, no nag — defensive
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(
    method: PayoutMethod,
    account: string,
    accountName: string | null,
  ) {
    if (savingLock.current || !ownerId.current) return;
    savingLock.current = true;
    setSaving(true);
    setError(null);
    setLatestSaved(null);
    setSessionExpired(false);
    setSessionChanged(false);
    try {
      const patch = {
        default_payout_method: method,
        default_payout_account: account,
        default_payout_account_name: accountName,
      };
      const result = pendingPatch.current
        ? await retryProfilePatch(pendingPatch.current)
        : await saveProfilePatch(patch, ownerId.current);
      if (!result.ok) {
        if (result.pending) { pendingPatch.current = result.pending; setConfirmationPending(true); }
        else { pendingPatch.current = null; setConfirmationPending(false); }
        setError(result.error);
        setSessionExpired(result.kind === "auth");
        setSessionChanged(result.code === "SESSION_CHANGED");
        if (result.code === "PROFILE_CHANGED" && result.latestProfile) setLatestSaved(result.latestProfile.default_payout_account ?? "Sin cuenta de pago");
        return;
      }
      pendingPatch.current = null;
      setConfirmationPending(false);
      setHasDefault(true);
      setOpen(false);
    } finally {
      savingLock.current = false;
      setSaving(false);
    }
  }

  function skip() {
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage.setItem(SESSION_KEY, "1");
      } catch {
        /* sessionStorage unavailable */
      }
    }
    setOpen(false);
  }

  if (hasDefault !== false) return null;
  return (
    <DefaultPayoutPromptModal
      open={open}
      error={error}
      latestSaved={latestSaved}
      sessionExpired={sessionExpired}
      sessionChanged={sessionChanged}
      confirmationPending={confirmationPending}
      disabled={saving}
      onSubmit={save}
      onSkip={skip}
    />
  );
}
