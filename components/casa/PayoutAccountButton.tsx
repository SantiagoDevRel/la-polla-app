"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import PayoutDefaultEditor, { type PayoutAccountType, type PayoutMethod } from "@/components/perfil/PayoutDefaultEditor";

interface Profile {
  default_payout_method: PayoutMethod | null;
  default_payout_account: string | null;
  default_payout_account_name: string | null;
  default_payout_account_type: PayoutAccountType | null;
}

function AccountDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [saved, setSaved] = useState(false);

  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setError(null);
      try {
        const response = await fetch("/api/users/me", { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok || !data.profile) throw new Error("No se pudo cargar tu cuenta de pago.");
        setProfile(data.profile);
      } catch {
        if (!controller.signal.aborted) setError("No se pudo cargar tu cuenta de pago.");
      }
    }
    void load();
    return () => controller.abort();
  }, [revision]);

  async function save(method: PayoutMethod, account: string, name: string | null, type: PayoutAccountType | null) {
    setSaved(false);
    const updated: Profile = {
      default_payout_method: method,
      default_payout_account: account,
      default_payout_account_name: name,
      default_payout_account_type: type,
    };
    const response = await fetch("/api/users/me", {
      method: "PATCH", cache: "no-store", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updated),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "No se pudo guardar tu cuenta de pago.");
    setProfile(updated);
    setSaved(true);
  }

  return createPortal(
    <dialog ref={dialog} aria-labelledby={`${id}-title`} onClose={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}
      className="m-auto max-h-[85dvh] w-[calc(100%_-_2rem)] max-w-md overflow-y-auto rounded-xl border border-border-default bg-bg-card p-0 text-text-primary backdrop:bg-bg-base/80 backdrop:backdrop-blur-sm">
      <div className="p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id={`${id}-title`} className="font-display text-[24px] leading-tight tracking-[0.04em]">Tu cuenta de pago</h2>
          <button type="button" onClick={() => dialog.current?.close()} aria-label="Cerrar cuenta de pago"
            className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary">
            <X size={20} aria-hidden />
          </button>
        </div>
        <p className="mb-4 text-[15px] leading-relaxed text-text-secondary">Si ganas, enviaremos el dinero a esta cuenta. También queda guardada en tu perfil.</p>
        {error ? <div role="alert" className="space-y-3 text-[15px]">
          <p>{error}</p><button type="button" className="lp-btn lp-btn-ghost" onClick={() => setRevision(value => value + 1)}>Reintentar</button>
        </div> : !profile ? <div role="status" className="space-y-3"><span className="sr-only">Cargando tu cuenta de pago</span><div className="h-12 animate-pulse rounded-md bg-bg-elevated" /><div className="h-28 animate-pulse rounded-md bg-bg-elevated" /></div> : (
          <PayoutDefaultEditor initialMethod={profile.default_payout_method} initialAccount={profile.default_payout_account}
            initialAccountName={profile.default_payout_account_name} initialAccountType={profile.default_payout_account_type}
            allowedMethods={["nequi", "bancolombia"]} onSave={save} />
        )}
        {saved && <p role="status" className="mt-3 text-[15px] text-turf">Tu cuenta de pago quedó guardada.</p>}
      </div>
    </dialog>, document.body,
  );
}

export function PayoutAccountButton() {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)} className="lp-btn lp-btn-ghost mt-3 w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary">Llenar o revisar mi cuenta de pago</button>
    {open && <AccountDialog onClose={() => setOpen(false)} />}
  </>;
}
