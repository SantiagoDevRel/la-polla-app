"use client";

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { RefreshCw } from 'lucide-react';
import { APP_BUILD_ID, fetchAppVersion, refreshApp } from '@/lib/app-update';

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
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let mounted = true, checking = false;
    const check = async () => {
      if (checking || document.visibilityState !== 'visible') return;
      checking = true;
      try {
        const version = await fetchAppVersion();
        if (mounted) setAvailable(version !== APP_BUILD_ID);
        // Install assets in the background, but let the user choose when to reload.
        const registration = await navigator.serviceWorker?.getRegistration();
        await registration?.update();
      } catch { /* Keep the current screen usable while offline. */ }
      finally { checking = false; }
    };
    void check();
    const visible = () => { void check(); };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('online', visible);
    navigator.serviceWorker?.addEventListener('controllerchange', visible);
    const timer = window.setInterval(visible, 120_000);
    return () => {
      mounted = false; clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('online', visible);
      navigator.serviceWorker?.removeEventListener('controllerchange', visible);
    };
  }, []);
  if (!available) return null;
  return <aside role="status" aria-label={en ? 'App update' : 'Actualización de la app'} data-app-update className="fixed inset-x-3 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-[10001] mx-auto max-h-[60dvh] max-w-[456px] space-y-3 overflow-y-auto rounded-2xl border border-border-subtle bg-bg-elevated p-4 shadow-xl">
    <p className="text-[15px] font-semibold text-text-primary">{en ? 'A new version is available' : 'Hay una nueva versión disponible'}</p>
    <AppUpdateButton/>
  </aside>;
}
