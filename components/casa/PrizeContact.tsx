"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Mail, X } from "lucide-react";
import type { PrizeContactData } from "@/lib/casa/prize-contact";

// Typography follows PayoutAccountButton: Bebas 24/400/1.25/.04em title;
// Outfit 15/400/1.5 body + fields, 15/600 controls, 13/400/1.5 help.
function ContactDialog({ initial, onSave, onClose }: {
  initial: PrizeContactData;
  onSave: (email: string, confirmation: string) => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [email, setEmail] = useState(initial.email ?? "");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { dialog.current?.showModal(); }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (email.trim() !== confirmation.trim()) { setError("Los correos no coinciden. Revísalos antes de guardar."); return; }
    setBusy(true); setError(null);
    try { await onSave(email.trim(), confirmation.trim()); dialog.current?.close(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar. Intenta de nuevo."); }
    finally { setBusy(false); }
  }

  return createPortal(
    <dialog ref={dialog} aria-labelledby={`${id}-title`} aria-describedby={`${id}-help`} onClose={onClose}
      onClick={(event) => { if (event.target === event.currentTarget && !busy) dialog.current?.close(); }}
      onCancel={(event) => { if (busy) event.preventDefault(); }}
      className="m-auto max-h-[85dvh] w-[calc(100%_-_2rem)] max-w-md overflow-y-auto rounded-xl border border-border-default bg-bg-card p-0 text-text-primary backdrop:bg-bg-base/80 backdrop:backdrop-blur-sm">
      <form onSubmit={submit} className="space-y-4 p-4 text-[15px] leading-relaxed">
        <div className="flex items-start justify-between gap-3">
          <h2 id={`${id}-title`} className="min-w-0 font-display text-[24px] leading-tight tracking-[0.04em]">¿Cuál es tu correo de Quentro?</h2>
          <button type="button" disabled={busy} onClick={() => dialog.current?.close()} aria-label="Cerrar correo de Quentro"
            className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-bg-elevated focus-visible:ring-2 focus-visible:ring-text-primary disabled:opacity-50">
            <X size={20} aria-hidden />
          </button>
        </div>
        <p id={`${id}-help`} className="text-text-secondary">{initial.winner ? "Enviaremos las boletas a este correo." : "Si ganas POLLA REGALO, enviaremos las boletas a este correo."}</p>
        <label className="block font-medium" htmlFor={`${id}-email`}>Correo de tu cuenta de Quentro
          <input id={`${id}-email`} type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
            required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy}
            className="lp-input mt-2 min-w-0 text-[15px] font-normal" />
        </label>
        <label className="block font-medium" htmlFor={`${id}-confirmation`}>Repite el correo
          <input id={`${id}-confirmation`} type="email" inputMode="email" autoComplete="off" autoCapitalize="none" spellCheck={false}
            required maxLength={254} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy}
            aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined}
            className="lp-input mt-2 min-w-0 text-[15px] font-normal" />
        </label>
        <p className="text-[13px] leading-relaxed text-text-secondary">Solo tú y el administrador podrán verlo para entregar las boletas.</p>
        {error && <p id={`${id}-error`} role="alert" className="text-[15px] text-red-alert">{error}</p>}
        <button type="submit" disabled={busy} className="lp-btn lp-btn-primary w-full">{busy ? "Guardando…" : "Guardar correo"}</button>
        <button type="button" disabled={busy} className="lp-btn lp-btn-ghost w-full" onClick={() => dialog.current?.close()}>Ahora no</button>
      </form>
    </dialog>, document.body,
  );
}

export function PrizeContact({ slug }: { slug: string }) {
  const [contact, setContact] = useState<PrizeContactData | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const prompted = useRef(false);
  const endpoint = `/api/casa/pollas/${encodeURIComponent(slug)}/prize-contact`;
  const load = useCallback(async (signal?: AbortSignal) => {
    setError(null);
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No se pudo cargar tu correo.");
      if (signal?.aborted) return;
      setContact(data);
      if (!data.email && data.editable && !prompted.current) { prompted.current = true; setOpen(true); }
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "No se pudo cargar tu correo.");
    }
  }, [endpoint]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function save(email: string, confirmation: string) {
    const response = await fetch(endpoint, { method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/json", "X-Casa-Contract": "2" }, body: JSON.stringify({ email, confirmation }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "No se pudo guardar tu correo.");
    setContact(data); setSaved(true);
  }

  return <section className="mb-4 text-[15px] leading-relaxed" aria-label="Correo para recibir las boletas">
    {error ? <div role="alert" className="space-y-2"><p className="text-red-alert">{error}</p><button type="button" className="lp-btn lp-btn-ghost" onClick={() => void load()}>Reintentar correo</button></div>
      : !contact ? <div className="h-12 animate-pulse rounded-md bg-bg-elevated" role="status"><span className="sr-only">Cargando tu correo de Quentro</span></div>
      : <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Mail className="h-5 w-5 shrink-0 text-text-secondary" aria-hidden />
        <div className="min-w-0 flex-1 basis-40"><p className="font-medium">{contact.email ? "Correo de Quentro guardado" : "Correo para tus boletas"}</p>
          {contact.email && <p className="text-[13px] text-text-secondary [overflow-wrap:anywhere]">{contact.email}</p>}
        </div>
        {contact.editable && <button type="button" className="lp-btn lp-btn-ghost !px-4" onClick={() => setOpen(true)}>{contact.email ? "Cambiar" : "Agregar correo"}</button>}
      </div>}
    {saved && <p role="status" className="mt-2 text-[13px] text-turf">Tu correo quedó guardado.</p>}
    {open && contact?.editable && <ContactDialog initial={contact} onSave={save} onClose={() => setOpen(false)} />}
  </section>;
}
