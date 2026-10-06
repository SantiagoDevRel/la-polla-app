"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Mail, X } from "lucide-react";
import type { PrizeContactData } from "@/lib/casa/prize-contact";
import { readPrizeContact, savePrizeContact, verifyPrizeContact, type OwnedPrizeContactData, type PrizeContactOperation, type PrizeContactSaveResult } from "@/lib/casa/prize-contact-client";

type ContactDraft = { email: string; confirmation: string };
type SaveFailure = Extract<PrizeContactSaveResult, { ok: false }>;
type SavePhase = "saving" | "checking" | null;

// Typography follows PayoutAccountButton: Bebas 24/400/1.25/.04em title;
// Outfit 15/400/1.5 body + fields, 15/600 controls, 13/400/1.5 help.
function ContactDialog({ initial, draft, failure, phase, pending, loginHref, onChange, onSave, onVerify, onClose }: {
  initial: PrizeContactData;
  draft: ContactDraft;
  failure: SaveFailure | null;
  phase: SavePhase;
  pending: boolean;
  loginHref: string;
  onChange: (draft: ContactDraft) => void;
  onSave: () => Promise<void>;
  onVerify: () => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const busy = phase !== null;
  useEffect(() => { dialog.current?.showModal(); }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!busy && (!pending || failure?.retrySameEmail)) void onSave();
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
            required maxLength={254} value={draft.email} onChange={(event) => onChange({ ...draft, email: event.target.value })} disabled={busy} readOnly={pending || !initial.editable}
            className="lp-input mt-2 min-w-0 text-[15px] font-normal" />
        </label>
        <label className="block font-medium" htmlFor={`${id}-confirmation`}>Repite el correo
          <input id={`${id}-confirmation`} type="email" inputMode="email" autoComplete="off" autoCapitalize="none" spellCheck={false}
            required maxLength={254} value={draft.confirmation} onChange={(event) => onChange({ ...draft, confirmation: event.target.value })} disabled={busy} readOnly={pending || !initial.editable}
            aria-invalid={Boolean(failure)} aria-describedby={failure ? `${id}-error` : undefined}
            className="lp-input mt-2 min-w-0 text-[15px] font-normal" />
        </label>
        <p className="text-[13px] leading-relaxed text-text-secondary">Solo tú y el administrador podrán verlo para entregar las boletas.</p>
        {failure && <div className="space-y-2">
          <p id={`${id}-error`} role="alert" className="text-[15px] text-red-alert">{failure.error}</p>
          {failure.kind === "auth" && <><a href={loginHref} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-ghost w-full">Ingresar de nuevo</a>
            <p className="text-[13px] text-text-secondary">Ingresa en la nueva pestaña y vuelve aquí para comprobar tu correo.</p></>}
          {failure.kind === "account" && <a href="/perfil" target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-ghost w-full">Revisar cuenta</a>}
        </div>}
        <button type="submit" disabled={busy || !initial.editable || (pending && !failure?.retrySameEmail)} className="lp-btn lp-btn-primary w-full">
          {phase === "saving" ? "Guardando…" : phase === "checking" ? "Comprobando…" : pending ? "Reenviar el mismo correo" : "Guardar correo"}
        </button>
        {pending && <button type="button" disabled={busy} className="lp-btn lp-btn-ghost w-full" onClick={() => void onVerify()}>Comprobar correo</button>}
        <button type="button" disabled={busy} className="lp-btn lp-btn-ghost w-full" onClick={() => dialog.current?.close()}>Ahora no</button>
      </form>
    </dialog>, document.body,
  );
}

export function PrizeContact({ slug }: { slug: string }) {
  const [contact, setContact] = useState<OwnedPrizeContactData | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadAuth, setLoadAuth] = useState(false);
  const [saved, setSaved] = useState(false);
  const [draft, setDraft] = useState<ContactDraft>({ email: "", confirmation: "" });
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const [pending, setPending] = useState<PrizeContactOperation | null>(null);
  const [phase, setPhase] = useState<SavePhase>(null);
  const active = useRef(false);
  const loadRevision = useRef(0);
  const prompted = useRef(false);
  const endpoint = `/api/casa/pollas/${encodeURIComponent(slug)}/prize-contact`;
  const loginHref = `/login?returnTo=${encodeURIComponent(typeof window === "undefined" ? `/polla/${slug}` : window.location.pathname + window.location.search)}`;
  const load = useCallback(async () => {
    const revision = ++loadRevision.current;
    setError(null); setLoadAuth(false);
    const result = await readPrizeContact(endpoint);
    if (revision !== loadRevision.current) return;
    if (result.ok) {
      setContact(result.data);
      setDraft(current => current.email || current.confirmation ? current : { email: result.data.email ?? "", confirmation: "" });
      if (!result.data.email && result.data.editable && !prompted.current) { prompted.current = true; setOpen(true); }
    } else {
      setError(result.error); setLoadAuth(result.kind === "auth");
    }
  }, [endpoint]);
  useEffect(() => {
    const requestScope = loadRevision;
    setContact(null); setDraft({ email: "", confirmation: "" }); setFailure(null); setPending(null); setSaved(false); setOpen(false);
    prompted.current = false;
    void load();
    return () => { requestScope.current++; };
  }, [load]);

  function acknowledge(result: PrizeContactSaveResult, operation: PrizeContactOperation) {
    if (result.ok) {
      setContact(result.data); setSaved(true); setPending(null); setFailure(null); setOpen(false);
      setDraft({ email: result.data.email ?? "", confirmation: "" });
    } else {
      setFailure(result);
      if (result.kind === "changed") { setContact(result.current); setPending(null); }
      else setPending(result.kind === "rejected" ? null : operation);
    }
  }

  async function save() {
    if (active.current || !contact?.editable || (pending && !failure?.retrySameEmail)) return;
    const email = draft.email.trim(), confirmation = draft.confirmation.trim();
    if (email !== confirmation) {
      setFailure({ ok: false, kind: "rejected", retrySameEmail: false, error: "Los correos no coinciden. Revísalos antes de guardar." }); return;
    }
    const revision = loadRevision.current;
    const operation = pending ?? { email, confirmation, requestId: crypto.randomUUID(), expectedRevision: contact.revision };
    active.current = true; setPhase("saving"); setSaved(false); setFailure(null);
    try {
      const result = await savePrizeContact(endpoint, operation, contact.owner_id);
      if (revision === loadRevision.current) acknowledge(result, operation);
    } finally { active.current = false; setPhase(null); }
  }

  async function verify() {
    if (active.current || !pending || !contact) return;
    const revision = loadRevision.current;
    active.current = true; setPhase("checking"); setFailure(null);
    try {
      const result = await verifyPrizeContact(endpoint, pending, contact.owner_id);
      if (revision === loadRevision.current) acknowledge(result, pending);
    } finally { active.current = false; setPhase(null); }
  }

  const hasDraft = draft.email !== (contact?.email ?? "") || draft.confirmation !== "";
  return <section data-app-update-blocked={hasDraft || Boolean(pending) || phase !== null} className="mb-4 text-[15px] leading-relaxed" aria-label="Correo para recibir las boletas">
    {error ? <div role="alert" className="space-y-2"><p className="text-red-alert">{error}</p>
      {loadAuth && <a href={loginHref} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-ghost">Ingresar de nuevo</a>}
      <button type="button" className="lp-btn lp-btn-ghost" onClick={() => void load()}>Reintentar correo</button></div>
      : !contact ? <div className="h-12 animate-pulse rounded-md bg-bg-elevated" role="status"><span className="sr-only">Cargando tu correo de Quentro</span></div>
      : <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Mail className="h-5 w-5 shrink-0 text-text-secondary" aria-hidden />
        <div className="min-w-0 flex-1 basis-40"><p className="font-medium">{contact.email ? "Correo de Quentro guardado" : "Correo para tus boletas"}</p>
          {contact.email && <p className="text-[13px] text-text-secondary [overflow-wrap:anywhere]">{contact.email}</p>}
        </div>
        {contact.editable && <button type="button" className="lp-btn lp-btn-ghost !px-4" onClick={() => setOpen(true)}>{contact.email ? "Cambiar" : "Agregar correo"}</button>}
      </div>}
    {saved && <p role="status" className="mt-2 text-[13px] text-turf">Tu correo quedó guardado.</p>}
    {open && contact && <ContactDialog initial={contact} draft={draft} failure={failure} pending={Boolean(pending)} phase={phase} loginHref={loginHref}
      onChange={value => { setDraft(value); setFailure(null); setSaved(false); }} onSave={save} onVerify={verify} onClose={() => setOpen(false)} />}
  </section>;
}
