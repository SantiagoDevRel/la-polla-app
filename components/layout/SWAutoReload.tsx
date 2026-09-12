"use client";

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { RefreshCw, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { APP_BUILD_ID, autoUpdateKey, canAutoUpdate, fetchAppVersion, refreshApp } from '@/lib/app-update';

export function AppUpdateButton() {
  const en = useLocale() === 'en';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  return <div className="space-y-2">
    <button type="button" disabled={busy} onClick={async () => {
      setBusy(true); setError(false);
      try { await refreshApp(); } catch { setError(true); setBusy(false); }
    }} className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-border-subtle bg-bg-elevated px-4 py-3 text-[15px] font-semibold text-text-primary transition-colors hover:bg-bg-card disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-turf">
      <RefreshCw className={`h-4 w-4 shrink-0 ${busy ? 'animate-spin' : ''}`} aria-hidden="true"/>
      {busy ? (en ? 'Updating…' : 'Actualizando…') : (en ? 'Update app' : 'Actualizar app')}
    </button>
    {error && <p role="alert" className="text-[13px] leading-relaxed text-amber">{en ? 'Could not connect. Check your connection and try again.' : 'No pudimos conectar. Revisa tu conexión e intenta de nuevo.'}</p>}
  </div>;
}

export default function SWAutoReload() {
  const en = useLocale() === 'en';
  const pathname = usePathname();
  const [available, setAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    let mounted = true, checking = false, edited = false, interacted = false;
    const edit = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) edited = true;
    };
    const interact = () => { interacted = true; };
    const editing = () => edited || Boolean(document.querySelector('[data-app-update-blocked="true"]')) || Boolean(document.activeElement?.matches('input, textarea, select, [contenteditable="true"]'));
    const check = async (entry = false) => {
      if (document.visibilityState !== 'visible') return;
      // Returning restores the reminder even while a previous worker check runs.
      if (entry) setDismissed(false);
      if (checking) return;
      checking = true;
      if (entry) interacted = false;
      try {
        const version = await fetchAppVersion();
        if (!mounted) return;
        setAvailable(version !== APP_BUILD_ID);
        if (canAutoUpdate(APP_BUILD_ID, version, entry, editing() || interacted, sessionStorage)) {
          await refreshApp(() => {
            if (!mounted || document.hidden || editing() || interacted) return false;
            try { sessionStorage.setItem(autoUpdateKey(APP_BUILD_ID, version), 'attempted'); }
            catch { return false; }
            return true;
          });
        } else {
          const registration = await navigator.serviceWorker?.getRegistration();
          await registration?.update();
        }
      } catch { /* Keep the current screen usable while offline. */ }
      finally { checking = false; }
    };
    void check(true);
    const visible = () => { void check(true); };
    const background = () => { void check(); };
    document.addEventListener('input', edit, true);
    document.addEventListener('change', edit, true);
    document.addEventListener('pointerdown', interact, true);
    document.addEventListener('keydown', interact, true);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('online', visible);
    navigator.serviceWorker?.addEventListener('controllerchange', background);
    const timer = window.setInterval(background, 120_000);
    return () => {
      mounted = false; clearInterval(timer);
      document.removeEventListener('input', edit, true);
      document.removeEventListener('change', edit, true);
      document.removeEventListener('pointerdown', interact, true);
      document.removeEventListener('keydown', interact, true);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('online', visible);
      navigator.serviceWorker?.removeEventListener('controllerchange', background);
    };
  }, [pathname]);
  if (!available || dismissed) return null;
  return <aside role="status" aria-label={en ? 'App update' : 'Actualización de la app'} data-app-update className="fixed inset-x-3 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-[10001] mx-auto max-h-[60dvh] max-w-[456px] space-y-3 overflow-y-auto rounded-2xl border border-border-subtle bg-bg-elevated p-4 shadow-xl">
    <div className="flex items-center gap-2">
      <p className="min-w-0 flex-1 text-[15px] font-semibold text-text-primary">{en ? 'A new version is available' : 'Hay una nueva versión disponible'}</p>
      <button type="button" onClick={() => setDismissed(true)} aria-label={en ? 'Remind me when I return' : 'Recordarme al volver'} className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-bg-card hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-turf"><X className="h-5 w-5" aria-hidden="true"/></button>
    </div>
    <AppUpdateButton/>
  </aside>;
}
